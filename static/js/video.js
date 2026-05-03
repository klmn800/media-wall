/* =========================================================================
   Media Wall — Video Autoplay & Memory Management
   ========================================================================= */

/**
 * Manages video autoplay and memory by using Intersection Observer to:
 * - Load video src and start playback when scrolling into view
 * - Pause and fully unload video src when scrolling out of view
 *
 * Videos display their poster frame when unloaded, so the grid still
 * looks complete. Memory is freed because the video data is removed.
 */
const VideoManager = {
    /** The Intersection Observer instance */
    observer: null,

    /** Whether all videos are globally paused */
    globalPause: false,

    /** Delay in ms before a video starts playing after scrolling into view */
    playDelay: 0,

    /** Map of video elements to their pending play timeouts */
    _pendingPlay: new WeakMap(),

    /**
     * Initialize the video observer.
     * Called once on page load.
     */
    init() {
        this.observer = new IntersectionObserver(
            (entries) => this._handleIntersections(entries),
            {
                // Start loading slightly before the video enters the viewport
                rootMargin: "200px 0px 200px 0px",
                threshold: 0.0,
            }
        );

        // Observe any videos already in the DOM
        this.observeNewVideos();
    },

    /**
     * Observe all video elements in the grid that aren't already observed.
     * Called after each batch of items is rendered by wall.js.
     */
    observeNewVideos() {
        if (!this.observer) return;

        const videos = document.querySelectorAll(".grid-item video");
        videos.forEach(video => {
            if (!video.dataset.observed) {
                video.dataset.observed = "true";
                this.observer.observe(video);
            }
        });
    },

    /**
     * Handle intersection changes for observed videos.
     *
     * When a video enters the viewport:
     *   1. Set the src from data-src
     *   2. Call load() to start buffering
     *   3. After optional delay, call play() (muted, looped)
     *
     * When a video leaves the viewport:
     *   1. Cancel any pending play timeout
     *   2. Pause playback
     *   3. Remove the src attribute
     *   4. Call load() to release the media resource (frees memory)
     *   The poster frame remains visible.
     *
     * @param {IntersectionObserverEntry[]} entries
     */
    _handleIntersections(entries) {
        entries.forEach(entry => {
            const video = entry.target;
            const src = video.dataset.src;

            if (entry.isIntersecting) {
                // Don't autoplay if globally paused
                if (this.globalPause) return;

                // Load the video source
                if (src && video.getAttribute("src") !== src) {
                    video.src = src;
                    video.load();
                }

                // Play after delay (or immediately if delay is 0)
                if (this.playDelay > 0) {
                    const timeout = setTimeout(() => {
                        this._pendingPlay.delete(video);
                        video.play().catch(() => {});
                    }, this.playDelay);
                    this._pendingPlay.set(video, timeout);
                } else {
                    video.play().catch(() => {
                        // Autoplay may be blocked by browser policy on first
                        // interaction — this is fine, poster frame stays visible
                    });
                }
            } else {
                // Cancel any pending play timeout
                const timeout = this._pendingPlay.get(video);
                if (timeout) {
                    clearTimeout(timeout);
                    this._pendingPlay.delete(video);
                }

                // Video scrolled out of view — pause and unload
                if (video.getAttribute("src")) {
                    video.pause();
                    video.removeAttribute("src");
                    video.load(); // Releases the media resource
                }
            }
        });
    },

    /**
     * Toggle global pause on/off for all grid videos.
     */
    toggleGlobalPause() {
        this.globalPause = !this.globalPause;

        if (this.globalPause) {
            this.pauseAll();
        } else {
            this.resumeAll();
        }

        return this.globalPause;
    },

    /**
     * Pause all currently playing videos.
     * Used when the lightbox opens or global pause is toggled.
     */
    pauseAll() {
        const videos = document.querySelectorAll(".grid-item video");
        videos.forEach(video => {
            // Cancel pending play timeouts
            const timeout = this._pendingPlay.get(video);
            if (timeout) {
                clearTimeout(timeout);
                this._pendingPlay.delete(video);
            }
            if (!video.paused) {
                video.pause();
            }
        });
    },

    /**
     * Resume autoplay behavior by re-evaluating all observed videos.
     * Used when the lightbox closes or global pause is toggled off.
     */
    resumeAll() {
        if (!this.observer || this.globalPause) return;

        // Disconnect and re-observe to trigger fresh intersection checks
        const videos = document.querySelectorAll(".grid-item video[data-observed]");
        videos.forEach(video => {
            this.observer.unobserve(video);
            this.observer.observe(video);
        });
    },

    /**
     * Set the play delay in milliseconds.
     *
     * @param {number} ms - Delay before videos start playing (0 = immediate)
     */
    setPlayDelay(ms) {
        this.playDelay = Math.max(0, ms);
    },
};


/* =========================================================================
   Initialization
   ========================================================================= */

document.addEventListener("DOMContentLoaded", () => {
    VideoManager.init();
});
