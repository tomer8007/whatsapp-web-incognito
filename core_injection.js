// ===========================================================================
// WAIncognito - page-script injection loader  (PATCHED)
//
// Why this file was changed
// -------------------------
// The original loader fired every injectScript() call without awaiting and
// never set `async`, so the 16 injected <script> elements executed in
// *download-completion* order instead of the intended order:
//
//     injectScript('lib/pbf.3.0.5.min.js');
//     injectScript('lib/libsignal-protocol-ee5b8ba.min.js');   // 250 KB
//     injectScript('lib/pako.js');                             // 229 KB
//     ...
//
// lib/libsignal-protocol-ee5b8ba.min.js is a concatenation of Long.js,
// ByteBuffer.js, protobuf.js 5.0.1 and libsignal-protocol, delivered as three
// UMD bundles. Each UMD wrapper checks AMD / CommonJS *before* falling back to
// the browser branch that publishes the global `dcodeIO`. WhatsApp Web's
// "Comet" runtime exposes loader globals (`define.amd`, `require`, `module`),
// so whenever this file finished downloading after the Comet runtime was up,
// the wrappers took the AMD/CommonJS branch, `window.dcodeIO` was never
// created, and the libsignal code further down line 28 died at
//
//     dcodeIO.ProtoBuf.loadProto(...)  ->  ReferenceError: dcodeIO is not defined
//
// which left interception unable to decrypt Noise frames. `isInitializing` in
// core/interception.js then never flipped to false, the `onInterceptionWorking`
// event was never dispatched, and core/ui.js showed
// "WhatsApp Web Incognito has detected that interception is not working."
//
// Two things are fixed here:
//   1. every script is awaited before the next one is created, and each
//      <script> is created with async = false, so execution order is
//      deterministic and happens at document_start - before WhatsApp Web's
//      runtime installs those loader globals;
//   2. load failures are recorded and reported instead of being swallowed,
//      so a blocker or a missing file is diagnosable instead of surfacing as
//      a generic "interception is not working" dialog.
//
// The matching change to lib/libsignal-protocol-ee5b8ba.min.js removes the
// AMD/CommonJS branches entirely, so the bundle is immune to those globals
// even if a future WhatsApp Web release wins the race again.
// ===========================================================================

// Order matters. Every entry is awaited before the next one starts.
var INJECTION_ORDER = [
	'core/ws_hook.js',                        // patches the WebSocket constructor - must be first
	'lib/pbf.3.0.5.min.js',
	'lib/libsignal-protocol-ee5b8ba.min.js',  // publishes window.dcodeIO and window.libsignal
	'lib/pako.js',
	'core/parsing/binary_reader.js',
	'core/parsing/binary_writer.js',
	'core/parsing/node_reader_writer.js',
	'core/parsing/protobuf/WhisperTextProtocol.js',
	'core/parsing/protobuf/WAProto.js',
	'core/utils.js',
	'core/ui_class_names.js',
	'core/injected_ui.js',
	'core/multi_device.js',
	'core/node_handler.js',
	'core/interception.js',
	'core/diagnostics.js'                     // reports page-world state for the UI
];

// Readable from the other content scripts of this extension (core/ui.js runs
// in the same isolated world), and mirrored to the page via a CustomEvent.
var WAIncognitoLoadStatus = {
	loaded: [],
	failed: [],
	startedAt: Date.now(),
	finishedAt: null
};
window.WAIncognitoLoadStatus = WAIncognitoLoadStatus;

function reportLoadStatus()
{
	try
	{
		document.dispatchEvent(new CustomEvent('onWAIncognitoLoadStatus',
			{ detail: JSON.stringify(WAIncognitoLoadStatus) }));
	}
	catch (e) { }
}

(async function runInjection()
{
	for (var i = 0; i < INJECTION_ORDER.length; i++)
	{
		var scriptName = INJECTION_ORDER[i];
		try
		{
			await injectScript(scriptName);
			WAIncognitoLoadStatus.loaded.push(scriptName);
		}
		catch (e)
		{
			WAIncognitoLoadStatus.failed.push(scriptName);
			console.error("WAIncognito: could not load " + scriptName +
				" - another extension or a content blocker may be blocking chrome-extension:// resources.", e);
		}
	}

	WAIncognitoLoadStatus.finishedAt = Date.now();
	reportLoadStatus();

	// moduleRaid has to run after WhatsApp Web's webpack runtime exists, which
	// is why the original code delayed it too. Kept at 10 ms on purpose.
	setTimeout(
		function()
		{
			injectScript('lib/moduleraid.js').then(
				function()
				{
					WAIncognitoLoadStatus.loaded.push('lib/moduleraid.js');
					reportLoadStatus();
				},
				function(e)
				{
					WAIncognitoLoadStatus.failed.push('lib/moduleraid.js');
					console.error("WAIncognito: could not load lib/moduleraid.js", e);
					reportLoadStatus();
				});
		},
		10);
})();

function injectScript(scriptName)
{
	return new Promise(function(resolve, reject) {
		var s = document.createElement('script');
		s.src = chrome.runtime.getURL(scriptName);
		s.async = false; // execute in insertion order, not in download order
		s.onload = function() {
			if (this.parentNode)
				this.parentNode.removeChild(this);
			resolve(true);
		};
		s.onerror = function() {
			if (this.parentNode)
				this.parentNode.removeChild(this);
			reject(new Error("failed to load " + scriptName));
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
