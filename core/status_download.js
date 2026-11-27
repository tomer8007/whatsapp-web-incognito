// A body observer discovers the viewer. Only the viewer needs media and src observation.
const statusImageViewer = "[data-animate-status-viewer]";
const statusVideoViewer = '[data-testid="status-video"]';
const statusViewerSelector = statusImageViewer + ", " + statusVideoViewer;
const statusFileExtensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/3gpp": "3gp",
};
let statusViewers = [];
let statusControl;
let statusSource;
let statusDeletionBadge;
let allowStatusDownload = true;
let markDeletedStatuses = false;

const statusMediaObserver = new MutationObserver(updateStatusDownload);
const statusViewerObserver = new MutationObserver(findStatusViewer);

function stopWatchingStatusMedia()
{
    statusMediaObserver.disconnect();
    for (const viewer of statusViewers)
    {
        viewer.removeEventListener("load", updateStatusDownload, true);
        viewer.removeEventListener("loadedmetadata", updateStatusDownload, true);
    }
}

function findStatusViewer(mutations)
{
    if (mutations && statusViewers.length && statusViewers.every(viewer => viewer.isConnected && viewer.matches(statusViewerSelector))
        && !mutations.some(record => record.type === "attributes"
            ? record.target.matches(statusViewerSelector)
            : Array.from(record.addedNodes).some(node => node.nodeType === 1
                && (node.matches(statusViewerSelector) || node.querySelector(statusViewerSelector)))))
        return;

    const viewers = Array.from(document.querySelectorAll(statusViewerSelector))
        .filter(viewer => !viewer.parentElement?.closest(statusViewerSelector));
    if (viewers.length === statusViewers.length && viewers.every((viewer, index) => viewer === statusViewers[index]))
        return;
    stopWatchingStatusMedia();
    statusViewers = viewers;
    for (const viewer of statusViewers)
    {
        statusMediaObserver.observe(viewer, { childList: true, characterData: true, subtree: true, attributeFilter: ["src", "data-testid", "data-animate-status-viewer"] });
        viewer.addEventListener("load", updateStatusDownload, true);
        viewer.addEventListener("loadedmetadata", updateStatusDownload, true);
    }
    updateStatusDownload();
}

function readStatusViewerInfo(node)
{
    if (!node) return null;
    let info = null;
    const receive = event =>
    {
        try { info = JSON.parse(event.detail); }
        catch { info = null; }
    };
    document.addEventListener("onStatusViewerInfo", receive);
    try
    {
        node.dispatchEvent(new CustomEvent("getStatusViewerInfo", { bubbles: true }));
    }
    finally
    {
        document.removeEventListener("onStatusViewerInfo", receive);
    }
    return info;
}

