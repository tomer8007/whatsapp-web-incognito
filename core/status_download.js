// A body observer discovers the viewer. Only the viewer needs media and src observation.
const statusViewerSelector = '[data-animate-status-viewer], [data-testid="status-video"]';
let statusViewer;
let statusControl;
let statusSource;
let allowStatusDownload = true;

const statusMediaObserver = new MutationObserver(updateStatusDownload);
const statusViewerObserver = new MutationObserver(findStatusViewer);

function findStatusViewer()
{
    if (statusViewer?.isConnected) return;

    statusMediaObserver.disconnect();
    statusViewer = document.querySelector(statusViewerSelector);
    if (statusViewer)
        statusMediaObserver.observe(statusViewer, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    updateStatusDownload();
}

function updateStatusDownload()
{
    let source;
    if (statusViewer?.isConnected)
    {
        for (const media of statusViewer.querySelectorAll("img[src], video[src]"))
        {
            // shortcut: WhatsApp's nesting distinguishes media from avatars, use media-specific selectors when available.
            let parent = media.parentElement;
            const isImage = media.tagName === "IMG";
            for (let depth = 1; parent && depth < (isImage ? 12 : 8); depth++)
                parent = parent.parentElement;

            if (parent?.matches(isImage ? "[data-animate-status-viewer]" : '[data-testid="status-video"]')
                && (media.src.startsWith("blob:") || media.src.startsWith("https://web.whatsapp.com/stream/video")))
                source = media.src;
        }
    }

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
        statusControl.download = "status";
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
    statusViewerObserver.observe(document.body, { childList: true, subtree: true });
    findStatusViewer();
}

startStatusDownload();
document.addEventListener("onOptionsUpdate", function (event)
{
    const enabled = JSON.parse(event.detail)?.allowStatusDownload;
    if (typeof enabled !== "boolean" || enabled === allowStatusDownload) return;

    allowStatusDownload = enabled;
    if (enabled)
        startStatusDownload();
    else
    {
        statusViewerObserver.disconnect();
        statusMediaObserver.disconnect();
        statusViewer = null;
        updateStatusDownload();
    }
});
