/*
This is a content script responsible for some UI.
*/


// Global variables
var mutationObserver = null;
var isInterceptionWorking = false;
var isUIClassesWorking = true;
var deletedMessagesDB = null;
var pseudoMsgsIDs = new Set();

if (chrome != undefined) 
{
	var browser = chrome;
}

initialize();

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
    var appElem = document.getElementsByTagName("body")[0];
    if (!appElem) return;
    mutationObserver = new MutationObserver(onMutationsObserved);

    mutationObserver.observe(appElem, { childList: true, subtree: true });
}

function onMutationsObserved(mutations)
{
    var found = false;
    for (var i = 0; i < mutations.length; i++)
    {
        var mutation = mutations[i];
        var mutationType = mutations[i].type;
        var addedNodes = mutations[i].addedNodes;
        var removedNodes = mutations[i].removedNodes;

        // Scan for added nodes
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
                // dropdown was opened
                setTimeout(function ()
                {
                    document.dispatchEvent(new CustomEvent('onDropdownOpened', {}));

                }, 200);
            }

            // Scan for added message nodes and modify if needed
            var msgNodes = addedNode.querySelectorAll("div.message-in, div.message-out");
            for (let i = 0; i < msgNodes.length; i++)
            {
                const currentNode = msgNodes[i];
                onNewMessageNodeAdded(currentNode);
            }
        }

        
        // Remove the menu item when the app is removed
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
    updateUIClassNamesIfNeeded();

    var firstMenuItem = document.getElementsByClassName(UIClassNames.MENU_ITEM_CLASS)[0];
    if (firstMenuItem != undefined)
    {
        var menuItemElem = await generateSVGElement(chrome.runtime.getURL("images/incognito_gray_24_hollow_9.svg"), UIClassNames.MENU_ITEM_INNER_CLASS, "Incognito Options", 24, "button");
        menuItemElem.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");

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
                document.getElementById("incognito-option-online-status").addEventListener("click", onOnlineUpdatesTick);
                document.getElementById("incognito-option-typing-status").addEventListener("click", onTypingUpdatesTick);
                document.getElementById("incognito-option-save-deleted-msgs").addEventListener("click", onSaveDeletedMsgsTick);
                document.getElementById("incognito-option-show-device-type").addEventListener("click", onShowDeviceTypesTick);
                document.getElementById("incognito-option-auto-receipt").addEventListener("click", onAutoReceiptsTick);
                document.getElementById("incognito-option-status-downloading").addEventListener("click", onStatusDownloadingTick);
                for (var nextButton of document.getElementsByClassName('incognito-next-button'))
                {
                    nextButton.addEventListener("click", onNextButtonClicked);
                };
                for (var nextButton of document.getElementsByClassName('incognito-back-button'))
                {
                    nextButton.addEventListener("click", onBackButtonClicked);
                };
                
                //document.getElementById("incognito-option-safety-delay").addEventListener("input", onSafetyDelayChanged);
                //document.getElementById("incognito-option-safety-delay").addEventListener("keypress", isNumberKey);
                //document.getElementById("incognito-radio-enable-safety-delay").addEventListener("click", onSafetyDelayEnabled);
                //document.getElementById("incognito-radio-disable-safety-delay").addEventListener("click", onSafetyDelayDisabled);

                document.dispatchEvent(new CustomEvent('onIncognitoOptionsOpened', { detail: null }));
            });
            drop.on("close", function ()
            {
                document.getElementsByClassName("menu-item-incognito")[0].setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");

                document.getElementById("incognito-option-read-confirmations").removeEventListener("click", onReadConfirmaionsTick);
                document.getElementById("incognito-option-online-status").removeEventListener("click", onOnlineUpdatesTick);
                document.getElementById("incognito-option-typing-status").removeEventListener("click", onTypingUpdatesTick);

                for (var nextButton of document.getElementsByClassName('incognito-next-button'))
                {
                    nextButton.removeEventListener("click", onNextButtonClicked);
                };
                for (var nextButton of document.getElementsByClassName('incognito-back-button'))
                {
                    nextButton.removeEventListener("click", onBackButtonClicked);
                };

                //document.getElementById("incognito-radio-enable-safety-delay").removeEventListener("click", onSafetyDelayEnabled);
                //document.getElementById("incognito-radio-disable-safety-delay").removeEventListener("click", onSafetyDelayDisabled);
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
    var onlineStatusTitle = "Hide \"online\" status";
    var onlineStatusCaption = "Stops sending presence updates. Will prevent you from seeing others' online status.";

    var typingStatusTitle = "Hide \"typing...\" status";
    var typingStatusCaption = "Stops sending typing updates.";

    var readConfirmationsTitle = "Don't send read confirmations";
    var readConfirmationsCaption = "Blocked messages will be marked with a button.";
    var readConfirmationsNote = "Also works for stories and audio messages.";

    var deletedMessagesTitle = "Restore deleted messages";
    var deletedMessagesCaption = "Marks deleted messages in red";

    var showDeviceTypeTitle = "Show device of messages";
    var showDeviceTypeCaption = "Shows whether each new message was sent from a phone or a computer";

    var autoReceiptTitle = "Auto-Send receipts on reply";
    var autoReceiptCaption = "Automatically mark messages as read when replying in a chat";

    var allowStatusDownloadTitle = "Allow status downloading";
    var allowStatusDownloadCaption = "Adds a button to download statuses";

    var readConfirmationCheckbox = (options.readConfirmationsHook ? "checked incognito-checked'> \
        <div class='checkmark incognito-mark incognito-marked'> </div>" :
        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>");
    var onlineUpdatesCheckbox = (options.onlineUpdatesHook ? "checked incognito-checked'> \
        <div class='checkmark incognito-mark incognito-marked'> </div>" :
        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>");
    var typingUpdatesCheckbox = (options.typingUpdatesHook ? "checked incognito-checked'> \
        <div class='checkmark incognito-mark incognito-marked'> </div>" :
        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>");
    var saveDeletedMessagesCheckbox = (options.saveDeletedMsgs ? "checked incognito-checked'> \
        <div class='checkmark incognito-mark incognito-marked'> </div>" :
        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>");
    var showDeviceTypeCheckbox = (options.showDeviceTypes ? "checked incognito-checked'> \
        <div class='checkmark incognito-mark incognito-marked'> </div>" :
        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>");
    var autoReceiptCheckbox = (options.autoReceiptOnReplay ? "checked incognito-checked'> \
        <div class='checkmark incognito-mark incognito-marked'> </div>" :
        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>");
    var allowStatusDownloadCheckbox = (options.allowStatusDownload ? "checked incognito-checked'> \
        <div class='checkmark incognito-mark incognito-marked'> </div>" :
        "unchecked " + "'> <div class='checkmark incognito-mark" + "'> </div>");


    var dropContent = ` \
        <div class='incognito-options-container' dir='ltr'>
            <div class='incognito-options-title'>Incognito options</div>

            <div class='incognito-options-navigator'>
                <div class='incognito-options-view-container' style='transform: translate(0%, 0%);' id='incognito-options-view1'>

                    <!---- First Page ---!>
                                                                            
                    <div id='incognito-option-read-confirmations' style='cursor: pointer !important; margin-bottom: 0px' class='incognito-options-item'> 
                        <div class='checkbox-container-incognito' style=''>
                            <div class='checkbox checkbox-incognito ${readConfirmationCheckbox}
                            </div>
                        </div>
                        ${readConfirmationsTitle}
                        <div class='incognito-options-description'>${readConfirmationsCaption}</div>
                        <br>
                        <div style='margin-left: 28px !important; margin-top: 0px; font-size: 12px; opacity: 0.8'>
                            ${readConfirmationsNote}
                        </div> 
                    </div> 
                            
                    <div id='incognito-option-online-status' class='incognito-options-item' style='cursor: pointer;'>
                        <div class='checkbox-container-incognito' style=''>
                            <div class='checkbox checkbox checkbox-incognito ${onlineUpdatesCheckbox}
                            </div>
                        </div>
                        ${onlineStatusTitle}
                        <div class='incognito-options-description'>${onlineStatusCaption}</div>
                    </div>
                    <div id='incognito-option-typing-status' class='incognito-options-item' style='cursor: pointer;'>
                        <div class='checkbox-container-incognito' style=''>
                            <div class='checkbox checkbox checkbox-incognito ${typingUpdatesCheckbox}
                            </div>
                        </div>
                        ${typingStatusTitle}
                        <div class='incognito-options-description'>${typingStatusCaption}</div>
                    </div>
                    <button class='incognito-next-button'>Next &gt</button>
                </div>

                <div class='incognito-options-view-container'  style='transform: translate(100%, 0%);' id='incognito-options-view2'>

                    <!---- Second Page ---!>
                    
                    <div class='incognito-options-view' id='incognito-options-view-internal2'>
                        <div id='incognito-option-save-deleted-msgs' class='incognito-options-item' style='cursor: pointer;'>
                            <div class='checkbox-container-incognito' style=''>
                                <div class='checkbox checkbox checkbox-incognito ${saveDeletedMessagesCheckbox}
                                </div>
                            </div>
                            ${deletedMessagesTitle}
                            <div class='incognito-options-description'>${deletedMessagesCaption}</div>
                        </div>
                        <div id='incognito-option-show-device-type' class='incognito-options-item' style='cursor: pointer;'>
                            <div class='checkbox-container-incognito' style=''>
                                <div class='checkbox checkbox checkbox-incognito ${showDeviceTypeCheckbox}
                                </div>
                            </div>
                            ${showDeviceTypeTitle}
                            <div class='incognito-options-description'>${showDeviceTypeCaption}</div>
                        </div>
                        <div id='incognito-option-auto-receipt' class='incognito-options-item' style='cursor: pointer;'>
                            <div class='checkbox-container-incognito' style=''>
                                <div class='checkbox checkbox checkbox-incognito ${autoReceiptCheckbox}
                                </div>
                            </div>
                            ${autoReceiptTitle}
                            <div class='incognito-options-description'>${autoReceiptCaption}</div>
                        </div>
                        <br>
                        <button class='incognito-next-button'>Next &gt</button>
                        <button class='incognito-back-button'>&lt Back</button>
                    </div>
                </div>

                <div class='incognito-options-view-container' style='transform: translate(200%, 0%);' id='incognito-options-view3'>

                    <!---- Third Page ---!>
                    <div class='incognito-options-view' id='incognito-options-view-internal3'>
                        <div id='incognito-option-status-downloading' class='incognito-options-item' style='cursor: pointer;'>
                            <div class='checkbox-container-incognito' style=''>
                                <div class='checkbox checkbox checkbox-incognito ${allowStatusDownloadCheckbox}
                                </div>
                            </div>
                            ${allowStatusDownloadTitle}
                            <div class='incognito-options-description'>${allowStatusDownloadCaption}</div>
                        </div>
                        <div class='incognito-options-item' style='cursor: pointer;'>
                            More options coming soon!
                        </div>
                        <button class='incognito-back-button'>&lt Back</button>
                    </div>
                </div>

                
            </div>
            
        </div>`;

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

    // populate pseudoMsgsIDs
    var deletedDBOpenRequest = indexedDB.open("deletedMsgs", 1);
    deletedDBOpenRequest.onsuccess = () => 
    {
        var deletedMsgsDB = deletedDBOpenRequest.result;
        var keys = deletedMsgsDB.transaction('msgs', "readonly").objectStore("msgs").getAll();
        keys.onsuccess = () => {
            keys.result.forEach((value) => 
            {
                pseudoMsgsIDs.add(value.originalID);
            });
            document.addEventListener("pseudoMsgs", (e) => 
            {
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

function onOnlineUpdatesTick()
{
    var onlineUpdatesHook = false;
    var checkbox = document.querySelector("#incognito-option-online-status .checkbox-incognito");
    var checkboxClass = checkbox.getAttribute("class");
    var checkmark = checkbox.firstElementChild;
    var chekmarkClass = checkmark.getAttribute("class");
    if (checkboxClass.indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        onlineUpdatesHook = true;
        document.dispatchEvent(new CustomEvent('onPresenceOptionTicked'));
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        onlineUpdatesHook = false;
        document.dispatchEvent(new CustomEvent('onPresenceOptionUnticked'));
    }
    browser.runtime.sendMessage({ name: "setOptions", onlineUpdatesHook: onlineUpdatesHook });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ onlineUpdatesHook: onlineUpdatesHook })
    }));
}

function onTypingUpdatesTick()
{
    var typingUpdatesHook = false;
    var checkbox = document.querySelector("#incognito-option-typing-status .checkbox-incognito");
    var checkboxClass = checkbox.getAttribute("class");
    var checkmark = checkbox.firstElementChild;
    var chekmarkClass = checkmark.getAttribute("class");
    if (checkboxClass.indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        typingUpdatesHook = true;
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        typingUpdatesHook = false;
    }
    browser.runtime.sendMessage({ name: "setOptions", typingUpdatesHook: typingUpdatesHook });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ typingUpdatesHook: typingUpdatesHook })
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

function onShowDeviceTypesTick()
{
    var showDeviceTypes = false;
    var checkbox = document.querySelector("#incognito-option-show-device-type .checkbox-incognito");
    
    var checkmark = checkbox.firstElementChild;
    
    if (checkbox.getAttribute("class").indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        showDeviceTypes = true;
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        
        showDeviceTypes = false;
    }
    browser.runtime.sendMessage({ name: "setOptions", showDeviceTypes: showDeviceTypes });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ showDeviceTypes: showDeviceTypes })
    }));
}

function onAutoReceiptsTick()
{
    var autoReceipts = false;
    var checkbox = document.querySelector("#incognito-option-auto-receipt .checkbox-incognito");
    
    var checkmark = checkbox.firstElementChild;
    
    if (checkbox.getAttribute("class").indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        autoReceipts = true;
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        
        autoReceipts = false;
    }
    browser.runtime.sendMessage({ name: "setOptions", autoReceiptOnReplay: autoReceipts });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ autoReceiptOnReplay: autoReceipts })
    }));
}

