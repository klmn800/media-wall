/* =========================================================================
   Media Wall — Grid Rendering & Infinite Scroll
   ========================================================================= */

/**
 * Global state for the media wall grid.
 * Other modules (lightbox, tags, controls) read and modify this state.
 */
const Wall = {
    /** All media items currently loaded in the grid */
    items: [],

    /** Current page number for pagination (1-based) */
    currentPage: 0,

    /** Whether more pages are available from the server */
    hasMore: true,

    /** Whether a fetch is currently in progress */
    isLoading: false,

    /** Current sort/filter parameters */
    params: {
        sort_by: "modified",
        sort_order: "desc",
        filter_type: "all",
        filter_tags: "",
        exclude_tags: "",
        search: "",
    },
};


/**
 * Fetch a page of media items from the API.
 *
 * @param {number} page - Page number to fetch (1-based).
 * @returns {Promise<Object>} API response with items, has_more, total_items, etc.
 */
async function fetchMedia(page) {
    const params = new URLSearchParams({
        page: page.toString(),
        per_page: CONFIG.batchSize.toString(),
        sort_by: Wall.params.sort_by,
        sort_order: Wall.params.sort_order,
    });

    if (Wall.params.filter_type !== "all") {
        params.set("filter_type", Wall.params.filter_type);
    }
    if (Wall.params.filter_tags) {
        params.set("filter_tags", Wall.params.filter_tags);
    }
    if (Wall.params.exclude_tags) {
        params.set("exclude_tags", Wall.params.exclude_tags);
    }
    if (Wall.params.search) {
        params.set("search", Wall.params.search);
    }

    const response = await fetch(`/api/media?${params}`);
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}


/**
 * Create a grid cell element for a single media item.
 *
 * Images get an <img> tag with loading="lazy" pointing to the optimized URL.
 * Videos get a <video> tag with the poster frame — the actual video src is
 * set later by video.js when the video scrolls into view.
 *
 * @param {Object} item - Media item from the API.
 * @returns {HTMLElement} The grid cell div.
 */
function createGridItem(item) {
    const cell = document.createElement("div");
    cell.className = "grid-item";
    cell.dataset.itemId = item.id;
    cell.dataset.type = item.type;

    if (item.type === "image") {
        const img = document.createElement("img");
        img.src = item.grid_url;
        img.alt = item.filename;
        img.loading = "lazy";
        img.draggable = false;
        img.onload = () => img.classList.add("loaded");
        cell.appendChild(img);
    } else {
        // Video — poster only, src loaded by Intersection Observer in video.js
        const video = document.createElement("video");
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "none";
        video.draggable = false;
        if (item.poster_url) {
            video.poster = item.poster_url;
        }
        // Store the actual video URL for lazy loading
        video.dataset.src = item.grid_url;
        cell.appendChild(video);
    }

    // Click handler — opens lightbox (implemented in lightbox.js)
    cell.addEventListener("click", () => {
        if (typeof Lightbox !== "undefined" && Lightbox.open) {
            Lightbox.open(item.id);
        }
    });

    return cell;
}


/**
 * Render a batch of media items into the grid.
 *
 * Appends new items to the existing grid content (for infinite scroll).
 * After rendering, notifies video.js to observe any new video elements.
 *
 * @param {Object[]} items - Array of media items from the API.
 */
function renderBatch(items) {
    const grid = document.getElementById("media-grid");

    items.forEach(item => {
        const cell = createGridItem(item);
        grid.appendChild(cell);
        Wall.items.push(item);
    });

    // Notify video.js to observe new video elements
    if (typeof VideoManager !== "undefined" && VideoManager.observeNewVideos) {
        VideoManager.observeNewVideos();
    }
}


/**
 * Load the next page of media items.
 *
 * Called on initial load and by the infinite scroll observer.
 * Prevents concurrent fetches and stops when no more pages available.
 */
