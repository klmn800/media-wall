"""Backend checks for Media Wall, run against throwaway libraries.

Every check builds its own media folder inside a temp directory and runs the
Flask app in-process (no config.ini is read or written). Nothing touches the
user's real media folder.

Usage:
    python tests/test_backend.py            # run everything
    python tests/test_backend.py wipe scan  # run checks whose name contains a word
"""

import json
import logging
import os
import shutil
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import media_wall as mw  # noqa: E402

logging.getLogger("media_wall").setLevel(logging.CRITICAL)

RESULTS: list[tuple[str, bool, str]] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class Library:
    """A throwaway media folder with an in-process Media Wall app."""

    def __init__(self, files: list[str], meta: dict | None = None,
                 raw_meta: str | None = None):
        self.root = tempfile.mkdtemp(prefix="mw_test_")
        self.media = os.path.join(self.root, "media")
        os.makedirs(self.media)
        for rel in files:
            path = os.path.join(self.media, *rel.split("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(b"\0" * (len(rel) + 10))
        if meta is not None:
            self.write_meta_raw(json.dumps(meta))
        if raw_meta is not None:
            self.write_meta_raw(raw_meta)
        config = mw.load_config(os.path.join(self.root, "no_config.ini"))
        config.set("media", "media_directory", self.media)
        self.app = mw.create_app(config)
        self.client = self.app.test_client()

    @property
    def meta_path(self) -> str:
        return os.path.join(self.media, mw.METADATA_FILENAME)

    def write_meta_raw(self, text: str) -> None:
        with open(self.meta_path, "w", encoding="utf-8") as f:
            f.write(text)

    def meta(self) -> dict:
        with open(self.meta_path, encoding="utf-8") as f:
            return json.load(f)

    def tags(self, rel: str) -> list[str] | None:
        item = self.meta()["items"].get(rel)
        return None if item is None else item.get("tags")

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


def run(test: Callable[[], None]) -> None:
    print(f"\n{test.__name__}")
    try:
        test()
    except Exception as e:  # a crash in a check is a failure, not an abort
        check(test.__name__, False, f"crashed: {type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Saving the tag file safely
# ---------------------------------------------------------------------------
def test_concurrent_tagging_keeps_every_tag():
    """8 tag requests at once must not wipe the file (TAGGING_REVIEW item 1)."""
    files = [f"clip_{i:03d}.mp4" for i in range(200)]
    lib = Library(files)
    try:
        def tag(rel):
            return lib.app.test_client().post(
                "/api/tags", json={"item_ids": [rel], "tags": ["batch"]}).status_code

        with ThreadPoolExecutor(max_workers=8) as pool:
            codes = list(pool.map(tag, files))
        meta = lib.meta()
        kept = sum(1 for rel in files if "batch" in meta["items"].get(rel, {}).get("tags", []))
        check("all 200 items still in the file", len(meta["items"]) == 200,
              f"{len(meta['items'])} items")
        check("all 200 clips kept their tag", kept == 200, f"{kept}/200")
        check("every request succeeded", all(c == 200 for c in codes),
              f"codes {sorted(set(codes))}")
    finally:
        lib.close()


def test_tag_added_during_scan_survives():
    """A long scan must not save over tags added while it was running."""
    lib = Library(["a.mp4", "b.mp4"])
    original = mw.generate_poster_frame

    def slow_poster(*args, **kwargs):
        time.sleep(0.5)
        return original(*args, **kwargs)

    try:
        # Force the scan to regenerate posters (none exist for empty files anyway).
        mw.generate_poster_frame = slow_poster
        scan = threading.Thread(
            target=lambda: lib.app.test_client().post("/api/scan"))
        scan.start()
        time.sleep(0.2)
        started = time.time()
        code = lib.client.post(
            "/api/tags", json={"item_ids": ["a.mp4"], "tags": ["mid-scan"]}).status_code
        waited = time.time() - started
        scan.join()
        check("tag request succeeded", code == 200, f"code {code}")
        check("tagging was not blocked by the slow scan", waited < 0.4,
              f"waited {waited:.2f}s")
        check("tag survives the scan", "mid-scan" in (lib.tags("a.mp4") or []),
              f"tags {lib.tags('a.mp4')}")
    finally:
        mw.generate_poster_frame = original
        lib.close()


def test_unreadable_file_is_never_overwritten():
    """A tag file that can't be read must be left alone, not saved as empty."""
    garbage = '{"items": {"a.mp4": {"tags": ["precious"]'  # truncated JSON
    lib = Library(["a.mp4"], raw_meta=garbage)
    try:
        with open(lib.meta_path, encoding="utf-8") as f:
            after_start = f.read()
        check("startup scan left the unreadable file alone", after_start == garbage)
        resp = lib.client.post("/api/tags", json={"item_ids": ["a.mp4"], "tags": ["x"]})
        with open(lib.meta_path, encoding="utf-8") as f:
            after_tag = f.read()
        check("tag request reports an error", resp.status_code >= 500,
              f"code {resp.status_code}")
        check("tag request left the unreadable file alone", after_tag == garbage)
        resp = lib.client.post("/api/scan")
        with open(lib.meta_path, encoding="utf-8") as f:
            after_scan = f.read()
        check("scan reports an error", resp.status_code >= 500, f"code {resp.status_code}")
        check("scan left the unreadable file alone", after_scan == garbage)
    finally:
        lib.close()


def test_save_waits_for_a_reader():
    """If another program (Beat Wall) has the file open, saving retries."""
    lib = Library(["a.mp4"])
    try:
        reader = open(lib.meta_path, encoding="utf-8")
        threading.Timer(0.3, reader.close).start()
        resp = lib.client.post("/api/tags", json={"item_ids": ["a.mp4"], "tags": ["held"]})
        time.sleep(0.4)
        check("tag request succeeded", resp.status_code == 200, f"code {resp.status_code}")
        check("tag was saved", "held" in (lib.tags("a.mp4") or []))
        leftovers = [n for n in os.listdir(lib.media) if n.endswith(".tmp")]
        check("no temp files left behind", not leftovers, str(leftovers))
    finally:
        lib.close()


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------
def test_delete_refuses_paths_outside_media_folder():
    lib = Library(["a.mp4"])
    outside = os.path.join(lib.root, "outside.mp4")
    with open(outside, "wb") as f:
        f.write(b"x")
    try:
        resp = lib.client.post("/api/delete", json={"item_ids": ["../outside.mp4"]})
        data = resp.get_json() or {}
        check("outside file still in place", os.path.exists(outside))
        check("nothing reported as deleted", data.get("deleted", 0) == 0, str(data))
    finally:
        lib.close()


def test_bad_page_size_does_not_crash():
    lib = Library(["a.mp4"])
    try:
        for q in ("per_page=0", "per_page=-5", "offset=-3", "per_page=abc"):
            code = lib.client.get(f"/api/media?{q}").status_code
            check(f"/api/media?{q} is handled", code == 200, f"code {code}")
    finally:
        lib.close()


# ---------------------------------------------------------------------------
# Tag names
# ---------------------------------------------------------------------------
def test_tags_are_normalized():
    lib = Library(["a.mp4"])
    try:
        lib.client.post("/api/tags", json={
            "item_ids": ["a.mp4"], "tags": ["  Red  Dress ", "CYBER", "red dress"]})
        check("trimmed, lowercased, spaces become hyphens, duplicates merged",
              lib.tags("a.mp4") == ["cyber", "red-dress"], str(lib.tags("a.mp4")))
        lib.client.delete("/api/tags", json={"item_ids": ["a.mp4"], "tags": ["Red Dress"]})
        check("removing uses the same normalization", lib.tags("a.mp4") == ["cyber"],
              str(lib.tags("a.mp4")))
    finally:
        lib.close()


def test_bad_tag_names_are_rejected():
    lib = Library(["a.mp4"])
    try:
        for bad in ("a,b", "a/b", "   ", "__untagged__"):
            resp = lib.client.post("/api/tags", json={"item_ids": ["a.mp4"], "tags": [bad]})
            check(f"{bad!r} rejected with a message",
                  resp.status_code == 400 and "error" in (resp.get_json() or {}),
                  f"code {resp.status_code}")
        check("nothing was saved", lib.tags("a.mp4") == [], str(lib.tags("a.mp4")))
    finally:
        lib.close()


def test_existing_tags_are_normalized_on_load():
    meta = {"last_scan": None, "items": {
        "a.mp4": {"tags": ["Cyberpunk", "cyberpunk", "Red Dress"], "type": "video",
                  "prompt": "kept by scan"}}}
    lib = Library(["a.mp4"], meta=meta)
    try:
        check("old tags normalized and merged", lib.tags("a.mp4") == ["cyberpunk", "red-dress"],
              str(lib.tags("a.mp4")))
        check("extra fields from other tools kept",
              lib.meta()["items"]["a.mp4"].get("prompt") == "kept by scan")
    finally:
        lib.close()


def test_folder_tags_are_normalized():
    lib = Library(["Red Dress/Studio A/x.mp4"])
    try:
        check("folder names become normalized tags",
              lib.tags("Red Dress/Studio A/x.mp4") == ["red-dress", "studio-a"],
              str(lib.tags("Red Dress/Studio A/x.mp4")))
    finally:
        lib.close()


# ---------------------------------------------------------------------------
# Renames
# ---------------------------------------------------------------------------
def test_moved_file_keeps_its_tags():
    lib = Library(["old/clip.mp4", "other.mp4"])
    try:
        lib.client.post("/api/tags", json={"item_ids": ["old/clip.mp4"], "tags": ["keeper"]})
        os.makedirs(os.path.join(lib.media, "new"))
        os.replace(os.path.join(lib.media, "old", "clip.mp4"),
                   os.path.join(lib.media, "new", "clip.mp4"))
        lib.client.post("/api/scan")
        check("moved file keeps its tags", lib.tags("new/clip.mp4") == ["keeper", "old"],
              str(lib.tags("new/clip.mp4")))
        check("old path is gone", lib.tags("old/clip.mp4") is None)
    finally:
        lib.close()


def test_ambiguous_move_does_not_guess():
    """Two same-name, same-size files vanish and reappear: don't guess which is which."""
    lib = Library(["x/clip.mp4", "y/clip.mp4"])
    try:
        lib.client.post("/api/tags", json={"item_ids": ["x/clip.mp4"], "tags": ["from-x"]})
        os.makedirs(os.path.join(lib.media, "z1"))
        os.makedirs(os.path.join(lib.media, "z2"))
        os.replace(os.path.join(lib.media, "x", "clip.mp4"),
                   os.path.join(lib.media, "z1", "clip.mp4"))
        os.replace(os.path.join(lib.media, "y", "clip.mp4"),
                   os.path.join(lib.media, "z2", "clip.mp4"))
        lib.client.post("/api/scan")
        check("no tags carried when the match is ambiguous",
              "from-x" not in (lib.tags("z1/clip.mp4") or [])
              and "from-x" not in (lib.tags("z2/clip.mp4") or []),
              f"z1 {lib.tags('z1/clip.mp4')}, z2 {lib.tags('z2/clip.mp4')}")
    finally:
        lib.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
TESTS = [
    test_concurrent_tagging_keeps_every_tag,
    test_tag_added_during_scan_survives,
    test_unreadable_file_is_never_overwritten,
    test_save_waits_for_a_reader,
    test_delete_refuses_paths_outside_media_folder,
    test_bad_page_size_does_not_crash,
    test_tags_are_normalized,
    test_bad_tag_names_are_rejected,
    test_existing_tags_are_normalized_on_load,
    test_folder_tags_are_normalized,
    test_moved_file_keeps_its_tags,
    test_ambiguous_move_does_not_guess,
]


def main() -> None:
    words = sys.argv[1:]
    selected = [t for t in TESTS if not words or any(w in t.__name__ for w in words)]
    for test in selected:
        run(test)
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
