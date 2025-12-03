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

	var _WS = WebSocket; // save the original constructor

	// hook it
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
				// TODO: there could be an error "WebSocket is already in CLOSING or CLOSED state."
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