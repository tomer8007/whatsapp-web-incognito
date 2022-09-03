/*
This is a content script responsible for some UI.
*/

if (chrome != undefined) 
{
	var browser = chrome;
}

initialize();

var isInterceptionWorking = false;
var isMultiDevice = false;
var isUIClassesWorking = true;
var deletedMessagesDB = null;
var pseudoMsgsIDs = new Set();

function initialize()
{
    // load saved settings
    browser.runtime.sendMessage({ name: "getOptions" }, function (options)
    {
        document.dispatchEvent(new CustomEvent('onOptionsUpdate',
        {
            detail: JSON.stringify(options)
        }));

        // ratify it
        var optionsMessage = options;
        optionsMessage.name = "setOptions";
        browser.runtime.sendMessage(optionsMessage);
    });

    // initialize mutation observer
    var appElem = document.getElementById("app");
    if (appElem != undefined)
    {
        var mutationObserver = new MutationObserver(function (mutations)
        {
            var found = false;
            for (var i = 0; i < mutations.length; i++)
            {
                var addedNodes = mutations[i].addedNodes;
                var removedNodes = mutations[i].removedNodes;

                for (var j = 0; j < addedNodes.length; j++)
                {
                    var addedNode = addedNodes[j];
                    if (addedNode.classList == undefined) continue;

                    if (addedNode.getElementsByClassName("two").length > 0)
                    {
                        // main app was added, UI is ready
                        addIconIfNeeded();
                        setTimeout(function () { onMainUIReady(); }, 100);

                        found = true;
                        break;
                    }
                    else if (addedNode.nodeName.toLowerCase() == "div" && addedNode.classList.contains(UIClassNames.OUTER_DROPDOWN_CLASS))
                    {
                        setTimeout(function ()
                        {
                            document.dispatchEvent(new CustomEvent('onDropdownOpened', {}));

                        }, 200);
                    }

                    // Scan for deleted messages and replace the text
                    if (addedNode.nodeName.toLowerCase() == "div" && addedNode.id.toLowerCase() == "main")
                    {
                        const msgNodes = addedNode.querySelectorAll("div.message-in");
                        for (let i = 0; i < msgNodes.length; i++)
                        {
                            const currentNode = msgNodes[i];
                            restoreDeletedMessage(currentNode);
                        }
                    }
                    else if (addedNode.nodeName.toLowerCase() == "div" 
                            && (addedNode.classList.contains("message-in")))
                    {
                        restoreDeletedMessage(addedNode);
                    }
                }
                
                for (var j = 0; j < removedNodes.length; j++)
                {
                    var removedNode = removedNodes[j];
                    if (removedNode.classList == undefined) continue;
                    if (removedNode.classList.contains("two"))
                    {
                        // main app was removed, remove our artifacts
                        var menuItem = document.getElementsByClassName("menu-item-incognito")[0];
                        var dropItem = document.getElementsByClassName("drop")[0];
                        if (menuItem != undefined) menuItem.remove();
                        if (dropItem != undefined) dropItem.remove();

                        found = true;
                        break;
                    }

                }
                if (found) break;
            }
        });

        mutationObserver.observe(appElem, { childList: true, subtree: true });
    }

}

function onMainUIReady()
{
    document.dispatchEvent(new CustomEvent('onMainUIReady', {}));

    setTimeout(checkInterception, 1000);

    // if the menu item is gone somehow after a short period of time (e.g because the layout changes from right-to-left) add it again
    // TODO: a race can make the icon added twice
    setTimeout(addIconIfNeeded, 1000);
}

