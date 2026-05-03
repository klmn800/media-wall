# PRD: Media Wall

## 1. Introduction/Overview

**Media Wall** is a local, browser-based media viewer that displays images and videos in an elegant, edge-to-edge grid — inspired by Grok Imagine's wall layout. The primary goal is a beautiful, immersive viewing experience: minimal chrome, autoplay videos on scroll, and a full-screen feel. A lightweight tagging system lets users organize files by project or session without the rigidity of folders.

The tool runs locally as a Python web server, opens in the user's default browser, and reads media files from a designated directory on disk.

## 2. Goals

1. **Immersive viewing**: A dense, beautiful masonry/grid wall that fills the browser viewport with media — minimal borders, no wasted space.
2. **Effortless video playback**: All videos autoplay (muted) as they scroll into view and pause when they scroll out.
3. **Click-to-isolate**: Clicking any media item opens it in a focused, full-size lightbox view. Videos in the lightbox can be unmuted.
4. **Tagging**: Users can assign one or more text tags to any media item for grouping and filtering.
5. **Sorting & filtering**: Sort by date, name, or file type. Filter by tag, media type (image/video), or search by filename.
6. **Autoscroll**: A toggleable autoscroll mode that slowly scrolls the wall — hands-free viewing.
7. **Distraction-free UI**: Settings, filters, and controls are collapsible or on a separate page so the wall itself dominates the screen.

## 3. User Stories

- **As a user**, I want to open Media Wall in my browser and see all my Grok Imagine creations displayed in a beautiful grid, so I can browse them visually.
- **As a user**, I want videos to silently play as I scroll past them, so I can preview motion content without clicking each one.
- **As a user**, I want to click any image or video to see it full-size in a lightbox, so I can examine details and hear video audio.
- **As a user**, I want to tag items (e.g., "cyberpunk-city", "session-march-2", "favorites") so I can group related creations across different dates.
- **As a user**, I want to filter the wall by tag so I only see items from a specific project or session.
- **As a user**, I want to sort by date (newest/oldest first) or by name, so I can find things quickly.
- **As a user**, I want an autoscroll mode so I can sit back and watch my creations scroll by like a gallery.
- **As a user**, I want the controls to get out of the way so the media fills my screen.

## 4. Functional Requirements

### 4.1 Media Scanning & Import
1. The system must scan a configurable directory (and subdirectories) for supported media files.
2. Supported image formats: `.jpg`, `.jpeg`.
3. Supported video formats: `.mp4`.
4. The system must detect new, removed, and changed files on each scan (or on manual refresh).
5. The system must extract the first frame of each video as a poster image for initial grid rendering before the video scrolls into view.

### 4.2 Grid/Wall Layout
6. Media items must be displayed in a true masonry layout (variable row heights, no cropping) to handle mixed aspect ratios gracefully.
7. Images in the grid should be optimized for grid display (resized to ~1200px wide) for performance. Full-resolution originals are served only in the lightbox. The browser's zoom level controls how many items fit side-by-side (e.g., zoomed out = 4 across, zoomed in = 2-3 across). A base column width setting controls the default density.
8. Gaps between items must be minimal (configurable, default ~2px).
9. The grid must fill the full browser viewport width and height — no sidebar, no header by default.
10. The grid must support lazy loading — only render/fetch media near the viewport.
11. Items must be loaded in paginated batches (e.g., 50-100 at a time) via infinite scroll — not all at once. A "Load More" trigger (automatic or manual) fetches the next batch as the user approaches the bottom.

### 4.3 Video Autoplay & Memory Management
12. Videos must autoplay (muted, no controls visible) when they scroll into the viewport.
13. Videos must pause when they scroll out of the viewport.
14. Videos that have scrolled fully out of view must be unloaded (video source removed, poster frame retained) to free memory. The source reloads automatically when the video scrolls back into view.
15. Autoplay and unloading must use the Intersection Observer API for efficiency.

### 4.4 Click-to-Isolate (Lightbox)
16. Clicking any grid item must open a centered lightbox/modal overlay.
17. Images in the lightbox must display at full original resolution (fit to screen).
18. Videos in the lightbox must display with full playback controls (play/pause, seek, volume).
19. Videos in the lightbox must default to unmuted.
20. The lightbox must support left/right navigation (arrow keys or buttons) to step through items. When filters are active, navigation steps through only the filtered set.
21. Pressing Escape or clicking outside the lightbox must close it.
22. The lightbox must show file path information so the user knows where the file lives on disk.