function onStatusDownloadingTick()
{
    var allowStatusDownload = false;
    var checkbox = document.querySelector("#incognito-option-status-downloading .checkbox-incognito");
    
    var checkmark = checkbox.firstElementChild;
    
    if (checkbox.getAttribute("class").indexOf("unchecked") > -1)
    {
        tickCheckbox(checkbox, checkmark);
        allowStatusDownload = true;
    }
    else
    {
        untickCheckbox(checkbox, checkmark);
        
        allowStatusDownload = false;
    }
    browser.runtime.sendMessage({ name: "setOptions", allowStatusDownload: allowStatusDownload });
    document.dispatchEvent(new CustomEvent('onOptionsUpdate',
    {
        detail: JSON.stringify({ allowStatusDownload: allowStatusDownload })
    }));
}

function onNextButtonClicked()
{
    var views = Array.from(document.getElementsByClassName("incognito-options-view-container"));
    
    requestAnimationFrame(() => {
        for (var view of views)
        {
            var prevViewX = getTransformXOfView(view);
            view.style.transform = "translate(" + (prevViewX - 100) + "%, 0%)";
        }
    });
}

function onBackButtonClicked()
{
    var views = Array.from(document.getElementsByClassName("incognito-options-view-container"));
    
    requestAnimationFrame(() => {
        for (var view of views)
        {
            var prevViewX = getTransformXOfView(view);
            view.style.transform = "translate(" + (prevViewX + 100) + "%, 0%)";
        }
    });
}

