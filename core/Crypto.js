// Crypto
var WACrypto = {};

(function() {
WACrypto.decryptWithWebCrypto = function(buffer) 
{
	try 
	{
		var hmac = buffer.slice(0, 32)
		  , dataIncludingIV = buffer.slice(32)
		  , iv = buffer.slice(32, 48)
		  , data = buffer.slice(48)
		  , keys = getKeys()
		  , u = 
		  {
			name: "AES-CBC",
			iv: new Uint8Array(iv)
		   };
		return window.crypto.subtle.importKey("raw", new Uint8Array(keys.enc), u, !1, ["decrypt"]).then(function(key) {
			return window.crypto.subtle.decrypt(u, key, data).catch(function(e) {
			  console.log(e.code + ", " + e.toString());
			});
		});
	
	} catch (exception)
	{
		console.error("WhatsAppInvisible: can't decrypt packet due to exception:");
		console.error(exception);
		return new Promise(function(resolve, reject) {resolve(null);});
	}
}

WACrypto.encryptWithWebCrypto = function(buffer) 
{
	var hmac = new Uint8Array(16), iv = new Uint8Array(16);
	window.crypto.getRandomValues(iv);
	var data = new Uint8Array(buffer)
	, keys = getKeys()
	, u = 
	{
		name: "AES-CBC",
		iv: new Uint8Array(iv)
	};
		
	return window.crypto.subtle.importKey("raw", new Uint8Array(keys.enc), u, !1, ["encrypt"]).then(function(key) {
		return window.crypto.subtle.encrypt(u, key, data.buffer).then(function(encryptedData)
		{
			var t = new Uint8Array(encryptedData), n = new Uint8Array(iv.length + t.length);
            n.set(iv, 0);
            n.set(t, iv.length);
			l = 
			{
				name: "HMAC",
				hash: { name: "SHA-256" }
    		};
            return window.crypto.subtle.importKey("raw", new Uint8Array(keys.mac), l, !1, ["sign"]).then(function(key)
			{
				return window.crypto.subtle.sign(l, key, n).then(function(hmac)
				{
					return BinaryReader.build(hmac, n).readBuffer();
				});
			});
			
		}).catch(function(e) {
		  console.log(e.code + ", " + e.toString());
		});
	   });
}

WACrypto.parseWebSocketPayload = function(payload)
{
	var t, r, n = payload;
	if (n instanceof ArrayBuffer) 
	{
		var array = new Uint8Array(n);
		for (var o, i=0, a = [];(o=array[i]) != 44;i++)
			a.push(o);
		t = String.fromCharCode.apply(String, a);
		r = n.slice(i+1);
		
		if (r.byteLength % 16 != 0)
		{
			// this is a client-to-phone binary message.
			var dataArray = new Uint8Array(r);
			if (dataArray[0] == ",")
			{
				// no binaryOpts
				r = r.slice(1);
			}
			else
			{
				var metric = dataArray[1]; // message type
				var binaryFlags = dataArray[2];
				r = r.slice(2);
				
				return { tag: t, data: r, metric: metric, binaryFlags: binaryFlags }
			}
		}
	} 
	else 
	{
		var d = n.indexOf(",");
		t = n.slice(0, d);
		r = n.slice(d + 1);
		if (r[0] == ",") r = r.slice(1);
		
		try
		{
			r = JSON.parse(r);
		}
		catch (e)
		{
			// just leave it unparsed
		}
	}
	
	return { tag: t, data: r }
}

var shortTagBase = ((+ new Date()) % 1000).toString();
var tagSequence = 0;

WACrypto.makeShortTag = function()
{
	if (!shortTagBase) shortTagBase = ((+ new Date()) % 1000).toString();
	return shortTagBase + ".--" + tagSequence++
}

WACrypto.sendPacket = function(packet)
{
	if (!packet.tag) packet.tag = WACrypto.makeShortTag();
	if (wsHook) wsHook._send(packet.serialize());
	else console.log("no wsHook found!");
}

WACrypto.sendNode = function(node)
{
	return WACrypto.packNodeForSending(node).then(function(packet)
	{
		WACrypto.sendPacket(packet);
	});
}

WACrypto.packNodeForSending = function(node)
{
	// convert to binary protocol
	var binaryWriter = new BinaryWriter();
	var nodePacker = new NodePacker();
	nodePacker.writeNode(binaryWriter, node);
	var nodeBuffer = binaryWriter.toBuffer();
	
	// encrypt
	return WACrypto.encryptWithWebCrypto(nodeBuffer).then(function(data)
	{
		return new WAPacket({"data": data, "binaryOpts": {}});
	});
}

function getKeys()
{
	var storage = window.localStorage;
    var result = {};
    var secretBundle = JSON.parse(storage.getItem("WASecretBundle"));
    result.enc = base64ToArrayBuffer(secretBundle["encKey"]);
	result.mac = base64ToArrayBuffer(secretBundle["macKey"]);
    return result;
}

function base64ToArrayBuffer(base64) 
{
    var binary_string =  window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++)        
    {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}
})();