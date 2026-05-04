/* =========================================================================
   Media Wall — Tagging System & Select Mode
   ========================================================================= */

/**
 * Handles tagging and multi-select functionality:
 * - Hover tag display on grid items
 * - Tag editing in lightbox
 * - Select Mode with checkboxes and bulk action bar
 * - Bulk tag and bulk delete operations
 */
const Tags = {
    /** Whether Select Mode is active */
    selectMode: false,

    /** Set of currently selected item IDs */
    selectedItems: new Set(),

    /**
     * Initialize tag-related UI elements.
     */
    init() {
        this._createBulkActionBar();
        this._createTagDialog();
        this._createConfirmDialog();
        this._setupHoverTags();
        this._addLightboxTagUI();
    },

    /* ------------------------------------------------------------------
       Hover Tags on Grid Items
       ------------------------------------------------------------------ */

    /**
     * Set up event delegation for hover tag display on grid items.
     */
    _setupHoverTags() {
        const grid = document.getElementById("media-grid");

        grid.addEventListener("mouseenter", (e) => {
            const item = e.target.closest(".grid-item");
            if (!item || this.selectMode) return;
            // Don't re-show if overlay/fav-btn already present (prevents flicker)
            if (item.querySelector(".fav-btn")) return;
            this._showHoverTags(item);
        }, true);

        grid.addEventListener("mouseleave", (e) => {
            const item = e.target.closest(".grid-item");
            if (!item) return;
            // Don't hide if mouse moved to another child of the same grid item
            if (e.relatedTarget && item.contains(e.relatedTarget)) return;
            this._hideHoverTags(item);
        }, true);
    },

    /**
     * Show tags overlay and favorites button on a grid item.
     */
    _showHoverTags(gridItem) {
        // Remove any existing overlay
        this._hideHoverTags(gridItem);

        const itemId = gridItem.dataset.itemId;
        const item = Wall.items.find(i => i.id === itemId);
        if (!item) return;

        // Favorites button (always shown on hover)
        const isFav = (item.tags || []).includes("favorites");
        const favBtn = document.createElement("button");
        favBtn.className = "fav-btn" + (isFav ? " active" : "");
        favBtn.innerHTML = isFav ? "&#9829;" : "&#9825;";
        favBtn.title = isFav ? "Remove from favorites" : "Add to favorites";
        favBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this._toggleFavorite(itemId);
        });
        gridItem.appendChild(favBtn);

        // Tag overlay (only if there are tags)
        if (item.tags && item.tags.length > 0) {
            const overlay = document.createElement("div");
            overlay.className = "hover-tags-overlay";
            overlay.innerHTML = item.tags
                .map(t => `<span class="hover-tag">${this._escapeHtml(t)}</span>`)
                .join("");
            gridItem.appendChild(overlay);
        }
    },

    /**
     * Remove tags overlay and favorites button from a grid item.
     */
    _hideHoverTags(gridItem) {
        const overlay = gridItem.querySelector(".hover-tags-overlay");
        if (overlay) overlay.remove();
        const favBtn = gridItem.querySelector(".fav-btn");
        if (favBtn) favBtn.remove();
    },

    /* ------------------------------------------------------------------
       Lightbox Tag Editing
       ------------------------------------------------------------------ */

    /**
     * Add tag editing UI to the lightbox info bar.
     */
    _addLightboxTagUI() {
        // We'll inject the tag editor when the lightbox displays an item.
        // Override Lightbox._displayItem to add our tag editor after it runs.
        const originalDisplay = Lightbox._displayItem.bind(Lightbox);
        Lightbox._displayItem = (itemId) => {
            originalDisplay(itemId);
            this._renderLightboxTagEditor(itemId);
        };
    },

    /**
     * Render the tag editor in the lightbox info bar.
     */
    _renderLightboxTagEditor(itemId) {
        // Clean up previous autocomplete instance
        if (this._lightboxAutocomplete) {
            this._lightboxAutocomplete.destroy();
            this._lightboxAutocomplete = null;
        }

        const tagsContainer = document.getElementById("lightbox-tags");
        if (!tagsContainer) return;

        const item = Wall.items.find(i => i.id === itemId);
        if (!item) return;

        // Build favorites button + tag chips with remove buttons + add input
        const isFav = (item.tags || []).includes("favorites");
        let html = `<button class="lightbox-fav-btn${isFav ? " active" : ""}"
                            id="lightbox-fav-btn"
                            title="${isFav ? "Remove from favorites" : "Add to favorites"}">
                        ${isFav ? "&#9829;" : "&#9825;"}
                    </button>`;
        if (item.tags && item.tags.length > 0) {
            html += item.tags.map(t =>
                `<span class="lightbox-tag editable">
                    ${this._escapeHtml(t)}
                    <button class="tag-remove" data-tag="${this._escapeHtml(t)}"
                            data-item="${this._escapeHtml(itemId)}">&times;</button>
                </span>`
            ).join("");
        }
        html += `<input type="text" class="lightbox-tag-input" id="lightbox-tag-input"
                        placeholder="Add tag..." autocomplete="off">`;

        tagsContainer.innerHTML = html;

        // Favorites button handler
        document.getElementById("lightbox-fav-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            this._toggleFavorite(itemId);
        });

        // Remove tag handler
        tagsContainer.querySelectorAll(".tag-remove").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const tag = btn.dataset.tag;
                const id = btn.dataset.item;
                await this._removeTagsFromItems([id], [tag]);
                this._renderLightboxTagEditor(id);
            });
        });

        // Attach autocomplete to the tag input
        const input = document.getElementById("lightbox-tag-input");

        // Prevent lightbox keyboard nav while typing
        input.addEventListener("keydown", (e) => e.stopPropagation());

        this._lightboxAutocomplete = Autocomplete.attach(input, {
            getItems: () => (typeof Controls !== "undefined" ? Controls.availableTags : []),
            getExclude: () => item.tags || [],
            direction: "up",
            onSelect: async (tagName) => {
                await this._addTagsToItems([itemId], [tagName]);
                input.value = "";
                this._renderLightboxTagEditor(itemId);
            },
        });
    },

    /* ------------------------------------------------------------------
       Select Mode
       ------------------------------------------------------------------ */

    /**
     * Toggle Select Mode on/off.
     */
    toggleSelectMode() {
        this.selectMode = !this.selectMode;
        document.body.classList.toggle("select-mode", this.selectMode);

        if (!this.selectMode) {
            this.clearSelection();
        }

        this._updateBulkBar();
    },

    /**
     * Toggle selection of a specific grid item.
     */
    toggleItem(itemId) {
        if (this.selectedItems.has(itemId)) {
            this.selectedItems.delete(itemId);
        } else {
            this.selectedItems.add(itemId);
        }

        // Update checkbox visual
        const cell = document.querySelector(`.grid-item[data-item-id="${CSS.escape(itemId)}"]`);
        if (cell) {
            cell.classList.toggle("selected", this.selectedItems.has(itemId));
        }

        this._updateBulkBar();
    },

    /**
     * Clear all selections.
     */
    clearSelection() {
        this.selectedItems.clear();
        document.querySelectorAll(".grid-item.selected").forEach(el => {
            el.classList.remove("selected");
        });
        this._updateBulkBar();
    },

    /* ------------------------------------------------------------------
       Bulk Action Bar
       ------------------------------------------------------------------ */

    /**
     * Create the bulk action bar element (hidden by default).
     */
    _createBulkActionBar() {
        const bar = document.createElement("div");
        bar.id = "bulk-action-bar";
        bar.className = "bulk-action-bar";
        bar.innerHTML = `
            <span class="bulk-count" id="bulk-count">0 selected</span>
            <button class="bulk-btn bulk-tag-btn" id="bulk-tag-btn">Tag</button>
            <button class="bulk-btn bulk-delete-btn" id="bulk-delete-btn">Delete</button>
            <button class="bulk-btn bulk-cancel-btn" id="bulk-cancel-btn">Cancel</button>
        `;
        document.body.appendChild(bar);

        document.getElementById("bulk-tag-btn").addEventListener("click", () => {
            this._openTagDialog();
        });
        document.getElementById("bulk-delete-btn").addEventListener("click", () => {
            this._confirmBulkDelete();
        });
        document.getElementById("bulk-cancel-btn").addEventListener("click", () => {
            this.toggleSelectMode();
        });
    },

    /**
     * Update the bulk action bar visibility and count.
     */
    _updateBulkBar() {
        const bar = document.getElementById("bulk-action-bar");
        const count = this.selectedItems.size;

        if (this.selectMode) {
            bar.classList.add("active");
            document.getElementById("bulk-count").textContent =
                `${count} selected`;
            document.getElementById("bulk-tag-btn").disabled = count === 0;
            document.getElementById("bulk-delete-btn").disabled = count === 0;
        } else {
            bar.classList.remove("active");
        }
    },

    /* ------------------------------------------------------------------
       Tag Dialog (for bulk tagging)
       ------------------------------------------------------------------ */

    _createTagDialog() {
        const dialog = document.createElement("div");
        dialog.id = "tag-dialog";
        dialog.className = "modal-dialog";
        dialog.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content">
                <h3>Add Tags</h3>
                <p>Enter tags separated by commas:</p>
                <input type="text" id="tag-dialog-input" class="modal-input"
                       placeholder="e.g. favorites, session-1, cyberpunk" autocomplete="off">
                <div class="modal-actions">
                    <button class="modal-btn modal-cancel" id="tag-dialog-cancel">Cancel</button>
                    <button class="modal-btn modal-confirm" id="tag-dialog-confirm">Add Tags</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        dialog.querySelector(".modal-backdrop").addEventListener("click", () => {
            dialog.classList.remove("active");
        });
        document.getElementById("tag-dialog-cancel").addEventListener("click", () => {
            dialog.classList.remove("active");
        });
        document.getElementById("tag-dialog-confirm").addEventListener("click", () => {
            this._executeBulkTag();
        });

        // Attach autocomplete with comma-aware query extraction
        const input = document.getElementById("tag-dialog-input");
        input.addEventListener("keydown", (e) => e.stopPropagation());

        Autocomplete.attach(input, {
            getItems: () => (typeof Controls !== "undefined" ? Controls.availableTags : []),
            getExclude: () => {
                // Exclude tags already typed in the comma-separated list
                return input.value.split(",").map(t => t.trim()).filter(t => t);
            },
            direction: "down",
            getQuery: (val) => {
                // Only match against text after the last comma
                const parts = val.split(",");
                return parts[parts.length - 1].trim();
            },
            replaceQuery: (val, tag) => {
                // Replace only the last comma-segment with the selected tag
                const parts = val.split(",");
                parts[parts.length - 1] = " " + tag;
                return parts.join(",") + ", ";
            },
            onSelect: () => {
                // Tag appended to input; no further action needed until submit
            },
        });

        // Enter to submit — fires after autocomplete's handler so we can
        // check defaultPrevented to avoid double-handling
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.defaultPrevented) {
                this._executeBulkTag();
            }
        });
    },

    _openTagDialog() {
        const dialog = document.getElementById("tag-dialog");
        const input = document.getElementById("tag-dialog-input");
        input.value = "";
        dialog.classList.add("active");
        setTimeout(() => input.focus(), 100);
    },

    async _executeBulkTag() {
        const input = document.getElementById("tag-dialog-input");
        const tags = input.value.split(",").map(t => t.trim()).filter(t => t);
        if (tags.length === 0) return;

        const itemIds = Array.from(this.selectedItems);
        await this._addTagsToItems(itemIds, tags);

        document.getElementById("tag-dialog").classList.remove("active");
        this.clearSelection();
        this.toggleSelectMode();
    },

    /* ------------------------------------------------------------------
       Confirm Dialog (for deletes)
       ------------------------------------------------------------------ */

    _createConfirmDialog() {
        const dialog = document.createElement("div");
        dialog.id = "confirm-dialog";
        dialog.className = "modal-dialog";
        dialog.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content">
                <h3 id="confirm-dialog-title">Confirm</h3>
                <p id="confirm-dialog-message">Are you sure?</p>
                <div class="modal-actions">
                    <button class="modal-btn modal-cancel" id="confirm-dialog-cancel">Cancel</button>
                    <button class="modal-btn modal-danger" id="confirm-dialog-confirm">Delete</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        dialog.querySelector(".modal-backdrop").addEventListener("click", () => {
            dialog.classList.remove("active");
        });
        document.getElementById("confirm-dialog-cancel").addEventListener("click", () => {
            dialog.classList.remove("active");
        });
    },

    /**
     * Show a confirmation dialog and return a promise that resolves to true/false.
     */
    _confirm(title, message) {
        return new Promise((resolve) => {
            const dialog = document.getElementById("confirm-dialog");
            document.getElementById("confirm-dialog-title").textContent = title;
            document.getElementById("confirm-dialog-message").textContent = message;
            dialog.classList.add("active");

            const confirmBtn = document.getElementById("confirm-dialog-confirm");
            const cancelBtn = document.getElementById("confirm-dialog-cancel");
            const backdrop = dialog.querySelector(".modal-backdrop");

            const cleanup = (result) => {
                dialog.classList.remove("active");
                confirmBtn.removeEventListener("click", onConfirm);
                cancelBtn.removeEventListener("click", onCancel);
                backdrop.removeEventListener("click", onCancel);
                resolve(result);
            };

            const onConfirm = () => cleanup(true);
            const onCancel = () => cleanup(false);

            confirmBtn.addEventListener("click", onConfirm);
            cancelBtn.addEventListener("click", onCancel);
            backdrop.addEventListener("click", onCancel);
        });
    },

    _confirmBulkDelete() {
        const count = this.selectedItems.size;
        this._confirm(
            "Move to Trash",
            `Move ${count} item${count > 1 ? "s" : ""} to trash?`
        ).then(async (confirmed) => {
            if (!confirmed) return;

            const itemIds = Array.from(this.selectedItems);
            await this._deleteItems(itemIds);
            this.clearSelection();
            this.toggleSelectMode();
        });
    },

    /**
     * Delete a single item from the lightbox.
     */
    async deleteCurrent(itemId) {
        const confirmed = await this._confirm(
            "Move to Trash",
            "Move this item to trash?"
        );
        if (!confirmed) return;

        await this._deleteItems([itemId]);

        // Navigate to next item or close lightbox
        if (Lightbox.isOpen) {
            const remaining = Wall.items;
            if (remaining.length === 0) {
                Lightbox.close();
            } else {
                // Find next item to display
                const currentIndex = remaining.findIndex(i => i.id === Lightbox.currentId);
                const nextIndex = currentIndex >= 0 ? currentIndex : 0;
                if (nextIndex < remaining.length) {
                    Lightbox.currentId = remaining[nextIndex].id;
                    Lightbox._displayItem(Lightbox.currentId);
                } else {
                    Lightbox.close();
                }
            }
        }
    },

    /* ------------------------------------------------------------------
       Favorites Toggle
       ------------------------------------------------------------------ */

    /**
     * Toggle the 'favorites' tag on an item.
     */
    async _toggleFavorite(itemId) {
        const item = Wall.items.find(i => i.id === itemId);
        if (!item) return;

        const isFav = (item.tags || []).includes("favorites");
        if (isFav) {
            await this._removeTagsFromItems([itemId], ["favorites"]);
        } else {
            await this._addTagsToItems([itemId], ["favorites"]);
        }

        // Refresh hover overlay if visible
        const cell = document.querySelector(
            `.grid-item[data-item-id="${CSS.escape(itemId)}"]`
        );
        if (cell && cell.querySelector(".fav-btn")) {
            this._showHoverTags(cell);
        }

        // Refresh lightbox tag editor if open
        if (typeof Lightbox !== "undefined" && Lightbox.currentId === itemId) {
            this._renderLightboxTagEditor(itemId);
        }
    },

    /* ------------------------------------------------------------------
       API Helpers
       ------------------------------------------------------------------ */

    async _addTagsToItems(itemIds, tags) {
        const response = await fetch("/api/tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_ids: itemIds, tags: tags }),
        });
        if (response.ok) {
            // Update local state
            itemIds.forEach(id => {
                const item = Wall.items.find(i => i.id === id);
                if (item) {
                    const existing = new Set(item.tags || []);
                    tags.forEach(t => existing.add(t));
                    item.tags = Array.from(existing).sort();
                }
            });
        }
    },

    async _removeTagsFromItems(itemIds, tags) {
        const response = await fetch("/api/tags", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_ids: itemIds, tags: tags }),
        });
        if (response.ok) {
            const removeSet = new Set(tags);
            itemIds.forEach(id => {
                const item = Wall.items.find(i => i.id === id);
                if (item) {
                    item.tags = (item.tags || []).filter(t => !removeSet.has(t));
                }
            });
        }
    },

    async _deleteItems(itemIds) {
        const response = await fetch("/api/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_ids: itemIds }),
        });
        if (response.ok) {
            const idSet = new Set(itemIds);
            // Local removal first for snappy UI
            Wall.items = Wall.items.filter(i => !idSet.has(i.id));
            itemIds.forEach(id => {
                const cell = document.querySelector(
                    `.grid-item[data-item-id="${CSS.escape(id)}"]`
                );
                if (cell) cell.remove();
            });
            // Resync pagination — server-side page boundaries have shifted
            // by N deleted items, so without this the next infinite-scroll
            // fetch would skip N items. Reload happens behind the lightbox
            // when applicable; user only sees the wipe after closing it.
            await reloadGrid();
        }
    },

    /**
     * Escape HTML special characters.
     */
    _escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    },
};


/* =========================================================================
   Grid Click Handler Override for Select Mode
   ========================================================================= */

// Override the grid item click behavior when Select Mode is active.
// wall.js attaches click handlers per-item, but we intercept at the grid level.
document.addEventListener("DOMContentLoaded", () => {
    Tags.init();

    const grid = document.getElementById("media-grid");
    grid.addEventListener("click", (e) => {
        if (!Tags.selectMode) return;

        const gridItem = e.target.closest(".grid-item");
        if (!gridItem) return;

        // Prevent lightbox from opening
        e.stopPropagation();
        Tags.toggleItem(gridItem.dataset.itemId);
    }, true);  // capture phase to intercept before item's own handler
});
