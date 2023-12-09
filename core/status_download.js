// 
// When a photo/video status is being viewed, create a button to download it that appears, and then handle downloading it
//

function checkIfStatusModeActive(){
    // check if there are any div elements with innerText "Type a reply…" in the document body
    var divs = document.getElementsByTagName("div")
    for(var i = 0; i < divs.length; i++){
        if(divs[i].innerText == 'Type a reply…'){
            return true
        }
    }
    return false
}

function destroyOldButtons(){
    var buttons = document.getElementsByClassName("download-button-incognito")
    while(buttons.length > 0){
        buttons[0].parentNode.removeChild(buttons[0])
    }
}

function createDownloadButton(src){
    var a = document.createElement("a");
    a.innerHTML = "<img src='" + chrome.runtime.getURL("images/download.svg") + "' >"
    a.className = "download-button-incognito";
    a.href = src;
    a.download = "status";
    document.body.appendChild(a);
}

function checkIfButtonNeeded(){
    var needed = false
    if(checkIfStatusModeActive()){
        try{
            if(document.getElementsByTagName("video")[0].src.startsWith("blob")){
                needed = true
                var src = document.getElementsByTagName("video")[0].src
            }
        }catch(e){
            // attempt to find a status photo on the page
            try {
                let images = document.getElementsByTagName("img");
                for (let i = 0; i < images.length; i++) {
                    if (images[i].src.startsWith("blob")) {
                        needed = true
                        var src = images[i].src
                        break
                    }
                }
            } catch {
                needed = false;
            }
        }
    }else{
        needed = false
    }
    destroyOldButtons()
    if(needed){
        createDownloadButton(src)
    }
}

// create a mutation observer to check if there a span two elements down from the div with id="app" has child nodes added to it
var observer = new MutationObserver(function(mutations) {
    checkIfButtonNeeded()
});

// start observing
observer.observe(document.getElementById("app"), {
    childList: true,
    subtree: true
});