function getTransformXOfView(view)
{
    if (view.style.transform.includes("translate"))
        return parseInt(view.style.transform.match(/-?[\d\.]+/g)[0]);
    else
        return 0;
}

//
//    Safety Delay
//
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

async function generateSVGElement(svgImagePath, clazz="", title="", size=24, role="")
{
    var response = await fetch(svgImagePath);
    var text = await response.text();
    var viewBoxText = text.split('viewBox="')[1].split('"')[0];
    var viewboxSize = parseInt(text.split('viewBox="')[1].split(' ')[2]);

    var menuItemElem = document.createElement("div");

    menuItemElem.innerHTML = `<div aria-disabled="false" role="${role}" tabindex="0" class="${clazz}" title="${title}" \
                            aria-label="${title}"><span data-testid="menu" data-icon="menu" class=""><svg viewBox="${viewBoxText}" \
                            width="${size}" height="${size}" class=""><path fill="currentColor" d=""></path></svg></span></div><span></span>`;
    var path = menuItemElem.getElementsByTagName("path")[0];
    var svg = menuItemElem.getElementsByTagName("svg")[0];

    var dom = new DOMParser().parseFromString(text, 'text/html');
    var svgHtml = dom.getElementsByTagName("svg")[0].innerHTML;
    svg.innerHTML = svgHtml;

    return menuItemElem;
}