function statusFilename(info, viewer, media)
{
    const scope = viewer.closest('[role="dialog"]') ?? viewer.parentElement ?? viewer;
    const header = scope.querySelector('[data-testid*="contact-name"]') ?? scope.querySelector("header span[title], header div[title]");
    const name = (typeof info?.name === "string" && info.name.trim()) || header?.getAttribute("title") || header?.textContent || "";
    const safeName = name.trim().replace(/[\s<>:"/\\|?*\[\]\u0000-\u001f\u007f]+/g, "_").slice(0, 80).replace(/^[._]+|[._]+$/g, "");
    let filename = safeName || "status";
    const date = Number.isFinite(info?.timestamp) && info.timestamp > 0 ? new Date(info.timestamp * 1000) : null;
    if (date && Number.isFinite(date.getTime()))
    {
        const pad = value => String(value).padStart(2, "0");
        // Colons are reserved in Windows filenames.
        const day = date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
        const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join("-");
        filename += "_" + day + "-" + time;
    }

    const mimeType = typeof info?.mimeType === "string" ? info.mimeType : media?.querySelector("source[type]")?.type;
    const format = mimeType?.split(";")[0].trim().toLowerCase();
    return Object.hasOwn(statusFileExtensions, format) ? filename + "." + statusFileExtensions[format] : filename;
}

function showStatusDeletionBadge(deleted)
{
    if (deleted && !statusDeletionBadge)
    {
        statusDeletionBadge = document.createElement("div");
        statusDeletionBadge.className = "status-deletion-incognito";
        statusDeletionBadge.setAttribute("role", "status");
        statusDeletionBadge.textContent = "Deleted by the uploader · kept by WAIncognito";
        document.body.appendChild(statusDeletionBadge);
    }
    else if (!deleted && statusDeletionBadge)
    {
        statusDeletionBadge.remove();
        statusDeletionBadge = null;
    }
}

function updateStatusDownload()
{
    let source;
    let selectedViewer = statusViewers.find(viewer => viewer.isConnected);
    let selectedMedia;
    let largest = 0;
    for (const viewer of statusViewers)
    {
        if (!viewer.isConnected) continue;
        const mediaNodes = viewer.matches("video") ? [viewer] : viewer.querySelectorAll("img[src], video");
        for (const media of mediaNodes)
        {
            const isImage = media.tagName === "IMG";
            if (isImage && !media.closest(statusImageViewer)) continue;
            const url = media.src || media.currentSrc || media.querySelector("source[src]")?.src;
            if (!url) continue;

            // shortcut: use rendered size to exclude avatars until WhatsApp exposes a stable status image selector.
            if (isImage && Math.max(media.clientWidth, media.clientHeight) < 128) continue;
            const area = Math.max(1, media.clientWidth * media.clientHeight);
            if (area < largest) continue;
            largest = area;
            source = url;
            selectedViewer = viewer;
            selectedMedia = media;
        }
    }

    const activeNode = selectedMedia ?? selectedViewer;
    const info = markDeletedStatuses ? readStatusViewerInfo(activeNode) : null;
    showStatusDeletionBadge(info?.deleted === true);

    if (!allowStatusDownload || (!source?.startsWith("blob:") && !source?.startsWith("https://web.whatsapp.com/stream/video")))
        source = undefined;

    if (source === statusSource && statusControl?.isConnected) return;
    statusControl?.remove();
    statusControl = null;
    statusSource = source;
    if (!source) return;

    if (source.startsWith("blob:"))
    {
        statusControl = document.createElement("a");
        statusControl.href = source;
        statusControl.title = "Download this status!";
        statusControl.download = statusFilename(info ?? readStatusViewerInfo(activeNode), selectedViewer, selectedMedia);
        statusControl.addEventListener("click", function ()
        {
            this.download = statusFilename(readStatusViewerInfo(activeNode), selectedViewer, selectedMedia);
        });
        statusControl.setAttribute("aria-label", statusControl.title);
        const icon = document.createElement("img");
        icon.src = chrome.runtime.getURL("images/download.svg");
        icon.alt = "";
        statusControl.appendChild(icon);
    }
    else
    {
        statusControl = document.createElement("div");
        statusControl.id = "status-download-fail-button";
        statusControl.textContent = "Please re-open the status to download.";
    }
    statusControl.className = "download-button-incognito";
    document.body.appendChild(statusControl);
}

function startStatusDownload()
{
    statusViewerObserver.observe(document.body, { childList: true, subtree: true, attributeFilter: ["data-testid", "data-animate-status-viewer"] });
    findStatusViewer();
}

startStatusDownload();
document.addEventListener("onStatusDeletionBlocked", function ()
{
    if (markDeletedStatuses && statusViewers.length) updateStatusDownload();
});

document.addEventListener("onOptionsUpdate", function (event)
{
    const options = JSON.parse(event.detail);
    const download = options?.allowStatusDownload ?? allowStatusDownload;
    const markDeleted = options?.saveDeletedMsgs ?? markDeletedStatuses;
    if (download === allowStatusDownload && markDeleted === markDeletedStatuses) return;

    const wasWatching = allowStatusDownload || markDeletedStatuses;
    allowStatusDownload = download === true;
    markDeletedStatuses = markDeleted === true;
    if (!wasWatching && (allowStatusDownload || markDeletedStatuses))
    {
        startStatusDownload();
        return;
    }
    if (!allowStatusDownload && !markDeletedStatuses)
    {
        statusViewerObserver.disconnect();
        stopWatchingStatusMedia();
        statusViewers = [];
    }
    updateStatusDownload();
});
