/* =========================================================================
   Media Wall — Lightbox / Click-to-Isolate
   ========================================================================= */

/**
 * Full-screen lightbox overlay for viewing media at full resolution.
 *
 * Features:
 * - Full-res images (original, not optimized)
 * - Videos with full controls and unmuted audio
 * - Left/right navigation through the current filtered set
 * - File info display (filename, path)
 * - Escape / click-outside to close
 */
const Lightbox = {
    /** The lightbox overlay element */
    overlay: null,

    /** Currently displayed item ID */
    currentId: null,

    /** Whether the lightbox is currently open */
    isOpen: false,

    /** Whether lightbox videos should loop */
    videoLoop: false,

    /**
     * Initialize the lightbox by creating the overlay DOM structure.
     */
    init() {
        // Create overlay
        this.overlay = document.createElement("div");
        this.overlay.id = "lightbox-overlay";
        this.overlay.className = "lightbox-overlay";
        this.overlay.innerHTML = `
            <div class="lightbox-backdrop"></div>
            <div class="lightbox-content">
                <div class="lightbox-media-container" id="lightbox-media"></div>
            </div>
            <button class="lightbox-close" id="lightbox-close" title="Close (Esc)">&times;</button>
            <button class="lightbox-nav lightbox-prev" id="lightbox-prev" title="Previous">&lsaquo;</button>
            <button class="lightbox-nav lightbox-next" id="lightbox-next" title="Next">&rsaquo;</button>
            <div class="lightbox-info" id="lightbox-info"></div>
        `;
        document.body.appendChild(this.overlay);

        // Event listeners
        document.getElementById("lightbox-close").addEventListener("click", () => this.close());
        document.getElementById("lightbox-prev").addEventListener("click", () => this.navigate(-1));
        document.getElementById("lightbox-next").addEventListener("click", () => this.navigate(1));

        // Click backdrop to close
        this.overlay.querySelector(".lightbox-backdrop").addEventListener("click", () => this.close());

        // Keyboard navigation
        document.addEventListener("keydown", (e) => this._handleKeydown(e));
    },

    /**
     * Open the lightbox for a specific media item.
     *
     * @param {string} itemId - The item's relative path / ID.
     */
    open(itemId) {
        // Don't open if in select mode
        if (typeof Tags !== "undefined" && Tags.selectMode) return;

        this.currentId = itemId;
        this.isOpen = true;
        this.overlay.classList.add("active");
        document.body.style.overflow = "hidden";

        // Pause grid videos
        if (typeof VideoManager !== "undefined") {
            VideoManager.pauseAll();
        }

        this._displayItem(itemId);
    },

    /**
     * Close the lightbox.
     */
    close() {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.overlay.classList.remove("active");
        document.body.style.overflow = "";

        // Clean up any playing lightbox video
        const mediaContainer = document.getElementById("lightbox-media");
        const video = mediaContainer.querySelector("video");
        if (video) {
            video.pause();
            video.removeAttribute("src");
            video.load();
        }
        mediaContainer.innerHTML = "";

        // Resume grid video autoplay
        if (typeof VideoManager !== "undefined") {
            VideoManager.resumeAll();
        }

        this.currentId = null;
    },

    /**
     * Navigate to the previous or next item.
     *
     * @param {number} direction - -1 for previous, +1 for next.
     */
    navigate(direction) {
        if (!this.isOpen || !this.currentId) return;

        const items = Wall.items;
        const currentIndex = items.findIndex(i => i.id === this.currentId);
        if (currentIndex === -1) return;

        const newIndex = currentIndex + direction;
        if (newIndex < 0 || newIndex >= items.length) return;

        // Clean up current media before switching
        const mediaContainer = document.getElementById("lightbox-media");
        const video = mediaContainer.querySelector("video");
        if (video) {
            video.pause();
            video.removeAttribute("src");
            video.load();
        }

        this.currentId = items[newIndex].id;
        this._displayItem(this.currentId);
    },

    /**
     * Display a media item in the lightbox.
     *
     * @param {string} itemId - The item's ID.
     * @private
     */
    _displayItem(itemId) {
        const item = Wall.items.find(i => i.id === itemId);
        if (!item) return;

        const mediaContainer = document.getElementById("lightbox-media");
        const infoContainer = document.getElementById("lightbox-info");
        mediaContainer.innerHTML = "";

        if (item.type === "image") {
            const img = document.createElement("img");
            img.src = item.full_url;
            img.alt = item.filename;
            img.className = "lightbox-image";
            // Prevent click on image from closing lightbox
            img.addEventListener("click", (e) => e.stopPropagation());
            mediaContainer.appendChild(img);
        } else {
            const video = document.createElement("video");
            video.src = item.full_url;
            video.controls = true;
            video.autoplay = true;
            video.loop = this.videoLoop;
            video.className = "lightbox-video";
            // Unmuted in lightbox
            video.muted = false;
            video.addEventListener("click", (e) => e.stopPropagation());
            mediaContainer.appendChild(video);
        }

        // Update info bar
        const tags = item.tags && item.tags.length > 0
            ? item.tags.map(t => `<span class="lightbox-tag">${this._escapeHtml(t)}</span>`).join("")
            : '<span class="lightbox-no-tags">No tags</span>';

        infoContainer.innerHTML = `
            <div class="lightbox-info-filename">${this._escapeHtml(item.filename)}</div>
            <div class="lightbox-info-path">${this._escapeHtml(item.relative_path)}</div>
            <div class="lightbox-info-tags" id="lightbox-tags">${tags}</div>
            ${item.type === "video" ? `<button class="lightbox-loop-btn ${this.videoLoop ? 'active' : ''}" id="lightbox-loop" title="Toggle loop">&#128257;</button>` : ""}
            <button class="lightbox-delete-btn" id="lightbox-delete" title="Move to trash">&#128465;</button>
        `;

        // Loop toggle handler (videos only)
        const loopBtn = document.getElementById("lightbox-loop");
        if (loopBtn) {
            loopBtn.addEventListener("click", () => {
                this.videoLoop = !this.videoLoop;
                loopBtn.classList.toggle("active", this.videoLoop);
                const video = document.querySelector(".lightbox-video");
                if (video) video.loop = this.videoLoop;
            });
        }

        // Delete button handler
        document.getElementById("lightbox-delete").addEventListener("click", () => {
            if (typeof Tags !== "undefined") {
                Tags.deleteCurrent(item.id);
            }
        });

        // Update nav button visibility
        const items = Wall.items;
        const currentIndex = items.findIndex(i => i.id === itemId);
        document.getElementById("lightbox-prev").style.display =
            currentIndex > 0 ? "" : "none";
        document.getElementById("lightbox-next").style.display =
            currentIndex < items.length - 1 ? "" : "none";
    },

    /**
     * Handle keyboard events for the lightbox.
     *
     * @param {KeyboardEvent} e
     * @private
     */
    _handleKeydown(e) {
        if (!this.isOpen) return;

        switch (e.key) {
            case "Escape":
                this.close();
                e.preventDefault();
                break;
            case "ArrowLeft":
                this.navigate(-1);
                e.preventDefault();
                break;
            case "ArrowRight":
                this.navigate(1);
                e.preventDefault();
                break;
        }
    },

    /**
     * Escape HTML special characters to prevent XSS.
     *
     * @param {string} text
     * @returns {string}
     * @private
     */
    _escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    },
};


/* =========================================================================
   Initialization
   ========================================================================= */

document.addEventListener("DOMContentLoaded", () => {
    Lightbox.init();
});
