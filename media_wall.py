"""Media Wall — Local browser-based media viewer with masonry grid layout.

A Flask web application that displays images and videos in an elegant,
edge-to-edge masonry grid. Features include video autoplay on scroll,
click-to-isolate lightbox, tagging system, sorting/filtering, and autoscroll.

Usage:
    python media_wall.py                          # Start with config.ini settings
    python media_wall.py --media-dir "C:/Photos"  # Override media directory
    python media_wall.py --port 8080              # Override port
    python media_wall.py --no-browser             # Don't auto-open browser
"""

import argparse
import configparser
import hashlib
import json
import logging
import os
import shutil
import sys
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import cv2
from flask import Flask, jsonify, render_template, request, send_from_directory
from PIL import Image, ImageOps

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("media_wall")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DEFAULT_CONFIG = {
    "server": {"port": "5000"},
    "media": {"media_directory": ""},
    "grid": {"column_width": "350", "grid_gap": "2"},
    "autoscroll": {"speed": "2", "bottom_behavior": "loop"},
    "pagination": {"batch_size": "50"},
}


def get_bundle_dir() -> Path:
    """Get the directory containing bundled resources (static/, templates/).

    When running as a PyInstaller .exe, resources are extracted to a
    temporary folder (sys._MEIPASS). When running as a normal Python
    script, they live in the same directory as media_wall.py.
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).parent


def get_app_dir() -> Path:
    """Get the application directory for user-editable files (config.ini).

    When running as a PyInstaller .exe, this is the folder containing
    the .exe itself. When running as a normal Python script, it's the
    same directory as media_wall.py.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def ask_media_directory(welcome: bool = True) -> Optional[str]:
    """Show a folder-picker dialog so the user can choose their media folder.

    Args:
        welcome: When True (first-launch flow), show a welcome messagebox
            before the picker. When False (mid-session "Change Folder"),
            skip straight to the picker — the user is already in the app.

    Returns:
        The selected folder path, or None if the user cancelled.
    """
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)

        if welcome:
            messagebox.showinfo(
                "Media Wall",
                "Welcome to Media Wall!\n\n"
                "Please select the folder containing your images and videos.",
            )
        folder = filedialog.askdirectory(title="Select Media Folder")
        root.destroy()
        return folder if folder else None
    except Exception as e:
        logger.error(f"Could not open folder picker: {e}")
        return None


def ask_media_directory_subprocess() -> Optional[str]:
    """Run the folder picker in a fresh subprocess.

    Tkinter cannot be called from Flask's worker threads — the request
    handler hits "main thread is not in main loop". So when the
    /api/pick-folder endpoint needs the picker, we spawn a child process
    that re-runs this script with --pick-folder, which exits early after
    showing the dialog and printing the chosen path on stdout.

    Returns:
        The selected folder path, or None if cancelled or on error.
    """
    import subprocess

    if getattr(sys, "frozen", False):
        # Frozen exe: relaunch the same exe with the hidden flag.
        cmd = [sys.executable, "--pick-folder"]
    else:
        # Dev mode: relaunch via the python interpreter + this script.
        cmd = [sys.executable, os.path.abspath(__file__), "--pick-folder"]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        logger.warning("Folder picker timed out after 10 minutes.")
        return None
    except Exception as e:
        logger.error(f"Folder picker subprocess failed: {e}")
        return None

    path = result.stdout.strip()
    return path or None


def save_config(config_path: str, config: configparser.ConfigParser) -> None:
    """Write the current configuration back to the INI file.

    This is used to persist the user's chosen media directory (and any
    other settings) so they don't have to pick it again next time.

    Args:
        config_path: Path to the config.ini file.
        config: The ConfigParser instance to save.
    """
    with open(config_path, "w") as f:
        config.write(f)
    logger.info(f"Saved configuration to {config_path}")


