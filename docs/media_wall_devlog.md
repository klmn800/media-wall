# Media Wall - development log

Media Wall is a local Flask app that shows a folder of `.jpg`/`.mp4` files as a masonry wall in
the browser, with tagging, filtering, a lightbox, and soft delete. Beat Wall (`../beat_wall/`)
reads its tag file. This log records how it got built, one entry per work day: facts, decisions
with the reasons given at the time, measurements, and corrections. Entries are not revised
after the fact; later findings go in the entry for the day they were found.

Work days before 2026-09-26 (2026-05-03 and 2026-05-04, commits `73cc994` through `ae8c2a1`)
are not logged here. Their record is the git history, `0001-prd-media-wall.md`, and
`tasks-0001-prd-media-wall.md`.

## 2026-09-26 - Codebase review and bug-fix run: tag-file safety, tag normalization, wall fixes, cleanup, tests

Commits: 1e981bd through 30fcfca (8)
Sessions: session_016nd2tYgRXSoZuBa1ymyuDW (Beat Wall session, commit `1e981bd` only, 09:41; logged in `../beat_wall/docs/beat_wall_devlog.md`, 2026-09-25 entry), 74f7f4ee-d1ab-4739-a88f-f2026b061eb3 (Opus 5.5, 23:06-23:47)
Transcripts: ~/.claude/projects/E--solutions-laboratory-media-wall/74f7f4ee-d1ab-4739-a88f-f2026b061eb3.jsonl
Related: `TAGGING_REVIEW.md` (item 1 marked fixed), `CLAUDE.md` (hard rules, architecture), `README.md` (Tagging section), `tests/test_backend.py`, `tests/browser_test.py`

### Starting state
The last code change was `ae8c2a1` (2026-05-04). At 09:41 a Beat Wall session committed
`TAGGING_REVIEW.md` and a one-item `CLAUDE.md` (`1e981bd`). The review measured a tag-wipe bug:
with 4 or 8 concurrent tag requests on 200 clips, the metadata file ended with 0 items. It also
listed tagging friction. Nothing had been fixed. The repo had no tests.

### Work
- 23:06, `/init`: Claude expanded `CLAUDE.md` with commands, the backend's
  load-change-save-per-request pattern, the metadata format as a contract with Beat Wall, and
  the frontend module and load order (`ae6131b`).
- 23:10-23:14: Ben asked for a codebase review. Claude read every JS file and the backend
  routes in full, and skimmed the PRD. It then wrote a scratchpad probe (not committed) that ran
  the Flask app in-process on a temp library to test its backend claims before reporting (see
  Measurements). The reply grouped findings as:
  - data safety: tag added during a scan is lost; folder rename loses tags; delete accepts
    `../` paths
  - wrong behavior: lightbox delete jumps to the first item and wipes scroll; overlapping
    filter changes mix results; "can't view the whole library once everything is tagged"
    (withdrawn later, see Corrections); tag names with `/`, `,`, `<`, and case variants
    break things
  - smaller: Select Mode label, Esc on the panel, `per_page=0`, silent save failures,
    config comments stripped
  - cruft: the `Lightbox._displayItem` monkey-patch, three `_escapeHtml` copies, `typeof`
    guards, the no-op slider listener, orphaned cache files, hard-coded `favorites`
  Claude marked each claim as tested or read-only.
