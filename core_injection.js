
injectScript('core/ws_hook.js'); // important to inject as early as possible
injectOtherScripts();

async function injectOtherScripts() 
{
	injectScript('core/parsing/binary_reader.js');
	injectScript('core/parsing/node_reader.js');
	injectScript('core/parsing/binary_writer.js');
	injectScript('core/parsing/node_writer.js');
	injectScript('core/parsing/protobuf/WhisperTextProtocol.js');
	injectScript('core/parsing/protobuf/WAProto.js');

	injectScript('lib/pbf.3.0.5.min.js');

	injectScript('core/utils.js');
	injectScript('core/wa_packet.js');
	injectScript('core/crypto.js');
	injectScript('core/ui_class_names.js');
	injectScript('core/injected_ui.js');
	
	injectScript('lib/pako.js');
	await injectScript('core/multi_device.js');
	injectScript('core/interception.js');

	setTimeout(
		function() {injectScript('lib/moduleraid.js');},
		10);
}

function injectScript(scriptName) 
{
	return new Promise(function(resolve, reject) {
		var s = document.createElement('script');
		s.src = chrome.runtime.getURL(scriptName);
		s.onload = function() {
			this.parentNode.removeChild(this);
			resolve(true);
		};
		(document.head||document.documentElement).appendChild(s);
	});
}

// Inline script injection might not work due to Content-Security-Policy
function injectFunctionInstantly(injectedFunction)
{
	// Reading from disk seems to slow down the injection
	/* var response = await fetch(chrome.runtime.getURL(scriptName));
	   var text = new TextDecoder("utf-8").decode(await response.body.getReader().read().value); */
	
	var s = document.createElement('script');
	var functionText = injectedFunction.toString();
	s.textContent = functionText.substring(functionText.indexOf('{') + 1, functionText.length - 1);

	(document.head||document.documentElement).appendChild(s);
}

async function injectFromDisk(scriptNames)
{
	// Reading from disk seems to slow down the injection
	var text;
	for (var i = 0; i < scriptNames.length; i++)
	{
		var scriptName = scriptNames[i];
		console.log("looking at " + scriptName);
		var response = await fetch(chrome.runtime.getURL(scriptName));
		var scriptText = new TextDecoder("utf-8").decode(await response.body.getReader().read().value);
		text += "\r\n\r\n" + scriptText;
	}

	
	var s = document.createElement('script');
	s.textContent = text;

	(document.head||document.documentElement).appendChild(s);
}

function webScoketInterception()
{
	// wsHook - WebSocket Interception
	// based on https://github.com/skepticfx/wshook

	var wsHook = {};

	(function() 
	{
		var before = wsHook.before = function(data, url) 
		{
			return data;
		};
		var after = wsHook.after = function(e, url) 
		{
			return e;
		};
		wsHook.resetHooks = function() 
		{
			wsHook.before = before;
			wsHook.after = after;
		}

		var _WS = WebSocket;
		WebSocket = function(url, protocols) 
		{
			var WSObject;
			this.url = url;
			this.protocols = protocols;
			if (!this.protocols)
			WSObject = new _WS(url);
			else
			WSObject = new _WS(url, protocols);

			var _send = WSObject.send;
			var _wsobject = this;
			wsHook._send = WSObject.send = function(data) 
			{
				//data = wsHook.before(data, WSObject.url) || data;
				new wsHook.before(data, WSObject.url).then(function (newData)
				{
					if (newData != null)
						_send.apply(WSObject, [newData]);
					
				}).catch(function(e)
				{
					console.error(e);
					_send.apply(WSObject, [data]);  
				});
			}

			// Events needs to be proxied and bubbled down.
			var onmessageFunction;
			WSObject.__defineSetter__('onmessage', function(func) 
			{
				onmessageFunction = wsHook.onMessage = func;
			});
			WSObject.addEventListener('message', function(event) 
			{
				if (!onmessageFunction)
				{
					console.log("warning: no onmessageFunction");
					return;
				}
			
				wsHook.after(new MutableMessageEvent(event), this.url).then(function(modifiedEvent)
				{
					if (modifiedEvent != null)
						onmessageFunction.apply(this, [modifiedEvent]);
					
				}).catch(function(e)
				{
					console.error(e);
					onmessageFunction.apply(this, [event]);
				});
				
				//e = new MessageEvent(e.type, e);
			});

			return WSObject;
		}
	})();

	// Mutable MessageEvent.
	// Subclasses MessageEvent and makes data, origin and other MessageEvent properites mutatble.
	function MutableMessageEvent(o) 
	{
		this.bubbles = o.bubbles || false;
		this.cancelBubble = o.cancelBubble || false;
		this.cancelable = o.cancelable || false;
		this.currentTarget = o.currentTarget || null;
		this.data = o.data || null;
		this.defaultPrevented = o.defaultPrevented || false;
		this.eventPhase = o.eventPhase || 0;
		this.lastEventId = o.lastEventId || "";
		this.origin = o.origin || "";
		this.path = o.path || new Array(0);
		this.ports = o.parts || new Array(0);
		this.returnValue = o.returnValue || true;
		this.source = o.source || null;
		this.srcElement = o.srcElement || null;
		this.target = o.target || null;
		this.timeStamp = o.timeStamp || null;
		this.type = o.type || "message";
		this.__proto__ = o.__proto__ || MessageEvent.__proto__;
	}

}
