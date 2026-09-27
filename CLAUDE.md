# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- **At the start of a new session, read `TAGGING_REVIEW.md` and bring it up with Ben.** It is
  a tagging review written from a Beat Wall session (2026-09-25). It includes a measured bug
  that can wipe every tag. Beat Wall's clip budgeting depends on tags, so this work comes
  first.

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
python tests/test_backend.py     # backend checks against throwaway libraries in a temp folder
```

There is no linter or JS build step. `tests/test_backend.py` is a plain script (no pytest):
it prints PASS/FAIL per check and exits non-zero on any failure.

## Architecture

**Backend: `media_wall.py`, one file.**
- `perform_scan()` walks the media folder (skipping `.trash`, `.posters`, `.optimized`), makes
  poster frames (OpenCV) and ~1200px grid copies (Pillow), and merges the results into the
  metadata. It runs once at startup inside `create_app()` and again on `POST /api/scan`.
- A new file gets **auto-tags from its subfolder names** (`a/b/x.mp4` gets `["a","b"]`). A file
  already in the metadata keeps its tags. Entries for files that are gone get dropped.
- **No in-memory state for media.** Every request calls `load_metadata()` and every change
  calls `save_metadata()`. Filtering, sorting, and paging for `/api/media` happen in Python on
  each request. This load/change/save pattern with no lock is the root of the bug in
  `TAGGING_REVIEW.md` item 1.
- The active media folder lives in `app.config["MEDIA_DIR"]` (read through `_media_dir()`), so
  `/api/set-media-dir` can switch folders at runtime and save the choice to `config.ini`.
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
all caches stale.

**Frontend: plain JS, no framework, no bundler.** `templates/index.html` is almost empty. It
passes a `CONFIG` object from `config.ini`, then loads the scripts in this order: `wall.js`,
`video.js`, `lightbox.js`, `autocomplete.js`, `tags.js`, `controls.js`. Each file defines one
global object (`Wall`, `VideoManager`, `Lightbox`, `Autocomplete`, `Tags`, `Controls`), and they
call each other directly. `controls.js` builds the control panel in the DOM and calls
`Controls.init()` last, which starts the app. Load order matters when you add a module.

- `Wall` owns paging (`/api/media`, infinite scroll) and the list of loaded items. The lightbox
  can only step through items already loaded.
- `Controls` owns the filter/sort/search state and the tag list (`Controls.availableTags`,
  loaded by `_loadTags`). The autocomplete reads from that list.
- The wall starts empty on purpose. Nothing loads until the user picks a filter.

## Other docs

- `README.md`: user-facing features, shortcuts, and the API table.
- `TAGGING_REVIEW.md`: open bug and tagging-friction list (see top).
- `0001-prd-media-wall.md`, `tasks-0001-prd-media-wall.md`: the original PRD and task list.
  These are a historical record, not a spec for current behavior.
