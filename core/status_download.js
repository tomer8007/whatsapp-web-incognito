//
// When a photo/video status is being viewed, create a button to download it that appears, and then handle downloading it
//

var allowStatusDownload = true;
var statusCheckResponses = createResponseRouter(document, "waIncognitoStatusCheckResult", 5000);

Diagnostics.register("status", "hook", "download-all-button", function() { return document.getElementsByClassName("download-all-button-incognito").length; });
Diagnostics.register("status", "selector", "status-viewer", function() { return document.querySelectorAll("[data-animate-status-viewer]").length; });

// "Deleted by sender" label: shown while a status is on screen that the sender deleted and we archived
function checkDeletedStatusLabel()
{
    setTimeout(function()
    {
        var requestId = "status-" + Date.now() + "-" + Math.random();
        statusCheckResponses.waitFor(requestId, function(data)
        {
            if (!data.archived || document.getElementsByClassName("incognito-status-deleted-label").length > 0) return;
            var label = document.createElement("div");
            label.className = "incognito-status-deleted-label";
            label.textContent = t("status.deletedBySender");
            document.body.appendChild(label);
        });
        document.dispatchEvent(new CustomEvent("waIncognitoStatusCheck", { detail: JSON.stringify({ messageID: requestId }) }));
    }, 400);
}

//
// "Download all": downloads every media status of the contact on screen (core/status_bulk.js does the work in the page world).
// Files are saved one by one, 300 ms apart, through ordinary anchor downloads (no extra permission).
//
var statusBulkQueue = [];
var statusBulkBusy = false;
var statusBulkSaving = false;
var STATUS_BULK_SAVE_DELAY_MS = 300;

function setDownloadAllLabel(text)
{
    var button = document.getElementById("incognito-download-all");
    if (button) button.textContent = text;
}

function ensureDownloadAllButton()
{
    if (document.getElementById("incognito-download-all")) return;
    var button = document.createElement("button");
    button.id = "incognito-download-all";
    button.className = "download-all-button-incognito";
    button.textContent = t("status.downloadAll");
    button.title = t("status.downloadAllHint");
    button.addEventListener("click", function()
    {
        if (statusBulkBusy) return;
        statusBulkBusy = true;
        setDownloadAllLabel(t("status.working"));
        document.dispatchEvent(new CustomEvent("getStatusMediaForContact", { detail: JSON.stringify({}) }));
    });
    document.body.appendChild(button);
}

function removeDownloadAllButton()
{
    if (statusBulkBusy) return;
    var button = document.getElementById("incognito-download-all");
    if (button) button.remove();
}

async function saveQueuedStatusItems()
{
    if (statusBulkSaving) return;
    statusBulkSaving = true;
    while (statusBulkQueue.length > 0)
    {
        var item = statusBulkQueue.shift();
        try { downloadBase64AsFile(item.b64, item.mimetype, item.name); }
        catch (e) { console.warn("WAIncognito: could not save a status file"); }
        setDownloadAllLabel(t("status.progress", { index: item.index, total: item.total }));
        await new Promise(function(resolve) { setTimeout(resolve, STATUS_BULK_SAVE_DELAY_MS); });
    }
    statusBulkSaving = false;
}

document.addEventListener("onStatusMediaItem", function(e)
{
    statusBulkQueue.push(JSON.parse(e.detail));
    saveQueuedStatusItems();
});

document.addEventListener("onStatusMediaDone", async function(e)
{
    var result = JSON.parse(e.detail);
    while (statusBulkQueue.length > 0 || statusBulkSaving) await new Promise(function(resolve) { setTimeout(resolve, 100); });

    if (result.error) setDownloadAllLabel(t("status.failedWith", { error: result.error }));
    else if (result.total == 0) setDownloadAllLabel(t("status.noMedia"));
    else if (result.failed > 0) setDownloadAllLabel(t("status.someFailed", { n: result.failed }));
    else setDownloadAllLabel(t("status.done", { n: result.total }));

    statusBulkBusy = false;
    setTimeout(function() { setDownloadAllLabel(t("status.downloadAll")); }, 4000);
});

function removeDeletedStatusLabel()
{
    var labels = document.getElementsByClassName("incognito-status-deleted-label");
    while (labels.length > 0) labels[0].remove();
}

