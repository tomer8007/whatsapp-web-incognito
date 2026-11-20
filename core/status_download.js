//
// When a photo/video status is being viewed, create a button to download it that appears, and then handle downloading it
//

var allowStatusDownload = true;

// Walks up `depth` ancestors of `node`; returns null when the chain runs out early.
function ancestorAtDepth(node, depth)
{
    var current = node;
    for (var i = 0; i < depth && current; i++) current = current.parentElement;
    return current;
}

function determineIfNodeIsStatus(node) 
{
    if (!node || node.nodeType !== 1) return false;
    var isNodeStatus = false;
    // is node a picture
    if (node.nodeName == "IMG")
    {
        if (node.closest && node.closest('[data-animate-status-viewer]'))
        {
            return true;
        }
        // fallback: status containers above the media
        var parent = ancestorAtDepth(node, 13);
        if (parent && parent.getAttribute("data-animate-status-viewer") != null)
        {
            isNodeStatus = true;
        }
    }
    else if (node.nodeName == "VIDEO")
    {
        if (node.closest && node.closest('[data-testid="status-video"]'))
        {
            return true;
        }
        // fallback: status containers above the media
        var parent = ancestorAtDepth(node, 8);
        if (parent && parent.getAttribute("data-testid") == "status-video")
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
    a.innerHTML = "Please re-open the status to download.";
    a.className = "download-button-incognito";
    a.id = "status-download-fail-button";
    a.download = "failstatus";
    document.body.appendChild(a);    
}
    
function createDownloadButton(src) 
{
    var a = document.createElement("a");
    a.innerHTML =
        "<img src='" + chrome.runtime.getURL("images/download.svg") + "' >";
    a.className = "download-button-incognito";
    a.href = src;
    a.id = src;
    a.title = "Download this status!";
    a.download = "status";
    document.body.appendChild(a);
}

function handleSRCAdd(src, node)
{
    if (!allowStatusDownload) return;
    if (src == null) return;

    if (determineIfNodeIsStatus(node))
    {
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
    if (src != null)
        destroyOldButton(src)
}

function checkNodeAndChildrenForSRC(node, functionToCall)
{
    if (!node || node.nodeType !== 1) return;
    if (node.nodeName == "IMG" || node.nodeName == "VIDEO") 
    {
        functionToCall(node.src, node);
    }
    if (node.firstElementChild && node.querySelectorAll)
    {
        var mediaList = node.querySelectorAll("img, video");
        for (var j = 0; j < mediaList.length; j++) 
        {
            functionToCall(mediaList[j].src, mediaList[j]);
        }
    }
}

// Subscribe to shared body MutationObserver (WAIPageBus.DOMObserver) for img/video status changes
function onStatusMutations(mutations)
{
    if (!allowStatusDownload) return;

    mutations.forEach(function (mutation)
    {
        if (mutation.type == "childList")
        {
            // if a child is added, loop through the added nodes
            for (var i = 0; i < mutation.addedNodes.length; i++)
            {
                checkNodeAndChildrenForSRC(mutation.addedNodes[i], handleSRCAdd);
            }
            // if a child is removed, loop through the removed nodes
            for (var i = 0; i < mutation.removedNodes.length; i++)
            {
                checkNodeAndChildrenForSRC(mutation.removedNodes[i], handleSRCRemove);
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
                handleSRCRemove(mutation.oldValue);
                // pass the element's new src to the handler
                handleSRCAdd(mutation.target.src, mutation.target);
            }
        }
    });
}

WAIPageBus.DOMObserver.subscribe(onStatusMutations);

document.addEventListener('onOptionsUpdate', function (e)
{
    try
    {
        var options = typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail;
        if (options && 'allowStatusDownload' in options) allowStatusDownload = options.allowStatusDownload;
    }
    catch (err) {}
});