### 4.5 Tagging System
23. Each media item can have zero or more text tags.
24. Tags are stored in a local metadata file (JSON or SQLite) alongside the media directory.
25. Users can add/remove tags from the lightbox view.
26. Users can create new tags on the fly (no predefined tag list required).
27. Tag data must persist across server restarts.
28. Tags must be visible on grid items only on hover — never permanently overlaid on the media.
29. A "Select Mode" toggle activates multi-select: clicks become selections with visible checkboxes. A bulk action bar appears with options to tag or delete selected items.

### 4.6 File Management
30. Users can delete files from the lightbox or via bulk selection in Select Mode.
31. Deleting moves files to a `.trash/` subfolder within the media directory (not permanent deletion). Files can be recovered by manually moving them back.
32. The `.trash/` folder is excluded from media scanning.
33. A confirmation dialog is required before any delete action (single or bulk).

### 4.7 Sorting & Filtering
34. The system must support sorting by: date modified (default), filename, file size, file type.
35. The system must support filtering by: tag (select one or more), media type (images only / videos only / all).
36. A search box must allow filtering by filename substring.
37. Active filters must be clearly indicated and easy to clear.

### 4.8 Autoscroll
38. A toggle button must activate autoscroll mode.
39. Autoscroll must smoothly scroll the wall downward at an adjustable speed.
40. Autoscroll speed must be adjustable in real-time via a slider in the control panel while autoscroll is running.
41. Any user scroll input (mouse wheel, touchpad, arrow keys) must pause autoscroll.
42. Reaching the bottom should either stop or loop back to top (configurable).

### 4.9 UI & Controls
43. A collapsible control panel (slide-in drawer or top bar) must house sorting, filtering, search, and settings.
44. The control panel must be hidden by default, toggled via a small button or keyboard shortcut.
45. A settings area (within the panel or a separate page) must allow configuring: media directory path, grid gap size, autoscroll speed, base column width.
46. The UI must use a dark theme by default (media-focused, reduces glare).

### 4.10 Backend
47. The backend must be a Python web server (Flask).
48. The backend must serve media files (optimized for grid + full-res for lightbox), video poster frames, and a REST API for metadata (tags, file listings, settings).
49. The backend must support a `/api/scan` endpoint to trigger a rescan of the media directory.
50. The backend must read configuration from a `config.ini` file.

## 5. Non-Goals (Out of Scope)

- **Editing media**: No cropping, filters, or image manipulation.
- **Cloud sync or hosting**: This is strictly local.
- **User accounts or authentication**: Single-user, local app.
- **Folder-based organization**: Files stay where they are on disk; organization is via tags only.
- **Mobile-optimized layout**: Desktop browser only (though basic responsiveness is fine).
- **Batch import from Grok Imagine**: No API integration — user downloads files manually.
- **Database beyond metadata**: No full-text search, no ML-based features.

## 6. Design Considerations