async function addIconIfNeeded()
{
    if (document.getElementsByClassName("menu-item-incognito").length > 0) return; // already added

    var firstMenuItem = document.getElementsByClassName(UIClassNames.MENU_ITEM_CLASS)[0];
    if (firstMenuItem != undefined)
    {
        var menuItemElem = document.createElement("div");
        menuItemElem.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");

        menuItemElem.innerHTML = '<div aria-disabled="false" role="button" tabindex="0" class="_26lC3" title="Incognito Options" \
                                aria-label="Incognito Options"><span data-testid="menu" data-icon="menu" class=""><svg viewBox="0 0 26 26" \
                                width="24" height="24" class=""><path fill="currentColor" d=""></path></svg></span></div><span></span>';
        var path = menuItemElem.getElementsByTagName("path")[0];
        var svg = menuItemElem.getElementsByTagName("svg")[0];

        var response = await fetch(chrome.runtime.getURL("images/incognito_gray_24.svg"));
		var text = await response.text();
        var dom = new DOMParser().parseFromString(text, 'text/html');
        var svgHtml = dom.getElementsByTagName("svg")[0].innerHTML;
        svg.innerHTML = svgHtml;

        firstMenuItem.parentElement.insertBefore(menuItemElem, firstMenuItem);

        browser.runtime.sendMessage({ name: "getOptions" }, function (options)
        {
            document.dispatchEvent(new CustomEvent('onOptionsUpdate', { detail: JSON.stringify(options) }));

            var dropContent = generateDropContent(options);
            var drop = new Drop(
            {
                target: menuItemElem,
                content: dropContent,
                position: "bottom left",
                classes: "drop-theme-incognito",
                openOn: "click",
                tetherOptions:
                {
                    offset: "-4px -4px 0 0"
                },
            });
            var originalCloseFunction = drop.close;
            drop.close = function ()
            {
                document.dispatchEvent(new CustomEvent('onIncognitoOptionsClosed', { detail: null }));
                setTimeout(function () { originalCloseFunction.apply(drop, arguments); }, 100);
            }
            drop.on("open", function ()
            {
                if (!checkInterception()) return;
                var pressedMenuItemClass = UIClassNames.MENU_ITEM_CLASS + " " + UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS + " active menu-item-incognito";
                document.getElementsByClassName("menu-item-incognito")[0].setAttribute("class", pressedMenuItemClass);

                document.getElementById("incognito-option-read-confirmations").addEventListener("click", onReadConfirmaionsTick);
                document.getElementById("incognito-option-presence-updates").addEventListener("click", onPresenseUpdatesTick);
                document.getElementById("incognito-option-save-deleted-msgs").addEventListener("click", onSaveDeletedMsgsTick);
                document.getElementById("incognito-option-safety-delay").addEventListener("input", onSafetyDelayChanged);
                document.getElementById("incognito-option-safety-delay").addEventListener("keypress", isNumberKey);
                document.getElementById("incognito-radio-enable-safety-delay").addEventListener("click", onSafetyDelayEnabled);
                document.getElementById("incognito-radio-disable-safety-delay").addEventListener("click", onSafetyDelayDisabled);

                document.dispatchEvent(new CustomEvent('onIncognitoOptionsOpened', { detail: null }));
            });
            drop.on("close", function ()
            {
                document.getElementsByClassName("menu-item-incognito")[0].setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");

                document.getElementById("incognito-option-read-confirmations").removeEventListener("click", onReadConfirmaionsTick);
                document.getElementById("incognito-option-presence-updates").removeEventListener("click", onPresenseUpdatesTick);
                document.getElementById("incognito-radio-enable-safety-delay").removeEventListener("click", onSafetyDelayEnabled);
                document.getElementById("incognito-radio-disable-safety-delay").removeEventListener("click", onSafetyDelayDisabled);
            });
        });
    }
    else if (isUIClassesWorking)
    {
        isUIClassesWorking = false;
        Swal.fire({
            title: "WAIncognito is temporarily broken",
            html: 'It seems that due to a recent WhatsApp Web update some graphical elements of the extnesion will not appear. \
                    <br><Br> Please be patient for a few days until a newer compatible version will be released.',
            icon: "warning",
            width: 600,
            confirmButtonColor: "#DD6B55",
            confirmButtonText: "Got it",
        });
    }
}