function onNewMessageNodeAdded(messageNode)
{
    var data_id = messageNode.getAttribute("data-id");
    if (!data_id) data_id = messageNode.parentElement.parentElement.parentElement.getAttribute("data-id");
    if (data_id == null)
        debugger;
    var msgID = data_id.split("_")[2];

    // check if there are any view-once messages for this message ID
    // open viewOnce indexedDB
    restoreViewOnceMessageIfNeeded(messageNode, msgID);

    restoreDeletedMessageIfNeeded(messageNode, msgID);

    markMessageNodeDeviceIfPossible(messageNode, msgID);
}

function restoreViewOnceMessageIfNeeded(messageNode, msgID) 
{
    var viewOnceDBOpenRequest = window.indexedDB.open("viewOnce", 2);
    viewOnceDBOpenRequest.onupgradeneeded = function (event) 
    {
        const db = event.target.result;
        var store = db.createObjectStore('msgs', { keyPath: 'id' });
        console.log('WhatsIncognito: Created viewOnce database.');
        store.createIndex("id_index", "id");
    };

    viewOnceDBOpenRequest.onsuccess = function () 
    {
        var viewOnceDB = viewOnceDBOpenRequest.result;
        var keys = viewOnceDB.transaction('msgs', "readonly").objectStore("msgs").getAll();
        keys.onsuccess = () => {
            keys.result.forEach((value) => 
            {
                if (value.id == msgID) 
                {
                    // we found a view-once message for this message ID
                    // mark the message node as view-once
                    // get the place that we want to place the link
                    // this is a bit hacky, if the viewonce is the most recent message displayed it has to use the second one
                    var viewOnceExplanation = null;
                    // find all div elements in the message node
                    var aElements = messageNode.getElementsByTagName("a");
                    // loop through
                    for (var i = 0; i < aElements.length; i++) 
                    {
                        // if the innerHtml indicates it's the "Learn more" link
                        if (aElements[i].innerHTML.includes("Learn more")) 
                        {
                            // set the viewOnceExplanation to the parent div
                            viewOnceExplanation = aElements[i].parentElement;
                        }
                    }
                    // set innerHTML to empty
                    viewOnceExplanation.innerHTML = "";
                    // if value.dataURI starts with "data:image"
                    if (value.dataURI.startsWith("data:image")) 
                    {
                        // create an image elemnt
                        var img = document.createElement("img");
                        // set the source to the value.dataURI
                        img.src = value.dataURI;
                        // set the width to 100%
                        img.style.cssText = "width: 100%;";
                        // append the image to the viewOnceExplanation
                        viewOnceExplanation.appendChild(img);
                    } 
                    else if (value.dataURI.startsWith("data:video")) 
                    {
                        // create a video element
                        var video = document.createElement("video");
                        // set the controls to true
                        video.controls = true;
                        video.src = value.dataURI;
                        // append the video to the viewOnceExplanation
                        viewOnceExplanation.appendChild(video);
                    } else if (value.dataURI.startsWith("data:audio")) {
                        // create an audio element
                        var audio = document.createElement("audio");
                        // set the controls to true
                        audio.controls = true;
                        audio.src = value.dataURI;
                        // append the audio to the viewOnceExplanation
                        viewOnceExplanation.appendChild(audio);
                    }

                    // check if there is a caption stored and render it
                    if(value.caption != null){
                        var textSpan = document.createElement("span");
                        var textSpanStyle = "font-style: normal; color: rgba(241, 241, 242, 0.95); margin-top: 10px; margin-bottom: 10px;";
                        textSpan.style.cssText = textSpanStyle;
                        textSpan.className = "copyable-text selectable-text";
                        textSpan.textContent = value.caption;
                        viewOnceExplanation.appendChild(textSpan);
                    }

                    // add a learn more link below that opens a sweetalert
                    var learnMore = document.createElement("a");
                    // give it the class of incognito-view-once-learn-more so styles can be applied
                    learnMore.className = "incognito-view-once-learn-more";
                    learnMore.href = "#";
                    learnMore.innerHTML = "Sent as view once: Learn more";
                    learnMore.addEventListener("click", function () {
                        Swal.fire({
                            title: "View-once message",
                            html: 'This message was sent as a view-once. \
                            <br><br> Note that the recipient\'s device will show this as unopened \
                            <br><br> You can view this message multiple times and screenshot, and the recipient will not be notified. ',
                            icon: "info",
                            width: 600,
                            confirmButtonColor: "#000",
                            confirmButtonText: "Got it",
                        });
                    });
                    viewOnceExplanation.appendChild(learnMore);
                }
            });
        };
    };
}

