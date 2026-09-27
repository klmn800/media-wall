"""Headless-browser checks of the wall, lightbox, and tagging UI.

Builds a throwaway library of small JPEGs in a temp folder, starts the server
on it with a scratch --config (never the real config.ini), opens the page in
headless Edge, and drives it over the DevTools protocol.

Usage:
    python tests/browser_test.py

Needs Microsoft Edge and the websocket-client package.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "media_wall.py")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 5071  # not 5060/5061: Chromium blocks those as "unsafe ports"
DEBUG_PORT = 9361
N_FILES = 120  # more than two pages at the default batch size of 50

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


class Page:
    """Minimal DevTools-protocol client: evaluate JS in the page."""

    def __init__(self, debug_port: int, url_part: str):
        deadline = time.time() + 20
        while True:
            try:
                tabs = json.load(urllib.request.urlopen(
                    f"http://127.0.0.1:{debug_port}/json", timeout=1))
                tab = next(t for t in tabs
                           if t.get("type") == "page" and url_part in t.get("url", ""))
                break
            except Exception:
                if time.time() > deadline:
                    raise
                time.sleep(0.3)
        self.ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=30)
        self.next_id = 0

    def eval(self, js: str):
        """Run an async JS function body in the page and return its value."""
        self.next_id += 1
        self.ws.send(json.dumps({
            "id": self.next_id, "method": "Runtime.evaluate",
            "params": {"expression": f"(async () => {{ {js} }})()",
                       "awaitPromise": True, "returnByValue": True},
        }))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.next_id:
                break
        result = msg.get("result", {})
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("exception", {})
                               .get("description", str(result["exceptionDetails"])))
        return result.get("result", {}).get("value")


# JS helpers installed once in the page.
HELPERS = """
window.__errors = [];
window.addEventListener("error", e => __errors.push(String(e.message)));
window.addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
window.sleep = ms => new Promise(r => setTimeout(r, ms));
window.settle = async () => { for (let i = 0; i < 100 && Wall.isLoading; i++) await sleep(50); await sleep(150); };
window.cellIds = () => [...document.querySelectorAll("#media-grid .grid-item")].map(c => c.dataset.itemId);
window.showSet = async () => {
    Controls.activeFilterTags = new Set(["set"]); Controls.excludeFilterTags = new Set();
    Wall.params.search = ""; Controls._syncTagParams(); await reloadGrid(); await settle();
};
window.loadAll = async () => { for (let i = 0; i < 20 && Wall.hasMore; i++) { await loadNextPage(); await settle(); } };
window.confirmDialog = async () => {
    for (let i = 0; i < 40; i++) {
        if (document.getElementById("confirm-dialog").classList.contains("active")) break;
        await sleep(25);
    }
    document.getElementById("confirm-dialog-confirm").click();
};
return true;
"""


def run_checks(page: Page) -> None:
    page.eval(HELPERS)

    print("\nstale results from an older filter")
    r = page.eval("""
        await showSet();
        // Start a load for filter A, then switch to filter B before it returns.
        reloadGrid();
        Wall.params.search = "img_007";
        await reloadGrid(); await settle(); await sleep(500);
        const ids = cellIds();
        return {ids, items: Wall.items.map(i => i.id)};
    """)
    check("grid shows only the newer filter's results",
          r["ids"] and all("img_007" in i for i in r["ids"]), f"{len(r['ids'])} cells")
    check("no duplicate items", len(set(r["items"])) == len(r["items"]),
          f"{len(r['items'])} items, {len(set(r['items']))} unique")

    print("\ndelete in the lightbox")
    r = page.eval("""
        await showSet(); await loadNextPage(); await settle();
        const before = Wall.items.map(i => i.id);
        window.scrollTo(0, 1500); await sleep(100);
        const scrollBefore = window.scrollY;
        Lightbox.open(before[60]);
        const p = Tags.deleteCurrent(before[60]); await confirmDialog(); await p; await settle();
        const shown = Lightbox.currentId;
        Lightbox.close(); await sleep(100);
        const scrollAfter = window.scrollY;
        const cellsAfter = cellIds().length;
        await loadAll();
        const all = Wall.items.map(i => i.id);
        return {expected: before[61], shown, scrollBefore, scrollAfter,
                cellsBefore: before.length, cellsAfter,
                total: all.length, unique: new Set(all).size, stillThere: all.includes(before[60])};
    """)
    check("lightbox moves to the next item", r["shown"] == r["expected"],
          f"showed {r['shown']}, expected {r['expected']}")
    check("grid keeps everything already loaded, minus the deleted tile",
          r["cellsAfter"] == r["cellsBefore"] - 1, f"{r['cellsBefore']} -> {r['cellsAfter']}")
    check("scroll position kept", abs(r["scrollAfter"] - r["scrollBefore"]) < 50,
          f"{r['scrollBefore']} -> {r['scrollAfter']}")
    check("deleted item gone", not r["stillThere"])
    check("paging after delete skips nothing and repeats nothing",
          r["total"] == N_FILES - 1 and r["unique"] == r["total"],
          f"{r['total']} items, {r['unique']} unique, expected {N_FILES - 1}")

    print("\nlightbox steps past the loaded page")
    r = page.eval("""
        await showSet();
        const last = Wall.items[Wall.items.length - 1].id;
        const count = Wall.items.length;
        Lightbox.open(last);
        const nextVisible = document.getElementById("lightbox-next").style.display !== "none";
        Lightbox.navigate(1); await settle();
        const moved = Lightbox.currentId !== last;
        Lightbox.close();
        return {count, nextVisible, moved};
    """)
    check("next button shown on the last loaded item", r["nextVisible"])
    check("next loads the following page and moves on", r["moved"],
          f"{r['count']} loaded before")

    print("\nselect mode")
    r = page.eval("""
        await showSet();
        const btn = document.getElementById("select-mode-btn");
        btn.click();
        const labelOn = btn.textContent.trim();
        Tags.toggleItem(Wall.items[0].id); Tags.toggleItem(Wall.items[1].id);
        Tags._openTagDialog(); await sleep(150);
        document.getElementById("tag-dialog-input").value = "picked";
        await Tags._executeBulkTag(); await sleep(200);
        return {labelOn, label: btn.textContent.trim(), selectMode: Tags.selectMode,
                tagged: Wall.items.slice(0, 2).every(i => i.tags.includes("picked"))};
    """)
    check("bulk tag applied", r["tagged"])
    check("select mode button label matches the mode after a bulk tag",
          r["labelOn"] == "Exit Select Mode"
          and (r["label"] == "Select Mode") == (not r["selectMode"]),
          f"on: {r['labelOn']!r}, after: {r['label']!r}, selectMode {r['selectMode']}")

    print("\nnew tags and bad tags")
    r = page.eval("""
        await showSet();
        const id = Wall.items[0].id;
        await Tags._addTagsToItems([id], ["Brand New"]); await sleep(300);
        const suggested = Controls.availableTags.some(t => t.name === "brand-new");
        await Tags._addTagsToItems([id], ["a,b"]); await sleep(200);
        const toast = document.querySelector(".toast.active");
        return {suggested, local: Wall.items[0].tags, toast: toast ? toast.textContent : null};
    """)
    check("new tag is suggested right away", r["suggested"])
    check("local tags use the saved (normalized) name", "brand-new" in r["local"],
          str(r["local"]))
    check("a rejected tag shows a message", bool(r["toast"]), str(r["toast"]))

    print("\ntag names with quotes")
    r = page.eval("""
        await showSet();
        const id = Wall.items[0].id;
        await Tags._addTagsToItems([id], ['it\\'s "quoted"']); await sleep(300);
        const tag = Wall.items[0].tags.find(t => t.includes("quoted"));
        const chip = [...document.querySelectorAll(".tag-filter-btn")].find(b => b.dataset.tag === tag);
        Lightbox.open(id); await sleep(100);
        const removeBtn = [...document.querySelectorAll("#lightbox-tags .tag-remove")]
            .find(b => b.dataset.tag === tag);
        if (removeBtn) { removeBtn.click(); await sleep(300); }
        const removed = !Wall.items[0].tags.includes(tag);
        Lightbox.close();
        return {tag, chip: !!chip, removeBtn: !!removeBtn, removed};
    """)
    check("filter chip carries the exact tag name", r["chip"], str(r["tag"]))
    check("lightbox remove button carries the exact tag name", r["removeBtn"])
    check("the tag can be removed from the lightbox", r["removed"])

    print("\nkeyboard")
    r = page.eval("""
        if (!Controls.panelOpen) Controls.togglePanel();
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await sleep(100);
        return {panelOpen: Controls.panelOpen};
    """)
    check("Esc closes the panel", not r["panelOpen"])

    errors = page.eval("return __errors;")
    check("no JavaScript errors", not errors, "; ".join(errors or [])[:300])


def make_library(root: str) -> str:
    media = os.path.join(root, "media")
    os.makedirs(os.path.join(media, "set"))
    for i in range(N_FILES):
        img = Image.new("RGB", (40, 30 + (i % 5) * 10), (i * 2 % 255, 80, 160))
        path = os.path.join(media, "set", f"img_{i:03d}.jpg")
        img.save(path)
        # Spread modified times so the default sort (newest first) is stable.
        t = 1_700_000_000 + i * 60
        os.utime(path, (t, t))
    return media


def main() -> None:
    if not os.path.exists(EDGE):
        sys.exit(f"Edge not found at {EDGE}")
    root = tempfile.mkdtemp(prefix="mw_browser_")
    media = make_library(root)
    log = open(os.path.join(root, "server.log"), "w")
    server = subprocess.Popen(
        [sys.executable, APP, "--media-dir", media, "--no-browser", "--port", str(PORT),
         # never read or write the user's real config.ini
         "--config", os.path.join(root, "config.ini")],
        stdout=log, stderr=log)
    edge = None
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/tags", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        edge = subprocess.Popen(
            [EDGE, "--headless=new", f"--remote-debugging-port={DEBUG_PORT}",
             "--remote-allow-origins=*", "--window-size=1400,900", "--no-first-run",
             f"--user-data-dir={os.path.join(root, 'edge')}", f"http://127.0.0.1:{PORT}/"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page = Page(DEBUG_PORT, f":{PORT}/")
        for _ in range(50):
            if page.eval("return typeof Controls !== 'undefined' && !!document.getElementById('control-panel');"):
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("page never finished loading")
        run_checks(page)
    except Exception as e:
        check("browser test ran to the end", False, f"{type(e).__name__}: {e}")
    finally:
        if edge:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(edge.pid)], capture_output=True)
        server.kill()
        log.close()
        time.sleep(0.5)
        shutil.rmtree(root, ignore_errors=True)

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
