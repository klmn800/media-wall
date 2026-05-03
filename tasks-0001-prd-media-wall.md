# Tasks: Media Wall

Generated from [0001-prd-media-wall.md](0001-prd-media-wall.md)

## Relevant Files

- `media_wall/media_wall.py` - Main Flask application and CLI entry point (single-file design per style guide)
- `media_wall/static/css/style.css` - Dark theme, masonry layout, lightbox, control panel styles
- `media_wall/static/js/wall.js` - Grid rendering, infinite scroll, lazy loading, pagination
- `media_wall/static/js/video.js` - Video autoplay, pause, unload/reload via Intersection Observer
- `media_wall/static/js/lightbox.js` - Lightbox overlay, navigation, full-res display, delete UI
- `media_wall/static/js/tags.js` - Tag CRUD, hover display, Select Mode, bulk actions
- `media_wall/static/js/controls.js` - Control panel, sorting, filtering, search, autoscroll
- `media_wall/templates/index.html` - Main page template (Jinja2)
- `media_wall/config.ini` - Default configuration (media directory, grid gap, column width, port, etc.)
- `media_wall/requirements.txt` - Python dependencies (Flask, Pillow, opencv-python-headless)
- `media_wall/.gitignore` - Exclude .trash/, .posters/, .optimized/, __pycache__, config.ini
- `media_wall/README.md` - Comprehensive documentation per style guide

### Notes

- Follow Solutions Laboratory style guide: type hints, docstrings, f-strings, CLI-first
- The frontend is vanilla HTML/CSS/JS — no frameworks, no build tools
- All metadata stored in `media_wall_meta.json` inside the user's media directory
- Optimized images cached in `.optimized/` and video posters in `.posters/` inside the media directory
- Soft-deleted files moved to `.trash/` inside the media directory

## Tasks

