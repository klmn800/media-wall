/* =========================================================================
   Media Wall — Tag Autocomplete Dropdown
   ========================================================================= */

/**
 * Reusable tag autocomplete dropdown.
 *
 * Attaches to an <input> element and shows a filtered dropdown of
 * existing tags as the user types.  Supports keyboard navigation,
 * click selection, and free-text entry for new tags.
 *
 * Usage:
 *   const ctrl = Autocomplete.attach(inputEl, {
 *       getItems:      () => Controls.availableTags,   // [{name, count}, ...]
 *       getExclude:    () => item.tags || [],           // tags to hide
 *       onSelect:      (tagName) => { ... },           // selection callback
 *       direction:     "up",                           // "up" or "down"
 *       getQuery:      (val) => val.trim(),            // extract search term
 *       replaceQuery:  (val, tag) => tag,              // build new input value
 *   });
 *   ctrl.destroy();  // clean up
 */
const Autocomplete = {

    /**
     * Attach autocomplete behavior to an input element.
     *
     * @param {HTMLInputElement} input - The text input to enhance.
     * @param {Object} options
     * @param {Function} options.getItems     - Returns array of {name, count}.
     * @param {Function} options.getExclude   - Returns array of tag name strings to hide.
     * @param {Function} options.onSelect     - Called with the selected tag name.
     * @param {string}   [options.direction]  - "down" (default) or "up".
     * @param {Function} [options.getQuery]   - Extract search term from input value.
     * @param {Function} [options.replaceQuery] - Build new input value after selection.
     * @returns {Object} Controller with destroy() method.
     */
    attach(input, options) {
        const {
            getItems,
            getExclude = () => [],
            onSelect,
            direction = "down",
            getQuery = (val) => val.trim(),
            replaceQuery = (_val, tag) => tag,
        } = options;

        // --- Create dropdown element ---
        const dropdown = document.createElement("div");
        dropdown.className = `autocomplete-dropdown direction-${direction}`;

        // Wrap the input in a relative-positioned container
        const wrapper = document.createElement("div");
        wrapper.className = "autocomplete-wrapper";
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        wrapper.appendChild(dropdown);

        let highlightIndex = -1;
        let currentMatches = [];
        let blurTimeout = null;

        /** Render the dropdown with filtered matches. */
        function render() {
            const query = getQuery(input.value).toLowerCase();
            const excluded = new Set(getExclude());
            const allItems = getItems() || [];

            currentMatches = allItems.filter(item =>
                !excluded.has(item.name) &&
                (query === "" || item.name.toLowerCase().includes(query))
            );

            if (currentMatches.length === 0 || query === "") {
                dropdown.classList.remove("active");
                highlightIndex = -1;
                return;
            }

            // Cap at a reasonable display limit
            const displayItems = currentMatches.slice(0, 20);

            dropdown.innerHTML = displayItems.map((item, idx) =>
                `<div class="autocomplete-item${idx === highlightIndex ? " highlighted" : ""}"
                      data-index="${idx}" data-tag="${escapeAttr(item.name)}">
                    ${escapeHtml(item.name)}
                    <span class="autocomplete-count">${item.count}</span>
                </div>`
            ).join("");

            dropdown.classList.add("active");
        }

        /** Select the tag at the given index, or use typed text if index is -1. */
        function selectItem(index) {
            let tagName;
            if (index >= 0 && index < currentMatches.length) {
                tagName = currentMatches[index].name;
            } else {
                tagName = getQuery(input.value).trim();
            }

            if (!tagName) return;

            input.value = replaceQuery(input.value, tagName);
            dropdown.classList.remove("active");
            highlightIndex = -1;
            onSelect(tagName);
        }

        function escapeHtml(str) {
            const div = document.createElement("div");
            div.textContent = str;
            return div.innerHTML;
        }

        function escapeAttr(str) {
            return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        }

        // --- Event handlers ---

        function onInput() {
            highlightIndex = -1;
            render();
        }

        function onKeydown(e) {
            if (!dropdown.classList.contains("active")) {
                // If Enter pressed with no dropdown, treat as free-text submit
                if (e.key === "Enter") {
                    const query = getQuery(input.value).trim();
                    if (query) {
                        e.preventDefault();
                        selectItem(-1);
                    }
                }
                return;
            }

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    highlightIndex = Math.min(
                        highlightIndex + 1,
                        Math.min(currentMatches.length, 20) - 1
                    );
                    render();
                    break;

                case "ArrowUp":
                    e.preventDefault();
                    highlightIndex = Math.max(highlightIndex - 1, -1);
                    render();
                    break;

                case "Enter":
                    e.preventDefault();
                    selectItem(highlightIndex);
                    break;

                case "Escape":
                    e.preventDefault();
                    dropdown.classList.remove("active");
                    highlightIndex = -1;
                    break;
            }
        }

        function onDropdownClick(e) {
            const item = e.target.closest(".autocomplete-item");
            if (!item) return;
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(item.dataset.index, 10);
            selectItem(idx);
        }

        function onFocusOut() {
            // Delay so click events on dropdown items can fire first
            blurTimeout = setTimeout(() => {
                dropdown.classList.remove("active");
                highlightIndex = -1;
            }, 150);
        }

        function onFocusIn() {
            if (blurTimeout) {
                clearTimeout(blurTimeout);
                blurTimeout = null;
            }
        }

        // Prevent dropdown clicks from triggering input blur
        function onDropdownMousedown(e) {
            e.preventDefault();
        }

        // --- Wire up ---
        input.addEventListener("input", onInput);
        input.addEventListener("keydown", onKeydown);
        input.addEventListener("focusout", onFocusOut);
        input.addEventListener("focusin", onFocusIn);
        dropdown.addEventListener("click", onDropdownClick);
        dropdown.addEventListener("mousedown", onDropdownMousedown);

        // --- Return controller ---
        return {
            destroy() {
                input.removeEventListener("input", onInput);
                input.removeEventListener("keydown", onKeydown);
                input.removeEventListener("focusout", onFocusOut);
                input.removeEventListener("focusin", onFocusIn);
                dropdown.removeEventListener("click", onDropdownClick);
                dropdown.removeEventListener("mousedown", onDropdownMousedown);
                if (blurTimeout) clearTimeout(blurTimeout);
                // Unwrap: move input out of wrapper, remove wrapper
                if (wrapper.parentNode) {
                    wrapper.parentNode.insertBefore(input, wrapper);
                    wrapper.remove();
                }
            },
        };
    },
};