def load_config(config_path: str) -> configparser.ConfigParser:
    """Load configuration from INI file, falling back to defaults.

    Args:
        config_path: Path to the config.ini file.

    Returns:
        Populated ConfigParser instance.
    """
    config = configparser.ConfigParser()
    # Set defaults
    for section, values in DEFAULT_CONFIG.items():
        config[section] = values
    # Override with file values if present
    if os.path.exists(config_path):
        config.read(config_path)
        logger.info(f"Loaded config from {config_path}")
    else:
        logger.warning(f"Config file not found at {config_path}, using defaults")
    return config


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SUPPORTED_IMAGES = {".jpg", ".jpeg"}
SUPPORTED_VIDEOS = {".mp4"}
EXCLUDED_DIRS = {".trash", ".posters", ".optimized"}
METADATA_FILENAME = "media_wall_meta.json"
OPTIMIZED_MAX_WIDTH = 1200
OPTIMIZED_QUALITY = 85

# Sentinel value used as a "virtual tag" matching items that have no tags.
# Surfaced to the frontend as a pinned (untagged) filter chip so flat folders
# without any tags can still be included/excluded from the grid.
UNTAGGED_SENTINEL = "__untagged__"


# ---------------------------------------------------------------------------
# Media scanner
# ---------------------------------------------------------------------------
def scan_media_directory(media_dir: str) -> list[dict[str, Any]]:
    """Walk the media directory recursively and find all supported media files.

    Excludes .trash/, .posters/, and .optimized/ subdirectories. Collects
    file metadata for each discovered file.

    Args:
        media_dir: Absolute path to the root media directory.

    Returns:
        List of dicts, each with keys: filename, relative_path, absolute_path,
        type ('image' or 'video'), size (bytes), modified (ISO timestamp).
    """
    media_dir = os.path.normpath(media_dir)
    items = []

    for root, dirs, files in os.walk(media_dir):
        # Prune excluded directories so os.walk doesn't descend into them
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in SUPPORTED_IMAGES and ext not in SUPPORTED_VIDEOS:
                continue

            abs_path = os.path.join(root, filename)
            rel_path = os.path.relpath(abs_path, media_dir)
            stat = os.stat(abs_path)

            items.append({
                "filename": filename,
                "relative_path": rel_path.replace("\\", "/"),
                "absolute_path": abs_path,
                "type": "image" if ext in SUPPORTED_IMAGES else "video",
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })

    logger.info(f"Scanned {media_dir}: found {len(items)} media files")
    return items