- [x] 1.0 Project Scaffolding & Configuration
  - [x] 1.1 Create `media_wall/` directory structure with subdirectories: `static/css/`, `static/js/`, `templates/`
  - [x] 1.2 Create `requirements.txt` with dependencies: Flask, Pillow, opencv-python-headless
  - [x] 1.3 Create `.gitignore` excluding `.trash/`, `.posters/`, `.optimized/`, `__pycache__/`, `*.pyc`, `config.ini`, `media_wall_meta.json`
  - [x] 1.4 Create `config.ini` with default settings: media_directory (empty — user must set), port (5000), grid_gap (2), column_width (350), autoscroll_speed (2), batch_size (50)
  - [x] 1.5 Create `media_wall.py` Flask app skeleton with: config loading, argument parsing (--port, --media-dir, --open-browser), app factory, and `if __name__ == '__main__'` entry point that auto-opens browser
  - [x] 1.6 Create `templates/index.html` base template with dark theme viewport, linked CSS/JS files, and an empty grid container
  - [x] 1.7 Create `static/css/style.css` with dark theme base styles (body background #0a0a0a, no margin/padding, box-sizing, sans-serif font)

- [x] 2.0 Media Scanning & Backend API
  - [x] 2.1 Implement `scan_media_directory()` function: walk configured directory recursively, find all `.jpg`/`.jpeg`/`.mp4` files, exclude `.trash/`, `.posters/`, `.optimized/` subdirectories, collect file metadata (path, name, size, modified date, type)
  - [x] 2.2 Implement `generate_poster_frame(video_path)` function: use opencv-python-headless to extract first frame of each `.mp4`, save as `.jpg` in `.posters/` subdirectory, skip if poster already exists and video hasn't changed
  - [x] 2.3 Implement `generate_optimized_image(image_path)` function: use Pillow to resize images to ~1200px wide (maintaining aspect ratio), save in `.optimized/` subdirectory as JPEG (quality 85), skip if optimized version already exists and source hasn't changed
  - [x] 2.4 Implement metadata persistence: load/save `media_wall_meta.json` with file list, tags per file (keyed by relative path), and last scan timestamp. On rescan, detect added/removed/changed files and update metadata accordingly (preserve existing tags for unchanged files)
  - [x] 2.5 Create `GET /api/media` endpoint: return paginated list of media items (sorted by date modified descending by default), each item includes: id, filename, relative_path, type (image/video), size, modified_date, tags, optimized_url, original_url, poster_url (for videos). Accept query params: page, per_page, sort_by, sort_order, filter_type, filter_tags, search
  - [x] 2.6 Create `POST /api/scan` endpoint: trigger a full rescan of the media directory, return updated item count and any new/removed files
  - [x] 2.7 Create routes to serve media files: `/media/optimized/<path>` for grid images, `/media/original/<path>` for lightbox full-res, `/media/poster/<path>` for video poster frames
  - [x] 2.8 Verify scanning works end-to-end: start server, point at a test directory with a few JPEGs and MP4s, confirm `/api/media` returns correct data, confirm optimized images and poster frames are generated

- [x] 3.0 Masonry Grid & Infinite Scroll
  - [x] 3.1 In `wall.js`, implement `fetchMedia(page)` function: call `/api/media` with current page number, sort, and filter params, return parsed JSON response
  - [x] 3.2 Implement `renderBatch(items)` function: for each media item, create a grid cell element — `<img>` for images (using optimized URL, `loading="lazy"`) or `<video>` for videos (poster frame as poster attribute, no src yet — video.js handles loading)
  - [x] 3.3 In `style.css`, implement CSS `columns` masonry layout on the grid container: `column-width` set from config, `column-gap` set from config, items set to `break-inside: avoid`, `width: 100%`, minimal margin-bottom matching gap
  - [x] 3.4 Implement infinite scroll: use Intersection Observer on a sentinel element at the bottom of the grid. When sentinel becomes visible, fetch next page. Show a subtle loading indicator while fetching. Stop when server returns no more items
  - [x] 3.5 Wire up initial page load: on DOMContentLoaded, fetch first batch, render it, activate infinite scroll observer
  - [x] 3.6 Verify masonry grid displays correctly with mixed-aspect-ratio images, browser zoom changes column count, and infinite scroll loads additional batches

- [x] 4.0 Video Autoplay & Memory Management
  - [x] 4.1 In `video.js`, create an Intersection Observer that watches all `<video>` elements in the grid
  - [x] 4.2 When a video scrolls into view (threshold ~0.3): set its `src` attribute to the actual video URL, call `video.play()` (muted, loop), hide native controls
  - [x] 4.3 When a video scrolls out of view: call `video.pause()`, then remove the `src` attribute and call `video.load()` to free memory (poster frame remains visible)
  - [x] 4.4 Ensure newly rendered videos (from infinite scroll batches) are automatically registered with the observer
  - [x] 4.5 Verify videos autoplay on scroll-in, pause and unload on scroll-out, and reload cleanly when scrolled back into view

- [x] 5.0 Lightbox / Click-to-Isolate
  - [x] 5.1 In `lightbox.js`, create lightbox overlay HTML structure: dark semi-transparent backdrop, centered media container, close button (X), left/right navigation arrows, file info bar (filename, path, tags)
  - [x] 5.2 Implement `openLightbox(itemId)`: find item in current (filtered) media list, display full-res original image or video with full controls (unmuted). Pause any grid video that was playing
  - [x] 5.3 Implement left/right navigation: arrow keys and click on nav buttons step through the current filtered media list only. Preload adjacent items for smooth transitions
  - [x] 5.4 Implement close: Escape key, click outside media, or click X button. Resume grid video autoplay behavior on close
  - [x] 5.5 Display file info in lightbox: filename, full disk path, and assigned tags
  - [x] 5.6 Verify lightbox opens on click, displays full-res, navigates through filtered set, and closes cleanly

- [x] 6.0 Tagging & Select Mode
  - [x] 6.1 Create tag API endpoints: `POST /api/tags` (add tags to items — accepts list of item IDs + list of tags), `DELETE /api/tags` (remove tags from items), `GET /api/tags` (list all unique tags with item counts)
  - [x] 6.2 In `tags.js`, implement hover tag display on grid items: on mouseenter, show a small overlay with the item's tags (if any) at the bottom of the cell. Hide on mouseleave. Style as semi-transparent dark chips
  - [x] 6.3 Implement tag editing in lightbox: show current tags as removable chips, plus an input field to type and add new tags. Changes saved immediately via API
  - [x] 6.4 Implement Select Mode: a toggle button (visible in the control panel or as a floating button). When active: cursor changes, clicks toggle item selection (checkbox overlay appears on each item), a bulk action bar appears at the bottom of the screen with item count, "Tag" button, "Delete" button, and "Cancel" button
  - [x] 6.5 Implement bulk tag action: clicking "Tag" in the bulk action bar opens a dialog to enter tags. Submitting applies those tags to all selected items via API. Deselects all items after success
  - [x] 6.6 Verify: hover shows tags, lightbox tag editing works, Select Mode enables multi-select, bulk tagging applies to all selected items

- [x] 7.0 Sorting, Filtering & Search
  - [x] 7.1 In `controls.js`, create the collapsible control panel: a slide-in drawer from the left side, toggled by a small semi-transparent gear/hamburger icon fixed in the top-left corner. Panel overlays the grid (doesn't push it)
  - [x] 7.2 Add sort controls to the panel: dropdown or button group for sort field (Date Modified, Filename, File Size, File Type) and sort direction toggle (ascending/descending). Changing sort re-fetches media from API with new sort params
  - [x] 7.3 Add tag filter to the panel: list all available tags (fetched from `GET /api/tags`). Clicking a tag toggles it as a filter. Multiple tags can be active (OR logic — show items matching any selected tag). Active tags visually highlighted
  - [x] 7.4 Add media type filter: button group for All / Images Only / Videos Only. Filters applied client-side or via API param
  - [x] 7.5 Add search box: text input that filters by filename substring. Debounced (300ms) to avoid excessive API calls. Clears with an X button
  - [x] 7.6 Add active filter indicators: when any filter is active, show a small badge or pill bar above/below the grid (outside the panel) indicating what's filtered, with a "Clear All" button
  - [x] 7.7 Ensure lightbox navigation respects all active filters (sort order + filters determine the navigation sequence)
  - [x] 7.8 Verify: panel opens/closes smoothly, sorting re-orders the grid, tag and type filters work, search narrows results, filters can be cleared

- [x] 8.0 Autoscroll, Delete & Polish
  - [x] 8.1 In `controls.js`, implement autoscroll toggle: a play/pause button in the control panel. When active, page smoothly scrolls downward using `requestAnimationFrame`
  - [x] 8.2 Add autoscroll speed slider to the control panel: adjustable in real-time while autoscroll is running. Range from very slow to moderate speed
  - [x] 8.3 Implement autoscroll pause on user input: any mouse wheel, touchpad scroll, or arrow key press pauses autoscroll (toggle button reflects paused state)
  - [x] 8.4 Implement bottom behavior: when autoscroll reaches the bottom, loop back to top smoothly (default) or stop (configurable in settings)
  - [x] 8.5 Implement single delete from lightbox: a delete button in the lightbox file info area. Clicking shows a confirmation dialog ("Move to trash?"). On confirm, calls `POST /api/delete` which moves file to `.trash/`, advances lightbox to next item
  - [x] 8.6 Implement bulk delete from Select Mode: the "Delete" button in the bulk action bar shows confirmation ("Move N items to trash?"). On confirm, calls API to move all selected files to `.trash/`. Removes items from grid, deselects all
  - [x] 8.7 Create `POST /api/delete` endpoint: accepts list of item IDs, moves each file (and its optimized/poster versions) to `.trash/`, updates metadata JSON, returns success/failure
  - [x] 8.8 Add settings section to the control panel: inputs for grid gap and base column width (apply immediately), autoscroll speed slider, keyboard shortcuts reference
  - [x] 8.9 Add keyboard shortcuts: `Escape` (close lightbox/panel), `Left/Right` arrows (lightbox navigation), `S` (toggle Select Mode), `Space` (toggle autoscroll), `F` (toggle control panel). Display a small `?` button that shows shortcut reference
  - [x] 8.10 Final UI polish: smooth CSS transitions on all interactive elements (lightbox open/close, panel slide, hover effects), consistent spacing, loading states for API calls, empty states (no media found, no results for filter)
  - [x] 8.11 Create `README.md` with: overview, installation steps (pip install, config), usage examples, feature descriptions, keyboard shortcuts reference, and screenshots placeholder