- **Dark theme**: Dark background (#0a0a0a or similar) so media pops. Minimal UI chrome.
- **Inspiration**: Grok Imagine's wall layout — dense grid, minimal gaps, autoplay on scroll.
- **Typography**: Clean sans-serif for any text overlays (tags, filenames). Keep text minimal.
- **Lightbox**: Semi-transparent dark overlay. Centered media. Clean close button.
- **Controls**: Subtle, semi-transparent toggle button in a corner. Panel slides in from left or top.
- **Animations**: Smooth transitions for lightbox open/close, panel slide, autoscroll. No flashy effects.

## 7. Technical Considerations

- **Stack**: Python (Flask) backend + vanilla HTML/CSS/JS frontend. No framework dependencies.
- **Video poster frames**: Extract first frame using `opencv-python-headless` (pip-installable, no system dependency). Cache in a `.posters/` subdirectory within the media directory.
- **Grid images**: Optimized/resized versions (~1200px wide) for the grid. Full-resolution originals served only in the lightbox. Optimized versions cached in a `.optimized/` subdirectory.
- **Metadata storage**: JSON file (`media_wall_meta.json`) in the media directory — simple, portable, human-readable.
- **Masonry layout**: Use CSS `columns` property for true masonry. Natively supported in all modern browsers, requires no JS library, handles variable aspect ratios perfectly. Column width is configurable (controls density), and browser zoom naturally changes how many columns fit.
- **Performance**: Lazy loading (`loading="lazy"`) for images. Intersection Observer for video autoplay/unload (videos fully unloaded when off-screen, poster frame retained, source reloaded on re-entry). Paginated infinite scroll loads items in batches of ~50-100.
- **File deletion**: Soft delete — moves files to `.trash/` subfolder. `.trash/` excluded from scanner.
- **Subdirectories**: Scanner flattens all subdirectories into one wall. Folder structure on disk is ignored for organization (tags handle that). File path shown in lightbox for reference.
- **File watching**: Not required for v1 — manual "Refresh" button triggers rescan.
- **Existing patterns**: Follow Solutions Laboratory style guide — single entry point, CLI-friendly, config.ini, comprehensive docstrings.

## 8. Success Metrics

- The wall loads and displays 500+ media items without noticeable lag.
- Videos autoplay/pause smoothly on scroll with no stuttering.
- A user can tag, filter, and find specific items within seconds.
- The UI feels immersive — media dominates the screen, controls stay out of the way.
- The tool is self-contained and launchable with a single command (`python media_wall.py`).

## 9. Resolved Questions

1. **Grid image size**: Optimized (~1200px wide) for grid performance, full-res in lightbox. Browser zoom controls density. *Resolved.*
2. **Video poster frames**: First frame via opencv-python-headless — these are Grok Imagine videos where the first frame is the source image. *Resolved.*
3. **Tag UI in grid**: Hover-only — tags appear on mouseover, hidden otherwise. *Resolved.*
4. **Bulk tagging**: Multi-select via "Select Mode" toggle + bulk tag/delete. *Resolved.*
5. **Masonry vs. fixed grid**: True masonry via CSS `columns`. *Resolved.*
6. **Supported formats**: `.jpg`/`.jpeg` and `.mp4` only (Grok Imagine outputs). *Resolved.*
7. **Clicking videos**: Click = lightbox. Videos pause naturally on scroll-out. *Resolved.*
8. **Multi-select UX**: "Select Mode" toggle button — clicks become selections with checkboxes. *Resolved.*
9. **Subdirectories**: Scanned and flattened. No folder-based organization. File path shown in lightbox. *Resolved.*
10. **Lightbox navigation with filters**: Steps through filtered set only. *Resolved.*
11. **File deletion**: Soft delete to `.trash/` subfolder. Available in lightbox and bulk select. Confirmation required. *Resolved.*
12. **Video memory management**: Videos unloaded (source removed) when off-screen, poster retained, reloaded on scroll-back. *Resolved.*
13. **Autoscroll speed**: Adjustable in real-time via slider in control panel. *Resolved.*
14. **Infinite scroll pagination**: Items loaded in batches (~50-100), not all at once. *Resolved.*

## 10. Post-Launch Enhancements

Features added after initial implementation based on user testing:

1. **Tag exclusion** — Three-state tag filter cycle: neutral (gray) → include (blue) → exclude (red with strikethrough) → neutral. Exclude hides items matching the tag. Backend `exclude_tags` query param added.
2. **Global video pause** — "Pause All Videos" button in control panel + `V` keyboard shortcut. Freezes all grid video autoplay.
3. **Video play delay** — Configurable delay (None / 0.5s / 1s / 2s / 3s) before videos start playing after scrolling into view. If user scrolls past before delay expires, video never starts. Reduces visual noise when browsing quickly.
4. **Lightbox video loop toggle** — Loop button in lightbox info bar (videos only). Blue when active. Setting persists across lightbox navigation.
5. **Autoscroll fix** — Changed from `window.scrollBy()` (fractional pixels rounded to 0) to `document.documentElement.scrollTop` with sub-pixel accumulator. Changed `body { height: 100% }` to `min-height: 100vh` to prevent scroll blocking. Panel auto-closes when autoscroll starts.