function generateDropContent(options)
{
    var presenceCaption = isMultiDevice ? "Will prevent you from seeing other people's last seen" : 
                                          "Blocks outgoing presence updates.";
    var deletedMessagesTitle = "Save deleted messages";
    var deletedMessagesCaption = isMultiDevice ? "Prevents messages from getting deleted" : 
                                                 "Saves deleted messages and restores them later.";

    var dropContent = " \
        <div class='incognito-options-container' dir='ltr'> \
            <div class='incognito-options-title'>Incognito options</div> \
                                                                        \
                                                                        \
            <div class='incognito-options-item'> \
                <div id='incognito-option-read-confirmations' style='cursor: pointer !important; margin-bottom: 10px'> \
                    <div class='checkbox-container-incognito' style=''> \
                        <div class='checkbox checkbox-incognito " + (options.readConfirmationsHook ? "checked incognito-checked'> \
                        <div class='checkmark incognito-mark incognito-marked'> </div>" :
                        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>") + "\
                        </div> \
                    </div> \
                    Don't send read confirmations \
                    <div class='incognito-options-description'>Messages that their read confirmation was blocked<p> \
                    will be marked in red instead of green.</div> \
                </div> \
                        \
                        \
                <div id='incognito-safety-delay-option-panel' style='margin-left: 28px !important; margin-top: 0px; font-size: 12px; opacity: 0.8'> \
                    Send after safety delay: <br> \
                    <div style='margin-top: 7px'> \
                        <div id='incognito-option-disable-safety-delay' style='display: inline-block;' > \
                            <input id='incognito-radio-disable-safety-delay' type='radio' class='radio-input' "
                                + (options.safetyDelay <= 0 ? "checked" : "") + " /> \
                            Never \
                        </div> \
                        <div id='incognito-option-enable-safety-delay' style='display: inline-block; margin-left: 20px;'> \
                            <input id='incognito-radio-enable-safety-delay' type='radio' class='radio-input' name='example' "
                                + (options.safetyDelay > 0 ? "checked" : "") + "/> \
                            After <input id='incognito-option-safety-delay' type='number' class='seconds-incognito-input' min='1' max='30' \
                            step='1' placeholder='5' " + (options.safetyDelay <= 0 ? "disabled" : "") + " "
                                + (options.safetyDelay > 0 ? "value='" + options.safetyDelay + "'" : "") + "/> seconds \
                        </div> \
                    </div> \
                </div> \
            </div> \
                    \
                    \
            <div id='incognito-option-presence-updates' class='incognito-options-item' style='cursor: pointer;'> \
                <div class='checkbox-container-incognito' style=''> \
                    <div class='checkbox checkbox checkbox-incognito " + (options.presenceUpdatesHook ? "checked incognito-checked'> \
                    <div class='checkmark incognito-mark incognito-marked'> </div>" :
                    "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>") + "\
                    </div> \
                </div> \
                Don't send \"Last Seen\" and \"Online\" updates \
                <div class='incognito-options-description'>" + presenceCaption + "</div> \
            </div>" + 
            "<div id='incognito-option-save-deleted-msgs' class='incognito-options-item' style='cursor: pointer;'> \
            <div class='checkbox-container-incognito' style=''> \
                <div class='checkbox checkbox checkbox-incognito " + (options.saveDeletedMsgs ? "checked incognito-checked'> \
                <div class='checkmark incognito-mark incognito-marked'> </div>" :
                    "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>") + "\
                </div> \
            </div> \
            " + deletedMessagesTitle + " \
            <div class='incognito-options-description'>" + deletedMessagesCaption + "</div>" + 
        "</div> \
        </div>";

    return dropContent;
}

document.addEventListener('onMarkAsReadClick', function (e)
{
    var data = JSON.parse(e.detail);
    browser.runtime.sendMessage({ name: "getOptions" }, function (options)
    {
        if (options.readConfirmationsHook)
        {
            if (options.showReadWarning)
            {
                Swal.fire({
                    title: "Mark as read?",
                    text: data.formattedName + " will be able to tell you read the last " + 
                            (data.unreadCount > 1 ? data.unreadCount + " messages." : " message."),
                    input: 'checkbox',
                    inputValue: 0,
                    inputPlaceholder: "Don't show this warning again",
                    icon: "warning",
                    showCancelButton: true,
                    confirmButtonColor: "#DD6B55",
                    confirmButtonText: "Yes, send receipt",
                }).then(result =>
                {
                    if (result.isConfirmed)
                    {
                        document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));
                        //swal("Sent!", "Messages were marked as read", "success");

                        var shouldShowReadWarning = result.value == 0;
                        browser.runtime.sendMessage({ name: "setOptions", showReadWarning: shouldShowReadWarning });
                        document.dispatchEvent(new CustomEvent('onOptionsUpdate', { detail: JSON.stringify({ showReadWarning: shouldShowReadWarning }) }));
                    }
                });
            }
            else
            {
                // just send it withoung warning
                document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));
            }
        }
    });
});