# ---------------------------------------------------------------------------
# Poster frame extraction (videos)
# ---------------------------------------------------------------------------
def generate_poster_frame(video_path: str, posters_dir: str) -> Optional[str]:
    """Extract the first frame of a video and save it as a JPEG poster.

    Uses opencv-python-headless to read frame 0. The poster filename is
    derived from the video's relative path to avoid collisions.

    Args:
        video_path: Absolute path to the .mp4 video file.
        posters_dir: Absolute path to the .posters/ cache directory.

    Returns:
        Absolute path to the generated poster JPEG, or None on failure.
    """
    # Build a safe poster filename from the video path hash + original name
    video_name = Path(video_path).stem
    path_hash = hashlib.md5(video_path.encode()).hexdigest()[:8]
    poster_filename = f"{video_name}_{path_hash}.jpg"
    poster_path = os.path.join(posters_dir, poster_filename)

    # Skip if poster already exists and video hasn't been modified since
    if os.path.exists(poster_path):
        if os.path.getmtime(poster_path) >= os.path.getmtime(video_path):
            return poster_path

    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"Could not open video: {video_path}")
            return None

        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            logger.error(f"Could not read first frame: {video_path}")
            return None

        cv2.imwrite(poster_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        logger.info(f"Generated poster: {poster_filename}")
        return poster_path

    except Exception as e:
        logger.error(f"Poster generation failed for {video_path}: {e}")
        return None


# ---------------------------------------------------------------------------
# Image optimization
# ---------------------------------------------------------------------------
def generate_optimized_image(image_path: str, optimized_dir: str) -> Optional[str]:
    """Resize an image to a max width for efficient grid display.

    The original aspect ratio is preserved. Images already smaller than
    OPTIMIZED_MAX_WIDTH are copied as-is. Output is JPEG at quality 85.

    Args:
        image_path: Absolute path to the source image.
        optimized_dir: Absolute path to the .optimized/ cache directory.

    Returns:
        Absolute path to the optimized JPEG, or None on failure.
    """
    image_name = Path(image_path).stem
    path_hash = hashlib.md5(image_path.encode()).hexdigest()[:8]
    opt_filename = f"{image_name}_{path_hash}.jpg"
    opt_path = os.path.join(optimized_dir, opt_filename)

    # Skip if optimized version exists and source hasn't changed
    if os.path.exists(opt_path):
        if os.path.getmtime(opt_path) >= os.path.getmtime(image_path):
            return opt_path

    try:
        with Image.open(image_path) as img:
            # Bake EXIF orientation into the pixels so the saved JPEG
            # displays upright. Without this, phone photos relying on the
            # EXIF Orientation tag appear rotated in the grid.
            img = ImageOps.exif_transpose(img)

            # Convert to RGB if needed (e.g., RGBA PNGs — shouldn't happen
            # with JPEGs but defensive)
            if img.mode != "RGB":
                img = img.convert("RGB")

            # Resize if wider than max
            if img.width > OPTIMIZED_MAX_WIDTH:
                ratio = OPTIMIZED_MAX_WIDTH / img.width
                new_size = (OPTIMIZED_MAX_WIDTH, int(img.height * ratio))
                img = img.resize(new_size, Image.LANCZOS)

            img.save(opt_path, "JPEG", quality=OPTIMIZED_QUALITY)
            logger.info(f"Optimized: {opt_filename}")
            return opt_path

    except Exception as e:
        logger.error(f"Image optimization failed for {image_path}: {e}")
        return None


# ---------------------------------------------------------------------------
# Metadata persistence
# ---------------------------------------------------------------------------
def load_metadata(media_dir: str) -> dict[str, Any]:
    """Load the metadata JSON file from the media directory.

    The metadata file stores tags and scan info. Structure:
    {
        "last_scan": "2026-03-02T...",
        "items": {
            "relative/path/to/file.jpg": {
                "tags": ["tag1", "tag2"]
            }
        }
    }

    Args:
        media_dir: Absolute path to the media directory.

    Returns:
        Metadata dict. Returns empty structure if file doesn't exist.
    """
    meta_path = os.path.join(media_dir, METADATA_FILENAME)
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.error(f"Failed to load metadata: {e}")
    return {"last_scan": None, "items": {}}


def save_metadata(media_dir: str, metadata: dict[str, Any]) -> None:
    """Save the metadata JSON file to the media directory.

    Args:
        media_dir: Absolute path to the media directory.
        metadata: The metadata dict to persist.
    """
    meta_path = os.path.join(media_dir, METADATA_FILENAME)
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
    except OSError as e:
        logger.error(f"Failed to save metadata: {e}")


def perform_scan(media_dir: str) -> dict[str, Any]:
    """Run a full scan: discover files, generate posters/optimized, update metadata.

    This is the main scan orchestrator. It:
    1. Scans the directory for media files
    2. Generates poster frames for videos
    3. Generates optimized versions of images
    4. Merges results with existing metadata (preserving tags)
    5. Removes metadata entries for files that no longer exist

    Args:
        media_dir: Absolute path to the media directory.

    Returns:
        Dict with scan results: total_items, new_items, removed_items.
    """
    # Ensure cache directories exist
    posters_dir = os.path.join(media_dir, ".posters")
    optimized_dir = os.path.join(media_dir, ".optimized")
    os.makedirs(posters_dir, exist_ok=True)
    os.makedirs(optimized_dir, exist_ok=True)

    # Scan for files
    scanned_items = scan_media_directory(media_dir)

    # Load existing metadata
    metadata = load_metadata(media_dir)
    existing_paths = set(metadata["items"].keys())
    scanned_paths = set()

    # Process each discovered file
    for item in scanned_items:
        rel_path = item["relative_path"]
        scanned_paths.add(rel_path)

        # Generate poster frame for videos
        if item["type"] == "video":
            poster_path = generate_poster_frame(item["absolute_path"], posters_dir)
            if poster_path:
                item["poster_filename"] = os.path.basename(poster_path)

        # Generate optimized version for images
        if item["type"] == "image":
            opt_path = generate_optimized_image(item["absolute_path"], optimized_dir)
            if opt_path:
                item["optimized_filename"] = os.path.basename(opt_path)

        # Preserve existing tags, or auto-assign folder-based tags for new items
        if rel_path in metadata["items"]:
            item["tags"] = metadata["items"][rel_path].get("tags", [])
        else:
            # New item — derive tags from subfolder path components.
            # e.g. "cyberpunk/session1/image.jpg" → tags: ["cyberpunk", "session1"]
            # Root-level files get no auto-tags.
            path_parts = rel_path.split("/")
            folder_tags = path_parts[:-1] if len(path_parts) > 1 else []
            item["tags"] = sorted(folder_tags)

        # Update metadata entry, preserving any extra fields (e.g. prompt,
        # created_with) that were added by external tools.
        SCAN_FIELDS = {"tags", "type", "size", "modified", "filename",
                       "poster_filename", "optimized_filename"}
        existing_extra = {
            k: v for k, v in metadata["items"].get(rel_path, {}).items()
            if k not in SCAN_FIELDS
        }
        metadata["items"][rel_path] = {
            "tags": item["tags"],
            "type": item["type"],
            "size": item["size"],
            "modified": item["modified"],
            "filename": item["filename"],
            **existing_extra,
        }
        if "poster_filename" in item:
            metadata["items"][rel_path]["poster_filename"] = item["poster_filename"]
        if "optimized_filename" in item:
            metadata["items"][rel_path]["optimized_filename"] = item["optimized_filename"]

    # Remove entries for files that no longer exist
    removed_paths = existing_paths - scanned_paths
    for path in removed_paths:
        del metadata["items"][path]

    # Update scan timestamp and save
    metadata["last_scan"] = datetime.now().isoformat()
    save_metadata(media_dir, metadata)

    new_items = scanned_paths - existing_paths
    logger.info(
        f"Scan complete: {len(scanned_items)} total, "
        f"{len(new_items)} new, {len(removed_paths)} removed"
    )

    return {
        "total_items": len(scanned_items),
        "new_items": len(new_items),
        "removed_items": len(removed_paths),
    }


# ---------------------------------------------------------------------------
# Flask app factory
# ---------------------------------------------------------------------------
def create_app(config: configparser.ConfigParser, config_path: str = "") -> Flask:
    """Create and configure the Flask application.

    Args:
        config: Application configuration.
        config_path: Path to the config.ini file. Stored on the app so the
            /api/set-media-dir endpoint can persist a new directory choice.

    Returns:
        Configured Flask app instance.
    """
    bundle_dir = get_bundle_dir()
    app = Flask(
        __name__,
        template_folder=str(bundle_dir / "templates"),
        static_folder=str(bundle_dir / "static"),
    )
    app.config["MEDIA_CONFIG"] = config
    app.config["CONFIG_PATH"] = config_path

    # Store media directory path. Held in app.config so the directory can
    # be swapped at runtime via /api/set-media-dir without restarting.
    app.config["MEDIA_DIR"] = config.get("media", "media_directory")

    def _media_dir() -> str:
        """Return the current media directory (mutable via /api/set-media-dir)."""
        return app.config["MEDIA_DIR"]

    # Run initial scan on startup
    logger.info("Running initial media scan...")
    perform_scan(_media_dir())

    # -----------------------------------------------------------------------
    # Routes — Pages
    # -----------------------------------------------------------------------
    @app.route("/")
    def index():
        """Serve the main Media Wall page."""
        return render_template(
            "index.html",
            config={
                "column_width": config.getint("grid", "column_width"),
                "grid_gap": config.getint("grid", "grid_gap"),
                "autoscroll_speed": config.getint("autoscroll", "speed"),
                "bottom_behavior": config.get("autoscroll", "bottom_behavior"),
                "batch_size": config.getint("pagination", "batch_size"),
            },
        )

    # -----------------------------------------------------------------------
    # Routes — Media file serving
    # -----------------------------------------------------------------------
    @app.route("/media/original/<path:filepath>")
    def serve_original(filepath: str):
        """Serve an original full-resolution media file.

        Args:
            filepath: Relative path within the media directory.
        """
        return send_from_directory(_media_dir(), filepath)

    @app.route("/media/optimized/<path:filename>")
    def serve_optimized(filename: str):
        """Serve an optimized (resized) image for grid display.

        Args:
            filename: Filename within the .optimized/ cache directory.
        """
        optimized_dir = os.path.join(_media_dir(), ".optimized")
        return send_from_directory(optimized_dir, filename)

    @app.route("/media/poster/<path:filename>")
    def serve_poster(filename: str):
        """Serve a video poster frame (first frame JPEG).

        Args:
            filename: Filename within the .posters/ cache directory.
        """
        posters_dir = os.path.join(_media_dir(), ".posters")
        return send_from_directory(posters_dir, filename)

    # -----------------------------------------------------------------------
    # Routes — API
    # -----------------------------------------------------------------------
    @app.route("/api/media")
    def api_media():
        """Return a paginated, sorted, filtered list of media items.

        Query parameters:
            page (int): Page number, 1-based. Default 1.
            per_page (int): Items per page. Default from config batch_size.
            sort_by (str): Sort field — 'modified', 'filename', 'size', 'type'.
                           Default 'modified'.
            sort_order (str): 'desc' or 'asc'. Default 'desc'.
            filter_type (str): 'all', 'image', or 'video'. Default 'all'.
            filter_tags (str): Comma-separated tag names. Shows items matching
                               ALL of the specified tags.
            search (str): Filename substring filter (case-insensitive).

        Returns:
            JSON with keys: items (list), page, per_page, total_items,
            total_pages, has_more.
        """
        metadata = load_metadata(_media_dir())
        items_dict = metadata.get("items", {})

        # Build list of items with their relative paths as IDs
        items = []
        for rel_path, data in items_dict.items():
            item = {
                "id": rel_path,
                "filename": data.get("filename", os.path.basename(rel_path)),
                "relative_path": rel_path,
                "type": data.get("type", "image"),
                "size": data.get("size", 0),
                "modified": data.get("modified", ""),
                "tags": data.get("tags", []),
            }

            # Add serving URLs
            if item["type"] == "image":
                opt_filename = data.get("optimized_filename")
                if opt_filename:
                    item["grid_url"] = f"/media/optimized/{opt_filename}"
                else:
                    item["grid_url"] = f"/media/original/{rel_path}"
                item["full_url"] = f"/media/original/{rel_path}"
            else:
                item["grid_url"] = f"/media/original/{rel_path}"
                item["full_url"] = f"/media/original/{rel_path}"
                poster_filename = data.get("poster_filename")
                if poster_filename:
                    item["poster_url"] = f"/media/poster/{poster_filename}"

            items.append(item)

        # --- Filtering ---
        filter_type = request.args.get("filter_type", "all")
        if filter_type in ("image", "video"):
            items = [i for i in items if i["type"] == filter_type]

        filter_tags = request.args.get("filter_tags", "")
        if filter_tags:
            raw = {t.strip() for t in filter_tags.split(",") if t.strip()}
            include_untagged = UNTAGGED_SENTINEL in raw
            real_tags = raw - {UNTAGGED_SENTINEL}
            if include_untagged and real_tags:
                # Contradictory: an untagged item can't also have a real tag.
                items = []
            elif include_untagged:
                items = [i for i in items if not i["tags"]]
            else:
                items = [i for i in items if real_tags <= set(i["tags"])]

        exclude_tags = request.args.get("exclude_tags", "")
        if exclude_tags:
            raw = {t.strip() for t in exclude_tags.split(",") if t.strip()}
            exclude_untagged = UNTAGGED_SENTINEL in raw
            real_excludes = raw - {UNTAGGED_SENTINEL}
            if exclude_untagged:
                items = [i for i in items if i["tags"]]
            if real_excludes:
                items = [i for i in items if not (real_excludes & set(i["tags"]))]

        search = request.args.get("search", "").strip().lower()
        if search:
            items = [i for i in items if search in i["filename"].lower()]

        # --- Sorting ---
        sort_by = request.args.get("sort_by", "modified")
        sort_order = request.args.get("sort_order", "desc")
        reverse = sort_order == "desc"

        if sort_by == "filename":
            items.sort(key=lambda i: i["filename"].lower(), reverse=reverse)
        elif sort_by == "size":
            items.sort(key=lambda i: i["size"], reverse=reverse)
        elif sort_by == "type":
            items.sort(key=lambda i: i["type"], reverse=reverse)
        else:  # default: modified
            items.sort(key=lambda i: i["modified"], reverse=reverse)

        # --- Pagination ---
        page = max(1, request.args.get("page", 1, type=int))
        per_page = request.args.get(
            "per_page",
            config.getint("pagination", "batch_size"),
            type=int,
        )
        total_items = len(items)
        total_pages = max(1, (total_items + per_page - 1) // per_page)
        start = (page - 1) * per_page
        end = start + per_page
        page_items = items[start:end]

        return jsonify({
            "items": page_items,
            "page": page,
            "per_page": per_page,
            "total_items": total_items,
            "total_pages": total_pages,
            "has_more": page < total_pages,
        })

    @app.route("/api/scan", methods=["POST"])
    def api_scan():
        """Trigger a full rescan of the media directory.

        Returns:
            JSON with scan results: total_items, new_items, removed_items.
        """
        result = perform_scan(_media_dir())
        return jsonify(result)

    @app.route("/api/tags", methods=["GET"])
    def api_tags_list():
        """List all unique tags with item counts.

        Returns:
            JSON with key 'tags': list of {name, count} dicts, sorted by name.
        """
        metadata = load_metadata(_media_dir())
        tag_counts: dict[str, int] = {}
        untagged_count = 0
        for data in metadata["items"].values():
            item_tags = data.get("tags", [])
            if not item_tags:
                untagged_count += 1
            for tag in item_tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

        tags = [{"name": name, "count": count}
                for name, count in sorted(tag_counts.items())]
        # Pin a virtual (untagged) entry at the top when there are any
        # untagged items, so users in flat folders have a visibility lever.
        if untagged_count > 0:
            tags.insert(0, {
                "name": UNTAGGED_SENTINEL,
                "count": untagged_count,
                "virtual": True,
            })
        return jsonify({"tags": tags, "untagged_sentinel": UNTAGGED_SENTINEL})

    @app.route("/api/tags", methods=["POST"])
    def api_tags_add():
        """Add tags to one or more media items.

        Request body (JSON):
            item_ids (list[str]): Relative paths of items to tag.
            tags (list[str]): Tag names to add.

        Returns:
            JSON with 'updated' count.
        """
        body = request.get_json()
        if not body:
            return jsonify({"error": "Request body required"}), 400

        item_ids = body.get("item_ids", [])
        new_tags = body.get("tags", [])
        if not item_ids or not new_tags:
            return jsonify({"error": "item_ids and tags required"}), 400

        metadata = load_metadata(_media_dir())
        updated = 0
        for item_id in item_ids:
            if item_id in metadata["items"]:
                existing = set(metadata["items"][item_id].get("tags", []))
                existing.update(new_tags)
                metadata["items"][item_id]["tags"] = sorted(existing)
                updated += 1

        save_metadata(_media_dir(), metadata)
        return jsonify({"updated": updated})

    @app.route("/api/tags", methods=["DELETE"])
    def api_tags_remove():
        """Remove tags from one or more media items.

        Request body (JSON):
            item_ids (list[str]): Relative paths of items to untag.
            tags (list[str]): Tag names to remove.

        Returns:
            JSON with 'updated' count.
        """
        body = request.get_json()
        if not body:
            return jsonify({"error": "Request body required"}), 400

        item_ids = body.get("item_ids", [])
        remove_tags = set(body.get("tags", []))
        if not item_ids or not remove_tags:
            return jsonify({"error": "item_ids and tags required"}), 400

        metadata = load_metadata(_media_dir())
        updated = 0
        for item_id in item_ids:
            if item_id in metadata["items"]:
                existing = set(metadata["items"][item_id].get("tags", []))
                metadata["items"][item_id]["tags"] = sorted(
                    existing - remove_tags
                )
                updated += 1

        save_metadata(_media_dir(), metadata)
        return jsonify({"updated": updated})

    @app.route("/api/tags/<tag_name>", methods=["DELETE"])
    def api_tag_delete_global(tag_name: str):
        """Remove a tag from ALL items in the media library.

        This is a global tag deletion — the tag is stripped from every
        item that has it.  Useful for removing mistakenly-added tags.

        Args:
            tag_name: The tag name to remove globally (URL-decoded by Flask).

        Returns:
            JSON with 'tag' (name removed) and 'updated' (count of items affected).
        """
        metadata = load_metadata(_media_dir())
        updated = 0

        for item_data in metadata["items"].values():
            tags = item_data.get("tags", [])
            if tag_name in tags:
                tags.remove(tag_name)
                item_data["tags"] = sorted(tags)
                updated += 1

        save_metadata(_media_dir(), metadata)
        logger.info(f"Global tag removal: '{tag_name}' removed from {updated} items")
        return jsonify({"tag": tag_name, "updated": updated})

    @app.route("/api/delete", methods=["POST"])
    def api_delete():
        """Soft-delete media items by moving them to .trash/.

        Request body (JSON):
            item_ids (list[str]): Relative paths of items to delete.

        Returns:
            JSON with 'deleted' count and 'errors' list.
        """
        body = request.get_json()
        if not body:
            return jsonify({"error": "Request body required"}), 400

        item_ids = body.get("item_ids", [])
        if not item_ids:
            return jsonify({"error": "item_ids required"}), 400

        trash_dir = os.path.join(_media_dir(), ".trash")
        os.makedirs(trash_dir, exist_ok=True)

        metadata = load_metadata(_media_dir())
        deleted = 0
        errors = []

        for item_id in item_ids:
            src_path = os.path.join(_media_dir(), item_id)
            if not os.path.exists(src_path):
                errors.append(f"File not found: {item_id}")
                continue

            try:
                # Move to .trash/, preserving filename (add hash if collision)
                dest_filename = os.path.basename(item_id)
                dest_path = os.path.join(trash_dir, dest_filename)
                if os.path.exists(dest_path):
                    stem = Path(dest_filename).stem
                    ext = Path(dest_filename).suffix
                    path_hash = hashlib.md5(item_id.encode()).hexdigest()[:8]
                    dest_path = os.path.join(trash_dir, f"{stem}_{path_hash}{ext}")

                shutil.move(src_path, dest_path)

                # Remove from metadata
                if item_id in metadata["items"]:
                    del metadata["items"][item_id]

                deleted += 1
                logger.info(f"Trashed: {item_id}")

            except Exception as e:
                errors.append(f"Failed to delete {item_id}: {e}")
                logger.error(f"Delete failed for {item_id}: {e}")

        save_metadata(_media_dir(), metadata)
        return jsonify({"deleted": deleted, "errors": errors})

    # -----------------------------------------------------------------------
    # Routes — Media directory switching
    # -----------------------------------------------------------------------
    @app.route("/api/pick-folder", methods=["POST"])
    def api_pick_folder():
        """Pop up a native OS folder picker and return the chosen path.

        The picker runs in a fresh subprocess (not on the Flask worker
        thread that handled this request), because tkinter cannot be
        invoked from non-main threads — it hits "main thread is not in
        main loop" otherwise. Since Media Wall's "server" is the user's
        own machine, the dialog still appears on their screen as a
        normal native window.

        Returns:
            JSON {"path": "..."} on success, {"path": None} if cancelled.
        """
        picked = ask_media_directory_subprocess()
        return jsonify({"path": picked})

    @app.route("/api/set-media-dir", methods=["POST"])
    def api_set_media_dir():
        """Switch the active media directory at runtime.

        Validates the path, updates app.config, persists to config.ini,
        and runs a fresh scan so the new directory is ready to serve.

        Request body (JSON):
            path (str): Absolute path to the new media directory.

        Returns:
            JSON {"ok": True, "path": "...", "scan": {...}} on success,
            or {"error": "..."} with a 400 status on failure.
        """
        body = request.get_json() or {}
        new_path = (body.get("path") or "").strip()
        if not new_path:
            return jsonify({"error": "path required"}), 400
        if not os.path.isdir(new_path):
            return jsonify({"error": f"Not a directory: {new_path}"}), 400

        new_path = os.path.normpath(new_path)
        app.config["MEDIA_DIR"] = new_path
        config.set("media", "media_directory", new_path)

        config_path = app.config.get("CONFIG_PATH", "")
        if config_path:
            try:
                save_config(config_path, config)
            except Exception as e:
                logger.warning(f"Could not persist new media_directory: {e}")

        logger.info(f"Media directory switched to: {new_path}")
        scan_result = perform_scan(new_path)
        return jsonify({"ok": True, "path": new_path, "scan": scan_result})

    return app


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    Returns:
        Parsed arguments namespace.
    """
    parser = argparse.ArgumentParser(
        description="Media Wall — Elegant local media viewer with masonry grid",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            '  python media_wall.py --media-dir "C:/Photos"\n'
            "  python media_wall.py --port 8080\n"
            "  python media_wall.py --no-browser\n"
        ),
    )
    parser.add_argument(
        "--media-dir",
        help="Path to directory containing images and videos (overrides config.ini)",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="Port to run the server on (default: from config.ini or 5000)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't automatically open browser on startup",
    )
    parser.add_argument(
        "--config",
        default="config.ini",
        help="Path to config file (default: config.ini in media_wall directory)",
    )
    # Internal flag — used by /api/pick-folder to relaunch this script in a
    # fresh subprocess that ONLY shows the folder picker, then exits. This
    # sidesteps tkinter's "main thread is not in main loop" error when the
    # picker would otherwise be invoked from a Flask worker thread.
    parser.add_argument(
        "--pick-folder",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    return parser.parse_args()


def main() -> None:
    """Main entry point — load config, validate, and start the server."""
    args = parse_args()

    # Subprocess folder-picker mode — show the dialog and exit. Used by
    # /api/pick-folder to keep tkinter off Flask's worker threads.
    if args.pick_folder:
        path = ask_media_directory(welcome=False)
        if path:
            print(path)
        sys.exit(0)

    # Resolve config path relative to the app directory (next to the .exe
    # when frozen, next to media_wall.py when running from source)
    app_dir = get_app_dir()
    config_path = (
        args.config
        if os.path.isabs(args.config)
        else str(app_dir / args.config)
    )
    config = load_config(config_path)

    # CLI overrides
    if args.media_dir:
        config.set("media", "media_directory", args.media_dir)
    if args.port:
        config.set("server", "port", str(args.port))

    # Validate media directory — pop up a folder picker if not set
    media_dir = config.get("media", "media_directory")
    if not media_dir or not os.path.isdir(media_dir):
        if not media_dir:
            logger.info("No media directory configured — opening folder picker.")
        else:
            logger.warning(
                f"Media directory not found: {media_dir} — opening folder picker."
            )

        picked = ask_media_directory()
        if not picked:
            logger.error("No folder selected. Exiting.")
            sys.exit(1)
        if not os.path.isdir(picked):
            logger.error(f"Selected path is not a valid directory: {picked}")
            sys.exit(1)

        media_dir = picked
        config.set("media", "media_directory", media_dir)
        save_config(config_path, config)
        logger.info(f"Media directory saved to config — you won't be asked again.")

    logger.info(f"Media directory: {media_dir}")

    # Create Flask app
    port = config.getint("server", "port")
    app = create_app(config, config_path)

    # Auto-open browser
    if not args.no_browser:
        url = f"http://localhost:{port}"
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
        logger.info(f"Opening browser at {url}")

    # Start server
    logger.info(f"Starting Media Wall on port {port}")
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
