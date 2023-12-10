//
// When a photo/video status is being viewed, create a button to download it that appears, and then handle downloading it
//

function destroyOldButton(src) {
    var buttons = document.getElementsByClassName("download-button-incognito");
    // loop through buttons
    for (var i = 0; i < buttons.length; i++) {
      // if the button's src matches the src of the img
      if (buttons[i].href == src) {
        // remove the button
        buttons[i].remove();
      }
    }
  }
  
  function createDownloadButton(src) {
    var a = document.createElement("a");
    a.innerHTML =
      "<img src='" + chrome.runtime.getURL("images/download.svg") + "' >";
    a.className = "download-button-incognito";
    a.href = src;
    a.download = "status";
    document.body.appendChild(a);
  }
  
  // create a mutation observer
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var addedNodes = mutations[i].addedNodes;
      var removedNodes = mutations[i].removedNodes;
      // for each added node
      if (addedNodes && addedNodes.length > 0) {
        for (var j = 0; j < addedNodes.length; j++) {
          isStatusChange = false;
          // check if this node change is a status view by looping through all divs and checking for one with the innerText containity "Type a reply"
          var divs = addedNodes[j].getElementsByTagName("div");
          // if there are any
          if (divs.length > 0) {
            // for each div
            for (var k = 0; k < divs.length; k++) {
              // if the div contains the text "Type a reply"
              if (divs[k].innerText.includes("Type a reply")) {
                isStatusChange = true;
              }
            }
          }
          if (isStatusChange) {
            // check if this node contains any nodes that are img/video (at any depth)
            var imgs = addedNodes[j].getElementsByTagName("img");
            var videos = addedNodes[j].getElementsByTagName("video");
            if (imgs.length > 0) {
              // for each img
              for (var k = 0; k < imgs.length; k++) {
                // if the img src starts with blob
                if (imgs[k].src.startsWith("blob")) {
                  // create a button
                  createDownloadButton(imgs[k].src);
                }
              }
            } 
            if (videos.length > 0) {
              for (var k = 0; k < videos.length; k++) {
                // if the img src starts with blob
                if (videos[k].src.startsWith("blob")) {
                  // create a button
                  createDownloadButton(videos[k].src);
                  originalSRC = videos[k].src;
                  // create a mutationobserver: whenever the attribute src changes, update the button's href
                    var observer = new MutationObserver(function (mutations) {
                        for (var i = 0; i < mutations.length; i++) {
                        var attributeName = mutations[i].attributeName;
                        if (attributeName == "src") {
                            // destroy the button
                            destroyOldButton(originalSRC);
                        }
                        }
                    });
                    observer.observe(videos[k], {
                        attributes: true,
                    });
                }
              }
            }
          }
        }
      }
      // for each removed node
      if (removedNodes && removedNodes.length > 0) {
        for (var j = 0; j < removedNodes.length; j++) {
          // check if this removed node contains any nodes that are img (at any depth)
          var imgs = removedNodes[j].getElementsByTagName("img");
          if (imgs.length > 0) {
            // for each img
            for (var k = 0; k < imgs.length; k++) {
              // if the img src starts with blob
              if (imgs[k].src.startsWith("blob")) {
                // remove the button
                destroyOldButton(imgs[k].src);
              }
            }
          }
          // check if this removed node contains any nodes that are video (at any depth)
          var videos = removedNodes[j].getElementsByTagName("video");
          if (videos.length > 0) {
            // Loop through each video
            for (var k = 0; k < videos.length; k++) {
              // Check if the video src starts with blob
              if (videos[k].src.startsWith("blob")) {
                // Remove the button
                destroyOldButton(videos[k].src);
              }
            }
          }
        }
      }
    }
  });
  
  // start observing
  observer.observe(document.getElementById("app"), {
    childList: true,
    subtree: true,
  });