document.addEventListener('onInterceptionWorking', function (e)
{
    var data = JSON.parse(e.detail);
    isInterceptionWorking = data.isInterceptionWorking;
    isMultiDevice = data.isMultiDevice;

    // populate pseudoMsgsIDs
    var deletedDBOpenRequest = indexedDB.open("deletedMsgs", 1);
    deletedDBOpenRequest.onsuccess = () => 
    {
        var deletedMsgsDB = deletedDBOpenRequest.result;
        var keys = deletedMsgsDB.transaction('msgs', "readonly").objectStore("msgs").getAll();
        keys.onsuccess = () => {
            keys.result.forEach((value) => {
                pseudoMsgsIDs.add(value.originalID);
            });
            document.addEventListener("pseudoMsgs", (e) => {
                pseudoMsgsIDs.add(e.detail);
            });
        };
        deletedMsgsDB.close();
    };
});

function getTheme() 
{
    // light/dark mode detection
    if (localStorage["theme"] != "null" && localStorage["theme"] != undefined) 
        return localStorage["theme"]
    else 
    {
        // this is if there is no theme selected by default (null)
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches || 
            document.getElementsByClassName("web")[0].classList.contains("dark")) 
            return "\"dark\"";
        else 
            return "\"light\"";
    }
}

//
// Drop handlers
//

function onReadConfirmaionsTick()
{
    var readConfirmationsHook = false;
    var checkbox = document.querySelector("#incognito-option-read-confirmations .checkbox-incognito");
    
    var checkmark = checkbox.firstElementChild;
    
    if (checkbox.getAttribute("class").indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        readConfirmationsHook = true;
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        readConfirmationsHook = false;
        var redChats = document.getElementsByClassName("icon-meta unread-count incognito");
        for (var i = 0; i < redChats.length; i++)
        {
            redChats[i].className = 'icon-meta unread-count';
        }
    }
    browser.runtime.sendMessage({ name: "setOptions", readConfirmationsHook: readConfirmationsHook });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ readConfirmationsHook: readConfirmationsHook })
    }));
}

function onPresenseUpdatesTick()
{
    var presenceUpdatesHook = false;
    var checkbox = document.querySelector("#incognito-option-presence-updates .checkbox-incognito");
    var checkboxClass = checkbox.getAttribute("class");
    var checkmark = checkbox.firstElementChild;
    var chekmarkClass = checkmark.getAttribute("class");
    if (checkboxClass.indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        presenceUpdatesHook = true;
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        presenceUpdatesHook = false;
    }
    browser.runtime.sendMessage({ name: "setOptions", presenceUpdatesHook: presenceUpdatesHook });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ presenceUpdatesHook: presenceUpdatesHook })
    }));
}

function onSaveDeletedMsgsTick()
{
    var saveDeletedMsgsHook = false;
    var checkbox = document.querySelector("#incognito-option-save-deleted-msgs .checkbox-incognito");
    var checkboxClass = checkbox.getAttribute("class");
    var checkmark = checkbox.firstElementChild;
    var chekmarkClass = checkmark.getAttribute("class");
    if (checkboxClass.indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        saveDeletedMsgsHook = true;
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        saveDeletedMsgsHook = false;
    }
    browser.runtime.sendMessage({ name: "setOptions", saveDeletedMsgs: saveDeletedMsgsHook });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ saveDeletedMsgs: saveDeletedMsgsHook })
    }));
}

