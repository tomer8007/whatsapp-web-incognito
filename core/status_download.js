//
// When a photo/video status is being viewed, create a button to download it that appears, and then handle downloading it
//

var allowStatusDownload = true;

function determineIfNodeIsStatus(node) 
{
    var isNodeStatus = false;
    // is node a picture
    if(node.nodeName == "IMG")
    {
        // get the element 7 levels up
        var parent = node.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
    }
    else if (node.nodeName == "VIDEO")
    {
        // get the element 6 levels up
        var parent = node.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
    }
    // traverse the DOM to get the element with the data-icon "status-media-controls"
    var child = parent?.children[1]?.children[2]?.children[0]?.children[0]?.children[0]?.children[0]?.children[0];
    // if the element has a data-icon of "status-media-controls-pause", then the original element is a status
    if (child?.getAttribute("data-icon") === "status-media-controls-pause") 
    {
        isNodeStatus = true;
    }
    else
    {
        isNodeStatus = false;
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