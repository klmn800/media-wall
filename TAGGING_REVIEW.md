# Tagging Review (2026-09-25)

Written from a Beat Wall session. Beat Wall reads Media Wall's tags (read-only) and will use
them to steer its edits, so Ben will soon be tagging hundreds of clips here. This review looked
for anything that makes tagging many clips in one sitting slow or unsafe. Nothing has been
changed yet. Fix item 1 before anything that makes tagging faster.

## 1. Tags can be wiped out (measured, fix first)

`save_metadata()` truncates `media_wall_meta.json` and rewrites it, with no lock. Flask serves
requests on several threads at once. `load_metadata()` returns an EMPTY library when it can't
read the file, and every tag endpoint then saves what it loaded. So if one request reads the
file while another is halfway through writing it, the whole library is saved as empty.

Test: 200 empty `.mp4` files in a temp folder, server on a scratch `--config`, one tag
request per clip.

| Requests at the same time | Clips that kept their tag | Items left in the file |
| --- | --- | --- |
| 1 | 200 / 200 | 200 |
| 4 | 0 / 200 | **0** |
| 8 | 0 / 200 | **0** |

The server log showed 151 "Failed to load metadata" errors. In real use, two overlapping writes
are enough: double-clicking a heart, or tagging while Refresh Library is scanning.

Suggested fix:
- One lock around every load, change, and save (tag add/remove, global remove, delete, scan).
- Save to a temp file, then `os.replace()` it over the real one. On Windows, retry briefly if
  the replace fails because another program (such as Beat Wall) has the file open for reading.
- If the file exists but can't be read, refuse to save and report an error. Never write
  "empty" over a file that couldn't be read.

## 2. Friction when tagging many clips

**Lightbox (one clip at a time, the closest match to tagging with folders):**
- Adding a tag rebuilds the tag editor, so the text box loses focus after every tag.
- No key puts you in the tag box, and the arrow keys don't move to the next clip while you're
  typing. Every clip needs the mouse, typing, and an arrow key.
- There are no one-key tags. An idea: number keys 1-9 each turn one tag on or off (the tag for
  each key set in the page), with an option to move to the next clip on its own.
- Video loop is off by default, so short clips stop and have to be restarted.
- Next/previous only moves through clips already loaded (50 per page) and stops there, even
  when more clips match the filter.

**Suggestions for new tags:**
- A tag you just created isn't suggested on the next clip. The suggestion list
  (`Controls.availableTags`) only refreshes when the Controls panel is opened.

**Select Mode (tagging many at once):**
- It turns off after every bulk tag, so you have to press `S` again for the next batch.
- There's no shift-click to select a range, and no select-all.
- Tags don't show on hover in Select Mode, so you can't see what the selected clips already
  have.
- You can add tags in bulk but not remove them. There's no undo.

**Worth deciding:** Media Wall's `favorites` tag and Beat Wall's fav mark have nothing to do
with each other.

## Where things are

- Saving and loading: `load_metadata` / `save_metadata` in `media_wall.py`; tag routes
  `/api/tags` (GET, POST, DELETE) and `/api/tags/<name>`.
- Lightbox tag editor: `Tags._renderLightboxTagEditor` in `static/js/tags.js`; navigation in
  `static/js/lightbox.js`.
- Suggestion list: `static/js/autocomplete.js`, fed by `Controls._loadTags` in
  `static/js/controls.js`.