function onSafetyDelayChanged(event)
{
    if (isSafetyDelayValid(event.srcElement.value))
    {
        var delay = parseInt(event.srcElement.value);
        document.getElementById("incognito-option-safety-delay").disabled = false;
        browser.runtime.sendMessage({ name: "setOptions", safetyDelay: delay });
        document.dispatchEvent(new CustomEvent('onOptionsUpdate',
        {
            detail: JSON.stringify({ safetyDelay: delay })
        }));
    }
}

function onSafetyDelayDisabled()
{
    document.getElementById("incognito-option-safety-delay").disabled = true;
    document.getElementById("incognito-radio-enable-safety-delay").checked = false;
    browser.runtime.sendMessage({ name: "setOptions", safetyDelay: 0 });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ safetyDelay: 0 })
    }));
}

function onSafetyDelayEnabled()
{
    var delay = parseInt(document.getElementById("incognito-option-safety-delay").value);
    if (isNaN(delay)) delay = parseInt(document.getElementById("incognito-option-safety-delay").placeholder)
    document.getElementById("incognito-option-safety-delay").disabled = false;
    document.getElementById("incognito-radio-disable-safety-delay").checked = false;
    browser.runtime.sendMessage({ name: "setOptions", safetyDelay: delay });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate', {detail: JSON.stringify({ safetyDelay: delay })}));
}

//
// Utils
//

function restoreDeletedMessage(messageNode) 
{
    const messageTextElement = messageNode.querySelector("." + UIClassNames.TEXT_WRAP_POSITION_CLASS + "." + UIClassNames.DELETED_MESSAGE_DIV_CLASS);

    if (messageNode.classList.contains("message-out")) return;

    const data_id = messageNode.getAttribute("data-id");
    const msgID = data_id.split("_")[2];

    if (messageTextElement || pseudoMsgsIDs.has(msgID))
        messageNode.setAttribute("deleted-message", "true");

    if (!messageTextElement) return;

    document.dispatchEvent(new CustomEvent("getDeletedMessageByID", {detail: JSON.stringify({messageID: msgID})}));
    document.addEventListener("onDeletedMessageReceived", function(e)
    {
        var data = JSON.parse(e.detail);
        var messageID = data.messageID;
        var messageData = data.messageData;

        if (messageID != msgID) return;

        const span = document.createElement("span");
        const textSpan = document.createElement("span");
        span.className = UIClassNames.DELETED_MESSAGE_SPAN;
    
        messageTextElement.textContent = "";
        if (!messageData)
        {
            textSpan.textContent = "Failed to restore message";
            messageTextElement.appendChild(textSpan);
            messageTextElement.appendChild(span);
            return;
        }

        const textSpanStyle = "font-style: normal; color: rgba(241, 241, 242, 0.95)";
        const titleSpanStyle = "font-style: normal; color: rgb(128, 128, 128)";
        textSpan.style.cssText = textSpanStyle;
        textSpan.className = "copyable-text selectable-text";
        const titleSpan = document.createElement("span");
        titleSpan.style.cssText = titleSpanStyle;
        if (messageData.isMedia)
        {
            titleSpan.textContent = "Restored media: \n";
            messageTextElement.appendChild(titleSpan); // Top title span

            if (messageData.mediaText) textSpan.textContent = "\n" + messageData.mediaText; //caption text span
            if (messageData.type === "image")
            {
                const imgTag = document.createElement("img");
                imgTag.style.cssText = "width: 100%;";
                imgTag.className = UIClassNames.IMAGE_IMESSAGE_IMG;
                imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
                messageTextElement.appendChild(imgTag);
            }
            else if (messageData.type === "sticker")
            {
                const imgTag = document.createElement("img");
                imgTag.className = UIClassNames.STICKER_MESSAGE_TAG;
                imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
                messageTextElement.appendChild(imgTag);
            }
            else if (messageData.type === "video")
            {
                const vidTag = document.createElement("video");
                vidTag.controls = true;
                vidTag.style.cssText = "width: 100%;";
                const sourceTag = document.createElement("source");
                sourceTag.type = messageData.mimetype;
                sourceTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
                vidTag.appendChild(sourceTag);
                messageTextElement.appendChild(vidTag);
            }
            else if (messageData.type === "document")
            {
                const aTag = document.createElement("a");
                aTag.download = messageData.fileName;
                aTag.href = "data:" + messageData.mimetype + ";base64," + messageData.body;
                aTag.textContent = "Download \"" + messageData.fileName + "\"";
                messageTextElement.appendChild(aTag);
            }
            else if (messageData.type === "ptt") // audio file
            {
                const audioTag = document.createElement("audio");
                audioTag.controls = true;
                const sourceTag = document.createElement("source");
                sourceTag.type = messageData.mimetype;
                sourceTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
                audioTag.appendChild(sourceTag);
                messageTextElement.appendChild(audioTag);
            }
        }
        else
        {
            if (messageData.type === "vcard") // contact cards
            {
                let vcardBody = messageData.body;
                vcardBody = vcardBody.split(":");
                const phone = vcardBody[vcardBody.length - 2].slice(0, -4);
                const aTagPhone = document.createElement("a");
                aTagPhone.href = "tel:" + phone;
                aTagPhone.textContent = phone;
                aTagPhone.target = "_blank";
                aTagPhone.rel = "noopener noreferrer";
                const name = vcardBody[4].split(";")[0].slice(0, -4);

                titleSpan.textContent = "Restored contact card: \r\n";
                textSpan.textContent = "Name: " + name + "\n" + "Contact No.: ";

                messageTextElement.appendChild(titleSpan);
                textSpan.appendChild(aTagPhone);

            }
            else if (messageData.type === "location")
            {
                titleSpan.textContent = "Restored location: \n";
                const imgTag = document.createElement("img");
                imgTag.style.cssText = "width: 100%;";
                imgTag.className = UIClassNames.IMAGE_IMESSAGE_IMG;
                imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
                messageTextElement.appendChild(imgTag);

                const locationLink = document.createElement("a");
                locationLink.target = "_blank";
                locationLink.rel = "noopener noreferrer";
                locationLink.href = "https://www.google.com/maps/search/?api=1&query=" + 
                                        encodeURIComponent(messageData.lat + " " + messageData.lng);
                locationLink.textContent = "Google Maps Link"
                messageTextElement.appendChild(locationLink);
            }
            else
            {
                titleSpan.textContent = "Restored message: \n";
                textSpan.textContent = messageData.body;
                messageTextElement.appendChild(titleSpan);
            }

        }
            
        messageTextElement.appendChild(textSpan);
        messageTextElement.appendChild(span);
    })    
}

