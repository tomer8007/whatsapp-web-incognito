//
// When a photo/video status is being viewed, create a button to download it that appears, and then handle downloading it
//

function determineIfNodeIsStatus(node) {
  // a correct status photo/img has the following parent classlists: 5, 0, 1, 5, 7, 3, 6
  // it's not a perfect solution
  if(node.parentElement.classList.length == 5){
    if(node.parentElement.parentElement.classList.length == 0){
      if(node.parentElement.parentElement.parentElement.classList.length == 1){
        if(node.parentElement.parentElement.parentElement.parentElement.classList.length == 5){
          return true
        }
      }
    }
  }
  return false
}

function destroyOldButton(src) {
    var buttons = document.getElementsByClassName("download-button-incognito");
    // loop through buttons
    for (var i = 0; i < buttons.length; i++) {
      // if the button's src matches the src of the img
      if (buttons[i].id == src) {
        // remove the button
        buttons[i].remove();
      }
      // special case: stream url's are handled wierdly, if the input contains "stream" destroy all buttons with 
      // "" as their src
      if(src.includes("stream")){
        if(buttons[i].id == "status-download-fail-button"){
          buttons[i].remove();
        }
      }
    }
  }

function createFailNotice(src){
    var a = document.createElement("div");
    a.innerHTML = "Download not found, reopen the status to try again";
    a.className = "download-button-incognito";
    a.id = "status-download-fail-button";
    a.download = "failstatus";
    document.body.appendChild(a);  
}
  
  function createDownloadButton(src) {
    var a = document.createElement("a");
  
    a.innerHTML =
      "<img src='" + chrome.runtime.getURL("images/download.svg") + "' >";
    a.className = "download-button-incognito";
    a.href = src;
    a.id = src;
    a.download = "status";
    document.body.appendChild(a);
  }

function handleSRCAdd(src, node){
  if(determineIfNodeIsStatus(node)){
    if (src.startsWith("blob:")) {
      createDownloadButton(src)
    }else if(src.startsWith("https://web.whatsapp.com/stream/video")){
      // it's a video in the format we can't download
      // ask the user to reopen
      createFailNotice(src)
    }
  }
}

function handleSRCRemove(src, node) {
  destroyOldButton(src)
}

function checkNodeAndChildrenForSRC(node, functionToCall){
  // if the node is an img or video
  if (
    node.nodeName == "IMG" ||
    node.nodeName == "VIDEO"
  ) {
    // pass the element's src to the handler
    functionToCall(node.src, node)
  }
  // then check if the node has any children and check them, recursively
  if (node.children.length > 0) {
    for (var j = 0; j < node.children.length; j++) {
      checkNodeAndChildrenForSRC(node.children[j], functionToCall)
    }
  } 
}

// create a mutation observer that looks for any img or video tags being added to the page, any of their src attributes changing, or any of them being removed
var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type == "childList") {
        // if a child is added, loop through the added nodes
        for (var i = 0; i < mutation.addedNodes.length; i++) {
          checkNodeAndChildrenForSRC(mutation.addedNodes[i], handleSRCAdd)       
        }
        // if a child is removed, loop through the removed nodes
        for(var i = 0; i < mutation.removedNodes.length; i++){
          checkNodeAndChildrenForSRC(mutation.removedNodes[i], handleSRCRemove)
        }
      } else if (mutation.type == "attributes") {
        // if an attribute is changed, and it's the src attribute
        if (mutation.attributeName == "src") {
          // pass the element's old src to the handler
          handleSRCRemove(mutation.oldValue)
          // pass the element's new src to the handler
          handleSRCAdd(mutation.target.src)
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