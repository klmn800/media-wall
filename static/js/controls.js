/* =========================================================================
   Media Wall — Control Panel, Sorting, Filtering, Search, Autoscroll
   ========================================================================= */

/**
 * Manages the collapsible control panel and all its controls:
 * - Sort by field and direction
 * - Filter by tags and media type
 * - Filename search
 * - Active filter indicators
 * - Select Mode toggle
 * - Autoscroll
 */
const Controls = {
    /** Whether the control panel is open */
    panelOpen: false,

    /** Whether autoscroll is active */
    autoscrolling: false,

    /** Autoscroll animation frame ID */
    _scrollAnimFrame: null,

    /** Accumulated sub-pixel scroll distance */
    _scrollAccumulator: 0,

    /** Search debounce timer */
    _searchTimer: null,

    /** All available tags (fetched from API) */
    availableTags: [],

    /** Currently selected include filter tags */
    activeFilterTags: new Set(),

    /** Currently selected exclude filter tags */
    excludeFilterTags: new Set(),

    /**
     * Initialize the control panel and all controls.
     */
    init() {
        this._createPanel();
        this._createToggleButton();
        this._createFilterIndicator();
        this._setupAutoscrollPause();
    },

    /* ------------------------------------------------------------------
       Panel Structure
       ------------------------------------------------------------------ */

    _createPanel() {
        const panel = document.createElement("div");
        panel.id = "control-panel";
        panel.className = "control-panel";
        panel.innerHTML = `
            <div class="panel-header">
                <h2>Controls</h2>
                <button class="panel-close-btn" id="panel-close">&times;</button>
            </div>

            <div class="panel-section">
                <label class="panel-label">Sort By</label>
                <div class="sort-controls">
                    <select id="sort-field" class="panel-select">
                        <option value="modified">Date Modified</option>
                        <option value="filename">Filename</option>
                        <option value="size">File Size</option>
                        <option value="type">File Type</option>
                    </select>
                    <button id="sort-direction" class="sort-dir-btn" title="Toggle sort direction">
                        &#9660;
                    </button>
                </div>
            </div>

            <div class="panel-section">
                <label class="panel-label">Media Type</label>
                <div class="type-filter-btns">
                    <button class="type-btn active" data-type="all">All</button>
                    <button class="type-btn" data-type="image">Images</button>
                    <button class="type-btn" data-type="video">Videos</button>
                </div>
            </div>

            <div class="panel-section">
                <label class="panel-label">Search</label>
                <input type="text" id="search-input" class="panel-input"
                       placeholder="Filter by filename..." autocomplete="off">
            </div>

            <div class="panel-section">
                <label class="panel-label">Tags <span class="panel-hint">click: include, double-click: exclude</span></label>
                <div id="tag-filter-list" class="tag-filter-list">
                    <span class="panel-muted">Loading...</span>
                </div>
            </div>

            <div class="panel-divider"></div>

            <div class="panel-section">
                <label class="panel-label">Video</label>
                <div class="video-controls">
                    <button id="pause-all-btn" class="panel-action-btn secondary">
                        Pause All Videos
                    </button>
                    <div class="settings-row">
                        <span class="settings-label">Play Delay</span>
                        <select id="video-delay" class="panel-select-sm">
                            <option value="0">None</option>
                            <option value="500">0.5s</option>
                            <option value="1000">1s</option>
                            <option value="2000">2s</option>
                            <option value="3000">3s</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="panel-divider"></div>

            <div class="panel-section">
                <label class="panel-label">Autoscroll</label>
                <div class="autoscroll-controls">
                    <button id="autoscroll-toggle" class="autoscroll-btn">
                        &#9654; Start
                    </button>
                    <div class="speed-control">
                        <span class="panel-muted">Speed</span>
                        <input type="range" id="autoscroll-speed" class="panel-range"
                               min="1" max="10" value="${CONFIG.autoscrollSpeed}">
                    </div>
                </div>
            </div>

            <div class="panel-divider"></div>

            <div class="panel-section">
                <button id="select-mode-btn" class="panel-action-btn">
                    Select Mode
                </button>
                <button id="refresh-btn" class="panel-action-btn secondary">
                    Refresh Library
                </button>
            </div>

            <div class="panel-divider"></div>

            <div class="panel-section">
                <label class="panel-label">Grid Settings</label>
                <div class="settings-row">
                    <span class="settings-label">Column Width</span>
                    <input type="number" id="setting-col-width" class="panel-input-sm"
                           value="${CONFIG.columnWidth}" min="150" max="800" step="50">
                </div>
                <div class="settings-row">
                    <span class="settings-label">Grid Gap</span>
                    <input type="number" id="setting-grid-gap" class="panel-input-sm"
                           value="${CONFIG.gridGap}" min="0" max="20" step="1">
                </div>
            </div>

            <div class="panel-section">
                <label class="panel-label">Keyboard Shortcuts</label>
                <div class="shortcuts-list">
                    <div class="shortcut-row"><kbd>F</kbd> Toggle this panel</div>
                    <div class="shortcut-row"><kbd>S</kbd> Toggle Select Mode</div>
                    <div class="shortcut-row"><kbd>V</kbd> Pause/resume all videos</div>
                    <div class="shortcut-row"><kbd>Space</kbd> Toggle autoscroll</div>
                    <div class="shortcut-row"><kbd>Esc</kbd> Close lightbox/panel</div>
                    <div class="shortcut-row"><kbd>&larr;</kbd> <kbd>&rarr;</kbd> Navigate lightbox</div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // Wire up event handlers
        document.getElementById("panel-close").addEventListener("click", () => this.togglePanel());
        document.getElementById("sort-field").addEventListener("change", (e) => this._onSortChange(e));
        document.getElementById("sort-direction").addEventListener("click", () => this._onSortDirToggle());
        document.getElementById("search-input").addEventListener("input", (e) => this._onSearch(e));
        document.getElementById("search-input").addEventListener("keydown", (e) => e.stopPropagation());
        document.getElementById("autoscroll-toggle").addEventListener("click", () => this.toggleAutoscroll());
        document.getElementById("autoscroll-speed").addEventListener("input", () => {}); // real-time, read in scroll loop
        document.getElementById("select-mode-btn").addEventListener("click", () => {
            Tags.toggleSelectMode();
            this._updateSelectModeBtn();
        });
        document.getElementById("refresh-btn").addEventListener("click", () => this._onRefresh());

        // Video controls
        document.getElementById("pause-all-btn").addEventListener("click", () => {
            const paused = VideoManager.toggleGlobalPause();
            const btn = document.getElementById("pause-all-btn");
            btn.textContent = paused ? "Resume All Videos" : "Pause All Videos";
            btn.classList.toggle("active", paused);
        });
        document.getElementById("video-delay").addEventListener("change", (e) => {
            VideoManager.setPlayDelay(parseInt(e.target.value));
        });

        // Grid settings — apply immediately
        document.getElementById("setting-col-width").addEventListener("change", (e) => {
            const val = parseInt(e.target.value);
            if (val >= 150 && val <= 800) {
                CONFIG.columnWidth = val;
                applyGridConfig();
            }
        });
        document.getElementById("setting-grid-gap").addEventListener("change", (e) => {
            const val = parseInt(e.target.value);
            if (val >= 0 && val <= 20) {
                CONFIG.gridGap = val;
                applyGridConfig();
            }
        });

        // Type filter buttons
        panel.querySelectorAll(".type-btn").forEach(btn => {
            btn.addEventListener("click", () => this._onTypeFilter(btn));
        });

        // Load available tags
        this._loadTags();
    },

    _createToggleButton() {
        const btn = document.createElement("button");
        btn.id = "panel-toggle";
        btn.className = "panel-toggle-btn";
        btn.innerHTML = "&#9776;";  // hamburger icon
        btn.title = "Controls (F)";
        btn.addEventListener("click", () => this.togglePanel());
        document.body.appendChild(btn);
    },

    _createFilterIndicator() {
        const bar = document.createElement("div");
        bar.id = "filter-indicator";
        bar.className = "filter-indicator";
        document.body.appendChild(bar);
    },

    /* ------------------------------------------------------------------
       Panel Toggle
       ------------------------------------------------------------------ */

    togglePanel() {
        this.panelOpen = !this.panelOpen;
        const panel = document.getElementById("control-panel");
        panel.classList.toggle("open", this.panelOpen);

        if (this.panelOpen) {
            this._loadTags();  // refresh tag list when opening
        }
    },

    /* ------------------------------------------------------------------
       Sorting
       ------------------------------------------------------------------ */

    _onSortChange(e) {
        Wall.params.sort_by = e.target.value;
        this._applyFilters();
    },

    _onSortDirToggle() {
        const btn = document.getElementById("sort-direction");
        if (Wall.params.sort_order === "desc") {
            Wall.params.sort_order = "asc";
            btn.innerHTML = "&#9650;";  // up arrow
        } else {
            Wall.params.sort_order = "desc";
            btn.innerHTML = "&#9660;";  // down arrow
        }
        this._applyFilters();
    },

    /* ------------------------------------------------------------------
       Type Filter
       ------------------------------------------------------------------ */

    _onTypeFilter(btn) {
        document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        Wall.params.filter_type = btn.dataset.type;
        this._applyFilters();
    },

    /* ------------------------------------------------------------------
       Search
       ------------------------------------------------------------------ */

    _onSearch(e) {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
            Wall.params.search = e.target.value.trim();
            this._applyFilters();
        }, 300);
    },

    /* ------------------------------------------------------------------
       Tag Filters
       ------------------------------------------------------------------ */

    async _loadTags() {
        try {
            const response = await fetch("/api/tags");
            const data = await response.json();
            this.availableTags = data.tags || [];
            this._renderTagFilters();
        } catch (err) {
            console.error("Failed to load tags:", err);
        }
    },

    _renderTagFilters() {
        const container = document.getElementById("tag-filter-list");
        if (this.availableTags.length === 0) {
            container.innerHTML = '<span class="panel-muted">No tags yet</span>';
            return;
        }

        container.innerHTML = this.availableTags.map(tag => {
            let stateClass = "";
            if (this.activeFilterTags.has(tag.name)) stateClass = "include";
            else if (this.excludeFilterTags.has(tag.name)) stateClass = "exclude";
            return `<button class="tag-filter-btn ${stateClass}"
                         data-tag="${Tags._escapeHtml(tag.name)}"
                         data-count="${tag.count}">
                    ${Tags._escapeHtml(tag.name)}
                    <span class="tag-count">${tag.count}</span>
                    <span class="tag-remove-global" data-tag="${Tags._escapeHtml(tag.name)}"
                          data-count="${tag.count}" title="Remove tag from all items">&times;</span>
                </button>`;
        }).join("");

        // Click / double-click discrimination for include / exclude
        container.querySelectorAll(".tag-filter-btn").forEach(btn => {
            let clickTimer = null;

            btn.addEventListener("click", (e) => {
                // Ignore clicks on the global-remove x button
                if (e.target.classList.contains("tag-remove-global")) return;
                e.preventDefault();
                if (clickTimer) clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    this._handleTagSingleClick(btn);
                }, 250);
            });

            btn.addEventListener("dblclick", (e) => {
                if (e.target.classList.contains("tag-remove-global")) return;
                e.preventDefault();
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                }
                this._handleTagDoubleClick(btn);
            });
        });

        // Global tag removal (x button)
        container.querySelectorAll(".tag-remove-global").forEach(removeBtn => {
            removeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                const tagName = removeBtn.dataset.tag;
                const count = removeBtn.dataset.count;
                this._confirmGlobalTagRemoval(tagName, count);
            });
        });
    },

    /**
     * Handle single-click on a tag filter button.
     * neutral -> include, include -> neutral, exclude -> include
     */
    _handleTagSingleClick(btn) {
        const tagName = btn.dataset.tag;
        if (this.activeFilterTags.has(tagName)) {
            // include -> neutral
            this.activeFilterTags.delete(tagName);
            btn.classList.remove("include");
        } else if (this.excludeFilterTags.has(tagName)) {
            // exclude -> include
            this.excludeFilterTags.delete(tagName);
            this.activeFilterTags.add(tagName);
            btn.classList.remove("exclude");
            btn.classList.add("include");
        } else {
            // neutral -> include
            this.activeFilterTags.add(tagName);
            btn.classList.add("include");
        }
        this._syncTagParams();
        this._applyFilters();
    },

    /**
     * Handle double-click on a tag filter button.
     * neutral -> exclude, exclude -> neutral, include -> exclude
     */
    _handleTagDoubleClick(btn) {
        const tagName = btn.dataset.tag;
        if (this.excludeFilterTags.has(tagName)) {
            // exclude -> neutral
            this.excludeFilterTags.delete(tagName);
            btn.classList.remove("exclude");
        } else if (this.activeFilterTags.has(tagName)) {
            // include -> exclude
            this.activeFilterTags.delete(tagName);
            this.excludeFilterTags.add(tagName);
            btn.classList.remove("include");
            btn.classList.add("exclude");
        } else {
            // neutral -> exclude
            this.excludeFilterTags.add(tagName);
            btn.classList.add("exclude");
        }
        this._syncTagParams();
        this._applyFilters();
    },

    /**
     * Sync the Wall.params filter_tags and exclude_tags from the Sets.
     */
    _syncTagParams() {
        Wall.params.filter_tags = Array.from(this.activeFilterTags).join(",");
        Wall.params.exclude_tags = Array.from(this.excludeFilterTags).join(",");
    },

    /**
     * Confirm and execute global removal of a tag from all items.
     */
    async _confirmGlobalTagRemoval(tagName, count) {
        const confirmed = await Tags._confirm(
            "Remove Tag Globally",
            `Remove tag "${tagName}" from ${count} item${count !== "1" ? "s" : ""}? This cannot be undone.`
        );
        if (!confirmed) return;

        try {
            const response = await fetch(
                `/api/tags/${encodeURIComponent(tagName)}`,
                { method: "DELETE" }
            );
            if (!response.ok) throw new Error(`API error: ${response.status}`);

            // Remove from active/exclude filter sets if present
            this.activeFilterTags.delete(tagName);
            this.excludeFilterTags.delete(tagName);
            this._syncTagParams();

            // Remove tag from local Wall.items state
            Wall.items.forEach(item => {
                if (item.tags) {
                    item.tags = item.tags.filter(t => t !== tagName);
                }
            });

            // Refresh tags and grid
            await this._loadTags();
            await this._applyFilters();
        } catch (err) {
            console.error("Failed to remove tag globally:", err);
        }
    },

    /* ------------------------------------------------------------------
       Apply Filters & Reload
       ------------------------------------------------------------------ */

    async _applyFilters() {
        await reloadGrid();
        this._updateFilterIndicator();
    },

    _updateFilterIndicator() {
        const bar = document.getElementById("filter-indicator");
        const parts = [];

        if (Wall.params.filter_type !== "all") {
            parts.push(`Type: ${Wall.params.filter_type}s`);
        }
        if (this.activeFilterTags.size > 0) {
            parts.push(`Include: ${Array.from(this.activeFilterTags).join(", ")}`);
        }
        if (this.excludeFilterTags.size > 0) {
            parts.push(`Exclude: ${Array.from(this.excludeFilterTags).join(", ")}`);
        }
        if (Wall.params.search) {
            parts.push(`Search: "${Wall.params.search}"`);
        }

        const grid = document.getElementById("media-grid");
        if (parts.length > 0) {
            bar.innerHTML = `
                <span class="filter-text">${parts.join(" | ")}</span>
                <button class="filter-clear-btn" id="filter-clear">Clear All</button>
            `;
            bar.classList.add("active");
            grid.style.paddingTop = bar.offsetHeight + "px";
            document.getElementById("filter-clear").addEventListener("click", () => this._clearAllFilters());
        } else {
            bar.classList.remove("active");
            bar.innerHTML = "";
            grid.style.paddingTop = "";
        }
    },

    _clearAllFilters() {
        Wall.params.filter_type = "all";
        Wall.params.filter_tags = "";
        Wall.params.exclude_tags = "";
        Wall.params.search = "";
        this.activeFilterTags.clear();
        this.excludeFilterTags.clear();

        // Reset UI elements
        document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("active"));
        document.querySelector('.type-btn[data-type="all"]').classList.add("active");
        document.getElementById("search-input").value = "";
        document.querySelectorAll(".tag-filter-btn").forEach(b => {
            b.classList.remove("include", "exclude");
        });

        this._applyFilters();
    },

    /* ------------------------------------------------------------------
       Autoscroll
       ------------------------------------------------------------------ */

    toggleAutoscroll() {
        this.autoscrolling = !this.autoscrolling;
        const btn = document.getElementById("autoscroll-toggle");

        if (this.autoscrolling) {
            btn.innerHTML = "&#9646;&#9646; Pause";
            btn.classList.add("active");
            this._scrollAccumulator = 0;
            // Close the control panel so it doesn't block the view
            if (this.panelOpen) this.togglePanel();
            this._scrollLoop();
        } else {
            btn.innerHTML = "&#9654; Start";
            btn.classList.remove("active");
            if (this._scrollAnimFrame) {
                cancelAnimationFrame(this._scrollAnimFrame);
                this._scrollAnimFrame = null;
            }
        }
    },

    _scrollLoop() {
        if (!this.autoscrolling) return;

        const speed = parseInt(document.getElementById("autoscroll-speed").value);
        // Speed 1 = 0.3px/frame (~18px/sec), speed 10 = 3px/frame (~180px/sec)
        const pixelsPerFrame = speed * 0.3;

        // Accumulate sub-pixel amounts so slow speeds still work
        this._scrollAccumulator += pixelsPerFrame;
        if (this._scrollAccumulator >= 1) {
            const scrollAmount = Math.floor(this._scrollAccumulator);
            this._scrollAccumulator -= scrollAmount;
            // Use scrollTop directly — more reliable than scrollBy across browsers
            const el = document.documentElement;
            el.scrollTop += scrollAmount;
        }

        // Check if we hit the bottom
        const el = document.documentElement;
        const atBottom = (el.scrollTop + window.innerHeight) >= el.scrollHeight - 5;
        if (atBottom) {
            if (Wall.hasMore) {
                this._scrollAnimFrame = requestAnimationFrame(() => this._scrollLoop());
                return;
            }
            if (CONFIG.bottomBehavior === "loop") {
                el.scrollTop = 0;
            } else {
                this.toggleAutoscroll();
                return;
            }
        }

        this._scrollAnimFrame = requestAnimationFrame(() => this._scrollLoop());
    },

    _setupAutoscrollPause() {
        // Pause autoscroll on any user scroll input
        let lastScrollTime = 0;
        const pauseHandler = () => {
            if (!this.autoscrolling) return;
            const now = Date.now();
            if (now - lastScrollTime < 100) {
                // User is actively scrolling — pause
                this.toggleAutoscroll();
            }
            lastScrollTime = now;
        };

        window.addEventListener("wheel", () => {
            if (this.autoscrolling) this.toggleAutoscroll();
        }, { passive: true });

        window.addEventListener("keydown", (e) => {
            if (this.autoscrolling && ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) {
                this.toggleAutoscroll();
            }
        });
    },

    /* ------------------------------------------------------------------
       Select Mode Button
       ------------------------------------------------------------------ */

    _updateSelectModeBtn() {
        const btn = document.getElementById("select-mode-btn");
        if (Tags.selectMode) {
            btn.textContent = "Exit Select Mode";
            btn.classList.add("active");
        } else {
            btn.textContent = "Select Mode";
            btn.classList.remove("active");
        }
    },

    /* ------------------------------------------------------------------
       Refresh / Rescan
       ------------------------------------------------------------------ */

    async _onRefresh() {
        const btn = document.getElementById("refresh-btn");
        btn.disabled = true;
        btn.textContent = "Scanning...";

        try {
            const response = await fetch("/api/scan", { method: "POST" });
            const data = await response.json();
            btn.textContent = `Found ${data.total_items} items`;
            setTimeout(() => {
                btn.textContent = "Refresh Library";
                btn.disabled = false;
            }, 2000);
            await reloadGrid();
        } catch (err) {
            btn.textContent = "Scan failed";
            btn.disabled = false;
            console.error("Scan failed:", err);
        }
    },
};


/* =========================================================================
   Keyboard Shortcuts
   ========================================================================= */

document.addEventListener("keydown", (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    // Don't trigger if lightbox is handling keys
    if (typeof Lightbox !== "undefined" && Lightbox.isOpen) return;

    switch (e.key.toLowerCase()) {
        case "f":
            Controls.togglePanel();
            e.preventDefault();
            break;
        case "s":
            Tags.toggleSelectMode();
            Controls._updateSelectModeBtn();
            e.preventDefault();
            break;
        case " ":
            Controls.toggleAutoscroll();
            e.preventDefault();
            break;
        case "v":
            const paused = VideoManager.toggleGlobalPause();
            const pauseBtn = document.getElementById("pause-all-btn");
            pauseBtn.textContent = paused ? "Resume All Videos" : "Pause All Videos";
            pauseBtn.classList.toggle("active", paused);
            e.preventDefault();
            break;
    }
});


/* =========================================================================
   Initialization
   ========================================================================= */

document.addEventListener("DOMContentLoaded", () => {
    Controls.init();
});
