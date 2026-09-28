# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- **At the start of a new session, read `TAGGING_REVIEW.md` and bring it up with Ben.** It is
  a tagging review written from a Beat Wall session (2026-09-25). Item 1 (the tag wipe) was
  fixed in the 2026-09-26 bug-fix run. The tagging-friction items in section 2 are still open,
  and Beat Wall's clip budgeting depends on tags, so they come next.
  Correction (2026-09-28): the review says "two overlapping writes are enough"; only 1, 4
  and 8 at once were measured, never 2.

## Hard rules

1. **Never test against Ben's real media folder or his `config.ini`.** The app writes into
   the media folder (`media_wall_meta.json`, caches, `.trash/`), and the folder switcher
   rewrites `config.ini`. Tests build throwaway libraries in a temp folder and never pass a
   real config path.
2. **Never `git add -A` or `git add .`.** Read `git status` and stage files by name. Media
   files in a test folder must never reach a commit.
3. Otherwise commit freely: git is Ben's backup. Commit to `main` at every natural checkpoint
   without asking, tests or no tests, and push after each commit.
4. `media_wall_meta.json` is read by Beat Wall (`../beat_wall/`). Keep its shape stable:
   `items` keyed by relative path, `tags` as a list of normalized strings, extra fields kept.

## What this is

Media Wall is a local Flask app that shows a folder of `.jpg`/`.mp4` files as a masonry wall in
the browser. It has tagging, filtering, a lightbox, and soft delete. It is its own git repo
(`klmn800/media-wall`). The sibling tool **Beat Wall** (`../beat_wall/`) reads this app's
`media_wall_meta.json` read-only, so the metadata format is a contract with another tool.

## Commands

```bash
pip install -r requirements.txt
cp config.ini.example config.ini          # config.ini is gitignored; blank media_directory opens a folder picker

python media_wall.py                      # uses config.ini
python media_wall.py --media-dir "C:/clips" --port 8080 --no-browser
python media_wall.py --config C:/scratch/test.ini   # scratch config, keeps the real one untouched

build.bat                                 # PyInstaller one-file exe -> dist/media_wall.exe
```

```bash
python tests/test_backend.py          # backend checks against throwaway libraries in a temp folder
python tests/test_backend.py scan     # only checks whose name contains "scan"
python tests/browser_test.py          # headless Edge drives the real page on a temp library
```

There is no linter or JS build step. Both test files are plain scripts (no pytest): they
print PASS/FAIL per check and exit non-zero on any failure. `browser_test.py` needs Edge and
`websocket-client`. It drives the page over the DevTools protocol, calling the page's own
globals (`Wall`, `Tags`, `Lightbox`, ...) from JS snippets. Its server port avoids 5060/5061,
which Chromium blocks as "unsafe ports" (the page just fails to load).

## Architecture

**Backend: `media_wall.py`, one file.**
- `perform_scan()` walks the media folder (skipping `.trash`, `.posters`, `.optimized`), makes
  poster frames (OpenCV) and ~1200px grid copies (Pillow), and merges the results into the
  metadata. It runs once at startup inside `create_app()` and again on `POST /api/scan`.
  The slow part (posters, grid images) runs without the lock; the merge and save run under it.
- A new file gets **auto-tags from its subfolder names** (`a/b/x.mp4` gets `["a","b"]`). A file
  already in the metadata keeps its tags. A file that moved keeps its tags when its filename
  and size match exactly one vanished file (`_match_moved_files`). Entries for files that are
  gone get dropped, and cache files nothing points to are deleted.
- **No in-memory state for media.** Every request loads the metadata file, and every change
  saves it. **Every load-change-save must hold `_metadata_lock`**: Flask serves requests on
  several threads, and without the lock overlapping saves wipe each other. `save_metadata()`
  writes a temp file and `os.replace()`s it in, retrying while Windows reports the file open
  (Beat Wall reads it). `load_metadata()` raises `MetadataError` on an unreadable file, and
  never falls back to an empty library. An error handler turns that into a 500 with the reason.
- **Tag names are normalized on the server** by `normalize_tag()`: trim, lowercase, and
  runs of spaces/hyphens become one hyphen. `,`, `/`, `\` and the untagged sentinel are
  rejected with a 400. Stored tags and folder-name tags go through `clean_stored_tags()`,
  which converts instead of rejecting. Tag endpoints return the saved names, and the page
  uses those.
- `/api/media` pages by `offset` (skip N matching items), not by page number, so a delete
  doesn't shift what the next fetch returns.
- The active media folder lives in `app.config["MEDIA_DIR"]` (read through `_media_dir()`), so
  `/api/set-media-dir` can switch folders at runtime and save the choice to `config.ini`.
  `save_config()` rewrites only the `media_directory` line (UTF-8), so Ben's comments survive.
- `/api/pick-folder` runs `media_wall.py --pick-folder` again as a subprocess. That keeps
  tkinter off Flask's worker threads.
- `get_bundle_dir()` / `get_app_dir()` handle PyInstaller: templates and static files come from
  `sys._MEIPASS`, and `config.ini` sits next to the exe.

**Metadata (`<media_dir>/media_wall_meta.json`):** `{"last_scan": ..., "items": {"<relative/path
with forward slashes>": {"tags": [...], "type", "size", "modified", "filename",
"poster_filename" | "optimized_filename", ...}}}`. The key is the item's id everywhere, including
the frontend. The scan keeps any extra fields that other tools add (see `SCAN_FIELDS`). Keep
that behavior.

`__untagged__` (`UNTAGGED_SENTINEL`) is a virtual tag for the "(untagged)" filter chip. It is
never stored.

Cache file names are `<stem>_<md5(absolute path)[:8]>.jpg`. Moving the media folder makes
all caches stale (the next scan regenerates them and deletes the old ones).

**Frontend: plain JS, no framework, no bundler.** `templates/index.html` is almost empty. It
passes a `CONFIG` object from `config.ini`, then loads the scripts in this order: `wall.js`,
`video.js`, `lightbox.js`, `autocomplete.js`, `tags.js`, `controls.js`. Each file defines one
global object (`Wall`, `VideoManager`, `Lightbox`, `Autocomplete`, `Tags`, `Controls`), and they
call each other directly. Each module's `init()` runs on `DOMContentLoaded`, in load order.
`wall.js` also defines the shared helpers `escapeHtml()` (safe inside quoted attributes too),
`showToast()` and `responseError()`. Any failed request should end in a toast; never swallow
errors silently.

- `Wall` owns paging (`/api/media`, infinite scroll) and the list of loaded items. Every
  `reloadGrid()` bumps `Wall.generation`, and a fetch that returns for an older generation is
  thrown away. A delete removes its tiles in place and never reloads the grid. The lightbox
  loads the next batch when you step past the last loaded item.
- `Lightbox._displayItem` calls `Tags._renderLightboxTagEditor` to fill in the tag editor.
- `Controls` owns the filter/sort/search state and the tag list (`Controls.availableTags`,
  loaded by `_loadTags`). The autocomplete reads from that list.
- The wall starts empty on purpose. Nothing loads until the user picks an include tag.
  Ben wants this: he builds up the wall by picking tags. The pinned "(untagged)" chip shows
  untagged items, and that doubles as his list of clips still to tag. Don't "fix" it.

## Other docs

- `README.md`: user-facing features, shortcuts, and the API table.
- `TAGGING_REVIEW.md`: tagging-friction list (see top); item 1 is fixed.
- `0001-prd-media-wall.md`, `tasks-0001-prd-media-wall.md`: the original PRD and task list.
  These are a historical record, not a spec for current behavior.