async function loadNextPage() {
    if (Wall.isLoading || !Wall.hasMore) return;

    // Don't load media if no include tags are selected (blank wall state)
    if (typeof Controls !== "undefined" && Controls.activeFilterTags.size === 0) return;

    Wall.isLoading = true;
    const loadingIndicator = document.getElementById("loading-indicator");
    loadingIndicator.style.display = "block";

    try {
        Wall.currentPage++;
        const data = await fetchMedia(Wall.currentPage);

        renderBatch(data.items);
        Wall.hasMore = data.has_more;

        if (!Wall.hasMore) {
            loadingIndicator.style.display = "none";
        }
    } catch (error) {
        console.error("Failed to load media:", error);
        loadingIndicator.textContent = "Failed to load media. Check console.";
    } finally {
        Wall.isLoading = false;
        if (Wall.hasMore) {
            loadingIndicator.style.display = "none";
        }
    }
}


/**
 * Clear the grid and reload from page 1.
 *
 * Called when sort/filter parameters change.  If no include tags are
 * selected, shows a placeholder instead of loading media.
 */
async function reloadGrid() {
    const grid = document.getElementById("media-grid");
    grid.innerHTML = "";
    Wall.items = [];
    Wall.currentPage = 0;
    Wall.hasMore = true;
    Wall.isLoading = false;

    // If no include tags are selected, show placeholder instead of loading
    if (typeof Controls !== "undefined" && Controls.activeFilterTags.size === 0) {
        showPlaceholder();
        return;
    }

    await loadNextPage();
}


/**
 * Show a placeholder message when no include tags are selected.
 *
 * If the only filter available is the (untagged) virtual chip — i.e. the
 * folder has no real tags yet — the message points the user at it
 * directly, since "click a tag" would otherwise be confusing advice.
 */
function showPlaceholder() {
    const grid = document.getElementById("media-grid");
    const tags = (typeof Controls !== "undefined" ? Controls.availableTags : []) || [];
    const sentinel = (typeof Controls !== "undefined" ? Controls.untaggedSentinel : "__untagged__");
    const onlyUntagged = tags.length === 1 && tags[0].name === sentinel;
    const noTags = tags.length === 0;

    let message;
    if (onlyUntagged) {
        message = `Open the Controls panel (F) and click <strong>(untagged)</strong> to show everything in this folder.`;
    } else if (noTags) {
        message = `No tagged items yet. Refresh the library or add tags to get started.`;
    } else {
        message = `Open the Controls panel (F) and click a tag to filter, or click <strong>(untagged)</strong> to show files without any tags.`;
    }

    grid.innerHTML = `
        <div class="empty-state">
            <div>
                <p>Nothing to show yet.</p>
                <p style="margin-top: 8px; font-size: 13px;">${message}</p>
            </div>
        </div>
    `;
}


/**
 * Set up the infinite scroll observer.
 *
 * Watches the sentinel element at the bottom of the grid. When it becomes
 * visible (user has scrolled near the bottom), triggers loading the next page.
 */
function initInfiniteScroll() {
    const sentinel = document.getElementById("scroll-sentinel");

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && Wall.hasMore && !Wall.isLoading) {
                    loadNextPage();
                }
            });
        },
        {
            // Trigger when sentinel is within 500px of the viewport
            rootMargin: "0px 0px 500px 0px",
        }
    );

    observer.observe(sentinel);
}


/**
 * Apply config values to CSS custom properties.
 */
function applyGridConfig() {
    const grid = document.getElementById("media-grid");
    grid.style.columnWidth = CONFIG.columnWidth + "px";
    grid.style.columnGap = CONFIG.gridGap + "px";

    // Also update margin-bottom on grid items to match gap
    document.documentElement.style.setProperty(
        "--grid-gap", CONFIG.gridGap + "px"
    );
}


/* =========================================================================
   Initialization
   ========================================================================= */

document.addEventListener("DOMContentLoaded", () => {
    applyGridConfig();
    initInfiniteScroll();
    showPlaceholder();
});
