// Crypto
var WACrypto = {};

(function() {
WACrypto.decryptWithWebCrypto = function(buffer) 
{
    try 
    {
        var hmac = buffer.slice(0, 32);
        var dataIncludingIV = buffer.slice(32);
        var iv = buffer.slice(32, 48);
        var data = buffer.slice(48);
        var keys = getKeys();
        var algorithmInfo = {name: "AES-CBC",iv: new Uint8Array(iv)};
        console.log(data)
        return window.crypto.subtle.importKey("raw", new Uint8Array(keys.enc), algorithmInfo, !1, ["decrypt"]).then(function(key) {
            return window.crypto.subtle.decrypt(algorithmInfo, key, data).catch(function(e) {
              console.log(e.code + ", " + e.toString());
            });
        });
    
    } catch (exception)
    {
        // getKeys might fail due to WASecretBundle not being set yet, or this is a multi-device
        // (if this is the case, we can ignore it)
        console.error("WhatsAppInvisible: can't decrypt packet due to exception:");
        console.error(exception);
        return new Promise(function(resolve, reject) {resolve(null);});
    }
}

WACrypto.encryptWithWebCrypto = function(buffer) 
{
    var hmac = new Uint8Array(16), iv = new Uint8Array(16);
    window.crypto.getRandomValues(iv);
    var data = new Uint8Array(buffer);
    var keys = keys = getKeys();
    var algorithmInfo =  {name: "AES-CBC", iv: new Uint8Array(iv)};
        
    return window.crypto.subtle.importKey("raw", new Uint8Array(keys.enc), algorithmInfo, !1, ["encrypt"]).then(function(key) 
    {
        return window.crypto.subtle.encrypt(algorithmInfo, key, data.buffer).then(function(encryptedData)
        {
            var t = new Uint8Array(encryptedData);
            var n = new Uint8Array(iv.length + t.length);
            n.set(iv, 0);
            n.set(t, iv.length);
            var algorithmInfo = {name: "HMAC", hash: { name: "SHA-256" } };
            return window.crypto.subtle.importKey("raw", new Uint8Array(keys.mac), algorithmInfo, !1, ["sign"]).then(function(key)
            {
                return window.crypto.subtle.sign(algorithmInfo, key, n).then(function(hmac)
                {
                    return BinaryReader.build(hmac, n).readBuffer();
                });
            });
            
        }).catch(function(e) 
        {
          console.log(e.code + ", " + e.toString());
        });

    });
}

WACrypto.isWebSocketPayloadSupported = function(payload)
{
    if (payload instanceof ArrayBuffer) 
    {
        var array = new Uint8Array(payload);
        return array.includes(44);
    }

    return true;
}

WACrypto.parseWebSocketPayload = function(payload)
{
    if (!WACrypto.isWebSocketPayloadSupported(payload))
        return null;

    var t, r, n = payload;
    if (payload instanceof ArrayBuffer) 
    {
        var array = new Uint8Array(payload);
        for (var o, i=0, a = [];(o=array[i]) != 44;i++) // 44 == ','
            a.push(o);

        t = String.fromCharCode.apply(String, a);
        r = payload.slice(i+1);
        
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
        var d = payload.indexOf(",");
        t = payload.slice(0, d);
        r = payload.slice(d + 1);
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

WACrypto.packNodeForSending = function(node, tag=undefined)
{
    // convert to binary protocol
    var binaryWriter = new BinaryWriter();
    var nodePacker = new NodePacker();
    nodePacker.writeNode(binaryWriter, node);
    var nodeBuffer = binaryWriter.toBuffer();
    
    // encrypt
    return WACrypto.encryptWithWebCrypto(nodeBuffer).then(function(data)
    {
        return new WAPacket({"tag": tag, "data": data, "binaryOpts": {}});
    });
}

function getKeys()
{
    var useLocalStorage = window.localStorage.getItem("WASecretBundle") != undefined;
    var storage = useLocalStorage ? window.localStorage : window.sessionStorage;
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