function tickCheckbox(checkbox, checkmark)
{
    var checkboxClass = checkbox.getAttribute("class");
    checkbox.setAttribute("class", checkboxClass.replace("unchecked", "checked") + " incognito-checked");
    checkmark.classList.add("incognito-marked");
}

function untickCheckbox(checkbox, checkmark)
{
    var checkboxClass = checkbox.getAttribute("class");
    var chekmarkClass = checkmark.getAttribute("class");
    checkbox.setAttribute("class", checkboxClass.replace("checked", "unchecked").split("incognito-checked").join(" "));
    checkmark.setAttribute("class", chekmarkClass.replace("incognito-marked", ""));
}

function isSafetyDelayValid(string)
{
    var number = Math.floor(Number(string));
    return (String(number) === string && number >= 1 && number <= 30) || string == ""
}

function checkInterception()
{
    if (!isInterceptionWorking)
    {
        Swal.fire({
            title: "Oops...",
            html: "WhatsApp Web Incognito has detected that interception is not working. \
                   Please try refreshing this page, or, if the problem presists, writing back to the developer.",
            icon: "error",
            width: 600,
            confirmButtonColor: "#DD6B55",
            confirmButtonText: "OK",
        });
        return false;
    }

    return true;
}

function isNumberKey(evt)
{
    var charCode = (evt.which) ? evt.which : event.keyCode
    if (charCode > 31 && (charCode < 48 || charCode > 57))
        return false;
    return true;
}