// This function gets called on every new message node that gets added to the screen,
// and takes care of "deleted" messages - 
// attempts to syntethise a message that was deleted from our DB
function restoreDeletedMessageIfNeeded(messageNode, msgID) 
{
    document.dispatchEvent(new CustomEvent("getDeletedMessageByID", {detail: JSON.stringify({messageID: msgID})}));
    document.addEventListener("onDeletedMessageReceived", function(e)
    {
        var data = JSON.parse(e.detail);
        var messageID = data.messageID;
        var messageData = data.messageData;

        if (messageID != msgID) return;

        var span = document.createElement("span");
        var textSpan = document.createElement("span");
        span.className = UIClassNames.DELETED_MESSAGE_SPAN;

        var didFindInDeletedMessagesDB = messageData != undefined;
        var shouldTryToSyntehesizeMessage  = messageNode.textContent.includes("message was deleted"); // TODO: other locales?

        if (!didFindInDeletedMessagesDB && !shouldTryToSyntehesizeMessage)
        {
            // This is just a regular messsage. move on.
            return;
        }

        if (didFindInDeletedMessagesDB)
        {
            // This message was deleted and we have the original data.
            if (messageNode.parentNode)
            messageNode.parentNode.setAttribute("deleted-message", "true");     // mark the message in red
            
            if (!shouldTryToSyntehesizeMessage)
            {
                // doesn't loook like a we need to restore anything becuase deletion was blocked already
                return;
            }
        }

        var messageSubElement = messageNode.getElementsByClassName(UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV)[0]; // oh well
        if (!messageSubElement) return;

        if (!didFindInDeletedMessagesDB && shouldTryToSyntehesizeMessage)
        {
            messageSubElement.textContent = "";
            textSpan.textContent = "Failed to restore message";
            messageSubElement.appendChild(textSpan);
            messageSubElement.appendChild(span);
            if (messageNode.parentNode)
                messageNode.parentNode.setAttribute("deleted-message", "true");     // mark the message in red
            return;
        }

        //
        // If we reached this point, it means that for some reason we couldn't just block the REVOKE message eariler
        // This might happen if other stuff were sent in the relevant packet (see onMessageNodeReceived)
        // So ideally, the following code should be redundant.
        //

        // Now try to synthesize the message from the DB (best effort)
        tryToSynthesizeMessage(messageSubElement, messageData);
    });
}