function determineIfNodeIsStatus(node) 
{
    var isNodeStatus = false;
    // is node a picture
    if (node.nodeName == "IMG")
    {
        // get the element 12 levels up
        var parent = node.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
        if (parent?.getAttribute("data-animate-status-viewer") != null)
        {
            isNodeStatus = true;
        }
    }
    else if (node.nodeName == "VIDEO")
    {
        // get the element 8 levels up
        var parent = node.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement.parentElement;
        if (parent?.getAttribute("data-testid") == "status-video")
        {
            isNodeStatus = true;
        }
    }

    return isNodeStatus;
}

function destroyOldButton(src) 
{
    var buttons = document.getElementsByClassName("download-button-incognito");
    // loop through buttons
    for (var i = 0; i < buttons.length; i++) 
    {
        // if the button's src matches the src of the img
        if (buttons[i].id == src) 
        {
            // remove the button
            buttons[i].remove();
        }
        // special case: stream url's are handled wierdly, if the input contains "stream" destroy all buttons with 
        // "" as their src
        if (src.includes("stream"))
        {
            if(buttons[i].id == "status-download-fail-button")
            {
                buttons[i].remove();
            }
        }
    }
}

function createFailNotice(src)
{
    var a = document.createElement("div");
    a.textContent = t("status.reopen");
    a.className = "download-button-incognito";
    a.id = "status-download-fail-button";
    a.download = "failstatus";
    document.body.appendChild(a);    
}
    
function createDownloadButton(src) 
{
    var a = document.createElement("a");
    a.innerHTML =
        "<img src='" + extensionUrl("images/download.svg") + "' >";
    a.className = "download-button-incognito";
    a.href = src;
    a.id = src;
    a.title = t("status.download");
    a.download = "status";
    document.body.appendChild(a);
}

function handleSRCAdd(src, node)
{
    var isStatus = determineIfNodeIsStatus(node);
    if (isStatus) checkDeletedStatusLabel();

    if (!allowStatusDownload) return;

    if (isStatus)
    {
        ensureDownloadAllButton();
        if (src.startsWith("blob:")) 
        {
            createDownloadButton(src)
        }
        else if(src.startsWith("https://web.whatsapp.com/stream/video"))
        {
            // it's a video in the format we can't download
            // ask the user to reopen
            createFailNotice(src)
        }
    }
}

function handleSRCRemove(src, node) 
{
    removeDeletedStatusLabel();
    removeDownloadAllButton();
    if (src != null)
        destroyOldButton(src)
}

function checkNodeAndChildrenForSRC(node, functionToCall)
{
    // if the node is an img or video
    if (node.nodeName == "IMG" ||
        node.nodeName == "VIDEO") 
    {
        // pass the element's src to the handler
        functionToCall(node.src, node)
    }
    // then check if the node has any children and check them, recursively
    if (node.children !== undefined)
    {
        if (node.children.length > 0) 
        {
            for (var j = 0; j < node.children.length; j++) 
            {
                checkNodeAndChildrenForSRC(node.children[j], functionToCall)
            }
        }
    } 
}

// create a mutation observer that looks for any img or video tags being added to the page, any of their src attributes changing, or any of them being removed
var observer = new MutationObserver(function (mutations) 
{
    mutations.forEach(function (mutation) 
    {
        if (mutation.type == "childList") 
        {
            // if a child is added, loop through the added nodes
            for (var i = 0; i < mutation.addedNodes.length; i++) 
            {
                checkNodeAndChildrenForSRC(mutation.addedNodes[i], handleSRCAdd)             
            }
            // if a child is removed, loop through the removed nodes
            for(var i = 0; i < mutation.removedNodes.length; i++)
            {
                checkNodeAndChildrenForSRC(mutation.removedNodes[i], handleSRCRemove)
            }
        } 
        else if (mutation.type == "attributes") 
        {
            // if an attribute is changed, and it's the src attribute
            if (mutation.attributeName == "src") 
            {
                // check that the oldValue is different from the new value
                if (mutation.oldValue == mutation.target.src) 
                {
                    // if it's not, then the mutation is not a change in src
                    return;
                }
                // pass the element's old src to the handler
                handleSRCRemove(mutation.oldValue)
                // pass the element's new src to the handler
                handleSRCAdd(mutation.target.src, mutation.target)
            }
        }
    }
);
});

// start observing the body for changes
observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
});

document.addEventListener('onOptionsUpdate', function (e)
{
    // update enforcing globals
    // TODO: move outside injected_ui.js
    var options = JSON.parse(e.detail);
    if ('allowStatusDownload' in options) allowStatusDownload = options.allowStatusDownload;
});