- 23:17-23:20: Ben asked how the codebase got this way. Claude's reply cited:
  - the single 4,926-line initial commit `73cc994`, with all 57 task boxes ticked
  - ticked tasks not implemented: 8.7 (delete moves caches), 8.9 (Esc closes panel, `?`
    button), 5.3 (preload adjacent), 7.5 (search clear button), and 7.3 (OR logic; the code
    is AND)
  - "Verify" steps that were happy-path demos, and a PRD with no data-integrity requirement
    beyond persistence
  - path-keyed tags contradicting the PRD's "tags only" non-goal
  - post-launch features added locally
  - `ae8c2a1`'s reload-after-delete fix producing the lightbox and scroll regressions
  Claude said a stronger model under the same process would make fewer errors of the same
  kinds. Claude also said the process fix was per-task commits, scripted verification, and
  data-safety requirements in the PRD. Ben declined to pursue the process topic in this
  session (see Ben's words).
- 23:28-23:31: Claude read `../beat_wall/CLAUDE.md` and `PROJECT.md` for the commit rules and
  proposed a four-phase run. Each phase paired with a test that fails first. Ben answered the
  three open questions (see Decisions).
- Phase 0: test script `tests/test_backend.py` (12 checks, throwaway temp libraries, in-process
  app) and hard rules in `CLAUDE.md`, committed failing (`3778318`).
- Phase 1, tag-file safety (`7d389f1`):
  - `_metadata_lock` around every load-change-save
  - `save_metadata` writes a temp file and `os.replace`s it, retrying up to 3 s on
    `PermissionError`
  - `load_metadata` raises `MetadataError` instead of returning an empty library; an error
    handler returns 500
  - startup scan logs the error and keeps serving
  - scan generates posters and grid images outside the lock, then loads, merges and saves
    under it
  - `_match_moved_files` carries tags across moves
  - delete accepts only IDs present in the metadata
  - `per_page` clamped to 1..500
- Phase 2, tag names (`e966d45`):
  - `normalize_tag()` for API input; `clean_stored_tags()` converts stored and folder-name
    tags on load
  - tag endpoints return the saved names, and the page uses them
  - the filter bar escapes tag names and search text, and shows "(untagged)" instead of the
    sentinel
- Phase 3, the wall (`ad969b5`). Claude wrote `tests/browser_test.py` first: headless Edge on a
  120-JPEG temp library, driven over the DevTools protocol with the already-installed
  `websocket-client`. Fixes:
  - `/api/media` changed from `page` to `offset`, and `Wall.currentPage` was removed
  - `Wall.generation` discards stale fetches
  - delete removes tiles in place, and `/api/delete` returns `deleted_ids`
  - lightbox `show()`/`releaseMedia()`; `navigate()` loads the next batch past the last
    loaded item; delete shows the following item
  - `showToast()`/`responseError()` for all failures; the new tag is suggested right away;
    Refresh reloads tags
  - Select Mode label follows the mode; Esc closes the panel; `_move_with_retry` on delete
  The browser test was not committed separately before the fix; its failing counts on the
  old code are in the commit message.
- Phase 4, cleanup. The added tests were committed failing (`4ed619c`); the fixes landed in
  `30fcfca`:
  - cache files removed on delete, and orphaned ones removed on scan
  - `save_config` rewrites only the `media_directory` line, in UTF-8;
    `_read_config_text` falls back to the Windows codepage
  - one `escapeHtml()` in `wall.js` that escapes quotes
  - lightbox calls `Tags._renderLightboxTagEditor` directly (monkey-patch removed)
  - `typeof` guards, the no-op listener and the `.lightbox-no-tags` CSS removed;
    `FAVORITES_TAG` constant
  - `CLAUDE.md` architecture, `README.md` Tagging section and `TAGGING_REVIEW.md` item 1
    status updated in the same commit
- Dead end (tooling): a scripted string replace into `browser_test.py` failed its match
  assertion; the same insert was then made with the Edit tool.

### Decisions
- **Tags are normalized**: trim, lowercase, and runs of spaces/hyphens become one hyphen.
  - Ben, 23:17: "normalize tags yes." On hyphens, Ben asked (23:31): "maybe hyphens to replace
    spaces to show the tag as one tag? Is that good practice?"
  - Claude answered yes, citing Stack Overflow- and Instagram-style tags, and implemented it.
  - `,`, `/`, `\`, the `__untagged__` sentinel, empty names, and names over 64 characters are
    rejected with a 400. Claude proposed the `,`/`/` rejection in the plan; the backslash and
    length limit are Claude's, not reviewed. Reason given: commas split filter params and the
    bulk box, and slashes break `/api/tags/<name>`.
  - Stored tags are converted, not rejected (forbidden characters become hyphens). Claude, not
    reviewed; reason given in the code: so no tagging work is lost.
- **The blank wall stays.** Ben, 23:17 (see Ben's words). Claude replied that the existing
  pinned "(untagged)" chip already does this, and withdrew review item 6. Recorded in memory
  file `wall-and-tag-decisions.md`.
- **Moved files keep their tags.** Claude proposed matching on filename + size; Ben, 23:31:
  "1. Yes".
  - Only one-to-one matches carry. Ambiguous cases carry nothing (Claude, not reviewed).
  - The carried file keeps its old tags, including old folder auto-tags, and gets no new
    folder auto-tag (Claude, not reviewed; no reason stated).
- **Commit rules copied from Beat Wall** (Ben asked, 23:28): stage by name, no `git add -A`,
  commit and push at checkpoints, test only on scratch media and config.
- **Scan split rather than one lock over the whole scan** (Claude). Reason given in the review
  reply: a lock held for a minutes-long scan would freeze tagging.
- **An unreadable tag file doesn't stop the server**; each request that needs the file returns
  the error (Claude, not reviewed).
- **Offset-based paging** instead of reloading the grid after a delete (Claude, in the plan
  Ben approved at 23:28).
- **Tests are plain scripts, and failing tests are committed before fixes** (Claude). The
  browser test uses the DevTools protocol with no new dependency: Playwright and Selenium were
  not installed, and `websocket-client` was.
- **Inline `;` comments in config.ini are out of scope.** Claude found that its own config
  test used one. configparser would read it as part of the value and `getint` would fail. The
  test was changed rather than the parser (Claude, not reviewed).
- **Beat Wall's folder-name fallback left as is.** `clip_tags()` in `beat_wall.py` builds tags
  from raw folder names for clips Media Wall hasn't scanned, so they won't match normalized
  tags. Claude noted it in a reply as a follow-up for the Beat Wall repo and did not change it.
- **Tagging-friction features deferred** to a second run after Ben uses the fixed version
  (Claude proposed; Ben did not object).
- **Devlog set up** (Ben, 23:31: "3. Yes please").

### Measurements
- Scratchpad probe (in-process Flask test client, temp library), 23:14:
  - a video in folder `café` got a poster that was generated and served (200)
  - `per_page=0` returned 500
  - global delete of tag `a/b` returned 404
  - filtering on tag `x,y` returned 0 items, although the item had that tag
  - deleting `../outside.mp4` moved a file from outside the media folder
    (`{'deleted': 1, 'errors': []}`)
  - a tag added during a scan slowed to 1 s per poster was present right after the POST and
    gone after the scan finished
  - after renaming folder `café` to `renamed`, the clip's tags were `['renamed']` (its
    `keeper` tag was lost)
- `tests/test_backend.py` on the pre-fix code (`3778318`): 12 passed, 21 failed. Concurrent
  tagging, 200 files with 8 workers: 0 items left in the file, 0/200 kept their tag, and every
  request returned 200.
- The reader check ("save waits for a reader") passed on the pre-fix code, because the old
  code wrote the file in place. Standalone check: `os.replace` onto a file open for reading
  raised `PermissionError` (winerror 5). So the check exercises the new retry path.
- After `7d389f1`: 23/23 on the phase-1 checks. After `e966d45`: 33/33.
- `tests/browser_test.py` on the pre-fix frontend: 8 passed, 7 failed (15 checks). After two
  checks were strengthened (see Corrections): 4 passed, 12 failed (16 checks). After
  `ad969b5`: 16/16 in 4 consecutive runs.
- Delete while the lightbox shows the file (image, headless Edge): 5 of 5 deletes succeeded.
- Cleanup-phase tests before `30fcfca`:
  - 5 backend checks failed; the config check crashed with `UnicodeDecodeError` reading
    `config.ini` as UTF-8, because the old `save_config` wrote `Café` in the Windows codepage
  - 3 browser checks failed on a tag containing `"`
  After `30fcfca`: backend 41/41, browser 19/19 in 2 runs.

### Corrections
- **Review item 6 withdrawn.** Claude's review reply said you "can't view the whole library
  once everything is tagged" and that exclude-only filters showing nothing contradicted the
  README. Ben's 23:17 answer defined the empty wall as intended. Claude replied that the
  existing "(untagged)" chip already covers his requirement and dropped the item.
- **Wrong cause for Edge failing to load.** In replies, Claude first attributed Edge's "can't
  reach this page" to a proxy setting or this tool's sandbox.
  - `--no-proxy-server` did not help, and neither did running outside the sandbox.
  - The cause was the test port 5061, which Chromium blocks as an "unsafe port" (SIP-TLS).
    The port changed to 5071, with a comment in the test.
  - Caught by Claude.
- **Two browser checks passed for the wrong reason** on the old code:
  - Select Mode was entered through code, so the label never changed.
  - The scroll check passed because page 1 alone was taller than 1,500 px.
  Claude caught both and rewrote them: click the real button, and count grid tiles
  (100 -> 50 on the old code). Both then failed on the old code.
- **Flaky delete on the old code, cause not established.** "Deleted item gone" passed on one
  run and failed on the next.
  - Claude's hypothesis, stated in a reply, was a Windows file lock held while the lightbox
    showed the image.
  - A probe of 5 deletes with the lightbox open all succeeded, so the hypothesis did not hold.
  - The old code discarded delete errors, so there was no record of the failure.
  - After the fixes, 6 later runs passed that check.
- **Non-ASCII posters**: Claude's reasoning (not a reply) suspected OpenCV would fail on
  non-ASCII paths on Windows. The probe showed it works, and the reply listed it under
  "Checked and fine".

### Ben's words
- 23:10, opening the review: "Before we do anything, you're a smarter model compared to the one we used to build this. Review the codebase and check for potential bugs, errors, bad practices, overcomplications, cruft, etc... just take a pass over it and see if the design matches the intention and if there are obvious issues we also need to address"
- 23:17, answering the two open decisions: "normalize tags yes. if no tags are picked, wall should show... nothing. BUT we need a way to still display items with no tags. that way, we open to a blank screen, and select tags to add things to the screen. Besides, we'll want to be able to identify untagged items, because that means we have work to do to tag them."
- 23:17: "How do you think the current state, containing so much cruft and incorrect behavior, came about given the design plan and history that you can see?"
- 23:28, quoting Claude's "That's why I tested the backend claims last turn before stating them, and I didn't state some claims until I had.": "That ALONE is evidence of your superiority of a model, and why it's important to the development process. But you're right, the process is flawed. We definitely bolted things on without a more disciplined plan. I did this one pretty quickly. We really don't have much discipline in the development process. Not really something I want to focus on here, maybe another instance."
- 23:28: "We will adhere to standing commit rules ( see beat_wall for latest rules and copy over if needed) so we keep a strong record. May even use the dev log skill."
- 23:28: "Anyway - knowing the current situation, how do you propose we fix them? can we do a big bug fix run?"
- 23:31: "2. Yes - but maybe hyphens to replace spaces to show the tag as one tag? Is that good practice?"

### Open at end of day
- `TAGGING_REVIEW.md` section 2 friction items remain, planned as a second run after Ben uses
  the fixed version:
  - tag box loses focus; no key into the tag box; no one-key tags
  - loop off by default; Select Mode exits after each bulk tag
  - no shift-click or select-all; no hover tags in Select Mode; no bulk remove or undo
- Also from section 2: Media Wall's `favorites` tag and Beat Wall's fav mark are unrelated
  ("Worth deciding" in the review).
- Beat Wall `clip_tags()` folder-name fallback does not normalize (Beat Wall repo).
- The delete precautions for videos have not been tested with real videos: releasing the
  video before delete, and `_move_with_retry`. Commit `ad969b5` calls them a precaution.
- Not yet run on Ben's real library. The first load will rewrite his stored tags in normalized
  form and merge case variants.
- Inline `;` comments in `config.ini` are not supported.
- `renderBatch` skips repeated IDs. If tagging changes an item's filter membership mid-scroll,
  one item can still be skipped. Claude noted this in its reasoning only, not in a reply;
  untested.