function tryToSynthesizeMessage(messageSubElement, messageData)
{
    messageSubElement.textContent = "";

    var titleSpan = document.createElement("span");
    var textSpan = document.createElement("span");

    var textSpanStyle = "font-style: normal; color: rgba(241, 241, 242, 0.95)";
    var titleSpanStyle = "font-style: normal; color: rgb(128, 128, 128)";
    textSpan.style.cssText = textSpanStyle;
    textSpan.className = "copyable-text selectable-text";
    
    titleSpan.style.cssText = titleSpanStyle;
    if (messageData.isMedia)
    {
        titleSpan.textContent = "Restored media: \n";
        messageSubElement.appendChild(titleSpan); // Top title span

        if (messageData.mediaText) textSpan.textContent = "\n" + messageData.mediaText; //caption text span
        if (messageData.type === "image")
        {
            const imgTag = document.createElement("img");
            imgTag.style.cssText = "width: 100%;";
            //imgTag.className = UIClassNames.IMAGE_IMESSAGE_IMG;
            imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(imgTag);
        }
        else if (messageData.type === "sticker")
        {
            const imgTag = document.createElement("img");
            imgTag.className = UIClassNames.STICKER_MESSAGE_TAG;
            imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(imgTag);
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
            messageSubElement.appendChild(vidTag);
        }
        else if (messageData.type === "document")
        {
            const aTag = document.createElement("a");
            aTag.download = messageData.fileName;
            aTag.href = "data:" + messageData.mimetype + ";base64," + messageData.body;
            aTag.textContent = "Download \"" + messageData.fileName + "\"";
            messageSubElement.appendChild(aTag);
        }
        else if (messageData.type === "ptt") // audio file
        {
            const audioTag = document.createElement("audio");
            audioTag.controls = true;
            const sourceTag = document.createElement("source");
            sourceTag.type = messageData.mimetype;
            sourceTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            audioTag.appendChild(sourceTag);
            messageSubElement.appendChild(audioTag);
        }
    }
    else
    {
        if (messageData.type === "vcard") // contact cards
        {
            let vcardBody = messageData.body;
            vcardBody = vcardBody.split(":");
            var phone = vcardBody[vcardBody.length - 2].slice(0, -4);
            var aTagPhone = document.createElement("a");
            aTagPhone.href = "tel:" + phone;
            aTagPhone.textContent = phone;
            aTagPhone.target = "_blank";
            aTagPhone.rel = "noopener noreferrer";
            var name = vcardBody[4].split(";")[0].slice(0, -4);

            titleSpan.textContent = "Restored contact card: \r\n";
            textSpan.textContent = "Name: " + name + "\n" + "Contact No.: ";

            messageSubElement.appendChild(titleSpan);
            textSpan.appendChild(aTagPhone);

        }
        else if (messageData.type === "location")
        {
            titleSpan.textContent = "Restored location: \n";
            var imgTag = document.createElement("img");
            imgTag.style.cssText = "width: 100%;";
            //imgTag.className = UIClassNames.IMAGE_IMESSAGE_IMG;
            imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(imgTag);

            var locationLink = document.createElement("a");
            locationLink.target = "_blank";
            locationLink.rel = "noopener noreferrer";
            locationLink.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(messageData.lat + " " + messageData.lng);
            locationLink.textContent = "Google Maps Link";
            messageSubElement.appendChild(locationLink);
        }
        else
        {
            titleSpan.textContent = "Restored message: \n";
            textSpan.textContent = messageData.body;
            messageSubElement.appendChild(titleSpan);
        }

    }
        
    messageSubElement.appendChild(textSpan);
}

