var isInterceptionWorking = false;

document.addEventListener('isInterceptionWorking', function(e) {
   isInterceptionWorking = e.detail;
});

if (document.querySelector(".app-wrapper > .app") != undefined)
{
	setTimeout(function () { onMainUIReady(); }, 100);
}
else
{
	var appElem = document.getElementById("app");
	if (appElem != undefined)
	{
		var mutationObserver = new MutationObserver(function (mutations)
		{
			var found = false;
			for (var i = 0; i < mutations.length; i++)
			{
				var addedNodes = mutations[i].addedNodes;
				for (var j = 0; j < addedNodes.length; j++)
				{
					var addedNode = addedNodes[j];
					if (addedNode.nodeName.toLowerCase() == "div" && addedNode.classList.contains("app"))
					{
						setTimeout(function () { onMainUIReady(); }, 100);
						found = true;
						break;
					}
					else if (addedNode.nodeName.toLowerCase() == "div" && addedNode.classList.contains("dropdown"))
					{
						setTimeout(function() 
						{
							document.dispatchEvent(new CustomEvent('onDropdownOpened', {}));
							
						},200);
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
	checkInterception();
	var firstMenuItem = document.getElementsByClassName("menu-horizontal-item")[0];
	if (firstMenuItem != undefined)
	{
		var menuItemElem = document.createElement("div");
		menuItemElem.setAttribute("class", "menu-horizontal-item menu-item-incognito");
		var iconElem = document.createElement("button");
		iconElem.setAttribute("class", "icon icon-incognito");
		iconElem.setAttribute("title", "Incognito options");
		menuItemElem.appendChild(iconElem);
		firstMenuItem.parentElement.insertBefore(menuItemElem, firstMenuItem);
		
		chrome.runtime.sendMessage({ name: "getOptions" }, function (options) 
		{
			document.dispatchEvent(new CustomEvent('onOptionsUpdate', {
				detail: JSON.stringify(options)
			}));
	
			var dropContent = " \
					<div class='incognito-options-container' dir='ltr'> \
						<div class='incognito-options-title'>Incognito options</div> \
						<div id='incognito-option-read-confirmations' class='incognito-options-item'> \
							<div class='checkbox-container' style='display:inline !important'> \
							<div class='checkbox checkbox-incognito " + (options.readConfirmationsHook ? "checked" : "unchecked") + "'><div class='checkmark'></div>		                        </div></div> \
							Don't send read confirmations \
							<div class='incognito-options-description'>Messages that their read confirmation was blocked will be marked in red instead of green.</div> \
						</div> \
						<div id='incognito-option-presence-updates' class='incognito-options-item'> \
							<div class='checkbox-container' style='display:inline !important'> \
							<div class='checkbox checkbox-incognito " + (options.presenceUpdatesHook ? "checked" : "unchecked") + "'><div class='checkmark'></div>                        </div></div> \
							Don't send \"Last Seen\" updates \
							<div class='incognito-options-description'>Blocks outgoing presence updates.</div> \
						</div> \
					</div>";
	
			var drop = new Drop({
				target: menuItemElem,
				content: dropContent,
				position: "bottom left",
				classes: "drop-theme-incognito",
				openOn: "click",
				tetherOptions: {
					offset: "-4px -4px 0 0"
				}
			});
			drop.on("open", function()
			{
				// TODO: do FindReact($0).props.style.transformOrigin = "TOP RIGHT"?
				if (!checkInterception()) return;
				document.getElementsByClassName("menu-item-incognito")[0].setAttribute("class", "menu-horizontal-item active menu-item-incognito");

				document.getElementById("incognito-option-read-confirmations").addEventListener("click", onReadConfirmaionsTick);
				document.getElementById("incognito-option-presence-updates").addEventListener("click", onPresenseUpdatesTick);
			});
			drop.on("close", function()
			{
				document.getElementsByClassName("menu-item-incognito")[0].setAttribute("class", "menu-horizontal-item menu-item-incognito");

				document.getElementById("incognito-option-read-confirmations").removeEventListener("click", onReadConfirmaionsTick);
				document.getElementById("incognito-option-presence-updates").removeEventListener("click", onPresenseUpdatesTick);
			});
		});
	}
}

document.addEventListener('onMarkAsReadClick', function(e) {
	var data = JSON.parse(e.detail);
	chrome.runtime.sendMessage({ name: "getOptions" }, function (options) 
	{
		if (options.readConfirmationsHook)
		{
			swal({
			  title: "Mark as read?",
			  text: data.name + " will be able to tell you read the last " + (data.unreadCount > 1 ?  data.unreadCount + " messages." : " message."),
			  type: "warning",
			  showCancelButton: true,
			  confirmButtonColor: "#DD6B55",
			  confirmButtonText: "Yes, send receipt",
			  closeOnConfirm: false
			},
			function(){
			  document.dispatchEvent(new CustomEvent('sendReadConfirmation', {detail: JSON.stringify(data)}));
			  //swal("Sent!", "Messages were marked as read", "success");
			});
		}
	});
});

function onReadConfirmaionsTick()
{
	var readConfirmationsHook = false;
	var checkbox = document.querySelector("#incognito-option-read-confirmations .checkbox-incognito");
    var checkboxClass = checkbox.getAttribute("class");
    if (checkboxClass.indexOf("unchecked") > -1)
    {
        checkbox.setAttribute("class", checkboxClass.replace("unchecked", "checked"));
        readConfirmationsHook = true;
    }
    else
    {
        checkbox.setAttribute("class", checkboxClass.replace("checked", "unchecked"));
        readConfirmationsHook = false;
		var redChats = document.getElementsByClassName("icon-meta unread-count incognito");
		for (var i=0;i<redChats.length;i++)
		{
			redChats[i].className = 'icon-meta unread-count';
		}
    }
    chrome.runtime.sendMessage({ name: "setOptions", readConfirmationsHook: readConfirmationsHook });
	document.dispatchEvent(new CustomEvent('onOptionsUpdate', {
        detail: JSON.stringify({readConfirmationsHook: readConfirmationsHook})
    }));
}

function onPresenseUpdatesTick()
{
	var presenceUpdatesHook = false;
	var checkbox = document.querySelector("#incognito-option-presence-updates .checkbox-incognito");
    var checkboxClass = checkbox.getAttribute("class");
    if (checkboxClass.indexOf("unchecked") > -1)
    {
        checkbox.setAttribute("class", checkboxClass.replace("unchecked", "checked"));
        presenceUpdatesHook = true;
    }
    else
    {
        checkbox.setAttribute("class", checkboxClass.replace("checked", "unchecked"));
        presenceUpdatesHook = false;
    }
    chrome.runtime.sendMessage({ name: "setOptions", presenceUpdatesHook: presenceUpdatesHook });
	document.dispatchEvent(new CustomEvent('onOptionsUpdate', {
        detail: JSON.stringify({presenceUpdatesHook: presenceUpdatesHook})
    }));
}

function checkInterception()
{
	if (!isInterceptionWorking)
	{
		sweetAlert("Oops...", "WhatsApp Web Incognito has detected that interception is not working. Please try refreshing this page, or, if the problem presists, writing back to the developer.", "error");
		return false;
	}
	
	return true;
}