function markMessageNodeDeviceIfPossible(messageNode, msgID)
{
    var isOutgoingMessage = messageNode.className.includes("message-out");
    if (isOutgoingMessage)
    {
        // we don't want to mark our own messages
        return;
    }

    document.dispatchEvent(new CustomEvent("getDeviceTypeForMessage", {detail: JSON.stringify({messageID: msgID})}));
    document.addEventListener("onDeviceTypeReceived", async function(e)
    {
        var data = JSON.parse(e.detail);
        var messageID = data.messageID;

        var deviceType = data.deviceType;

        if (messageID != msgID) return;

        var possibleNodes = document.querySelectorAll('[data-id*="' + messageID +'"]');
        if (possibleNodes.length > 0 )
            messageNode = possibleNodes[0].childNodes[0];

        if (messageNode.getElementsByClassName("device-type-image").length > 0) return;
        
        var imageURL = "";
        if (deviceType == "computer")
            imageURL = chrome.runtime.getURL("images/computer.svg");
        else if (deviceType == "phone")
            imageURL = chrome.runtime.getURL("images/phone.svg");
        else
            return;

        var imageElement = await generateSVGElement(imageURL, "", "This message was sent from a " + deviceType, 19);
        imageElement.className = "device-type-image";

        var topMessageNode = messageNode.parentNode.parentNode.parentNode;
        if (topMessageNode.innerHTML.includes("chat-profile-picture") || topMessageNode.innerHTML.includes("Open chat details"))
        {
            imageElement.className += " below-profile-picture";
        }

        messageNode.insertBefore(imageElement, messageNode.firstChild);
    });
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

function updateUIClassNamesIfNeeded()
{
    // this function is meant to support multiples versions of WhatsApp with different GUI element names in the sae time.
    // but it does not sync with injected_ui.js. I need to find a way to share it

    var isOlderWAversion = false;

    if (isOlderWAversion)
    {
        UIClassNames.MENU_ITEM_CLASS = "x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 x1q0g3np x1cy8zhl x100vrsf x1vqgdyp xhslqc4 x1ekkm8c x1143rjc xum4auv xj21bgg x1277o0a x13i9f1t xr9ek0c xjpr12u";
        UIClassNames.MENU_ITEM_INNER_CLASS = "xjb2p0i xk390pu x1heor9g x1ypdohk xjbqb8w x972fbf x10w94by x1qhh985 x14e42zd xtnn1bt x9v5kkp xmw7ebm xrdum7p xt8t1vi x1xc408v x129tdwq x15urzxu xh8yej3 x1iorvi4 x11lfxj5 xjkvuk6 x135b78x"; // inner button
        UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS = " xhslqc4 x14ug900 xzs022t"; // you need to find the differences between the classes groups
        
        UIClassNames.OUTER_DROPDOWN_CLASS = "_ak4w _ap4- _ap4_"; // outside class of dropdown with "mark as unread"
        UIClassNames.DROPDOWN_CLASS = "_ap4_";
        UIClassNames.DROPDOWN_ENTRY_CLASS = "_aj-r _aj-q _aj-_ _asi6 _ap51";
        
        UIClassNames.UNREAD_COUNTER_CLASS = "xyp3urf"; // the span class that sets background-color to var(--unread-marker-background)
        
        UIClassNames.CHAT_PANEL_CLASS = "x14yy4lh"; // the outermost chat panel class (was used in the past for safety delay feature)
        UIClassNames.INNER_CHAT_PANEL_CLASS = "x3psx0u"; // the innermost chat panel class ('conversation-panel-messages')
        
        UIClassNames.CHAT_ENTRY_CLASS = "x10l6tqk xh8yej3 x1g42fcv "; // the chat entry in the chats list
        UIClassNames.UNREAD_MARKER_CLASS = "xqhmz9w"; // the "X unread messages" warning inside the chat panel; the class inside the top-level item
        UIClassNames.UNREAD_MARKER_CLASS_2 = "x1mnlqng"; // HACKKKKKKKK 
        UIClassNames.UNREAD_MARKER_CLASS_3 = "xhsao0n"; // HACKKKKK 2

        UIClassNames.GLOBAL_COLORS_CONTAINER_SELECTOR = ".x1h89ln0.x1h89ln0, .x1h89ln0.x1h89ln0:root"; // look for the selector in which the unread counter's color is defined
        
        UIClassNames.CHAT_MESSAGE = "messag-in";
        UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV = "x1lliihq xh8yej3";
    }

}

function isNumberKey(evt)
{
    var charCode = (evt.which) ? evt.which : event.keyCode
    if (charCode > 31 && (charCode < 48 || charCode > 57))
        return false;
    return true;
}
