//
// Encryption & decryption of WhatsApp packets
//

var WACrypto = {};

WACrypto.decryptWithWebCrypto = async function(buffer, isMultiDevice, isIncoming = true) 
{
    if (buffer instanceof Uint8Array) buffer = toArayBufer(buffer);

    if (!isMultiDevice)
    {
        try 
        {
            var hmac = buffer.slice(0, 32);
            var dataIncludingIV = buffer.slice(32);
            var iv = buffer.slice(32, 48);
            var data = buffer.slice(48);
            var keys = getKeys();
            var algorithmInfo = {name: "AES-CBC",iv: new Uint8Array(iv)};
            const key = await window.crypto.subtle.importKey("raw", new Uint8Array(keys.enc), algorithmInfo, false, ["decrypt"]);
            try 
            {
                const decrypted = await window.crypto.subtle.decrypt(algorithmInfo, key, data);
                return [{ frame: decrypted, counter: 0 }];
            } catch (e) 
            {
                console.log(e.code + ", " + e.toString());
            }
        
        } 
        catch (exception)
        {
            // getKeys might fail due to WASecretBundle not being set yet, or this is a multi-device
            // (if this is the case, we can ignore it)
            console.error("WhatsAppInvisible: can't decrypt packet due to exception:");
            console.error(exception);
            return new Promise(function(resolve, reject) {resolve(null);});
        }
    }
    else
    {
        var decryptedFrames = MultiDevice.decryptNoisePacket(buffer, isIncoming);
        return decryptedFrames;
    }
}

WACrypto.encryptWithWebCrypto = function(nodeBuffer, isMultiDevice = false, isIncoming = false, counter = 0) 
{
    if (nodeBuffer instanceof Uint8Array) nodeBuffer = toArayBufer(nodeBuffer);

    if (!isMultiDevice)
    {
        // tag based
        var hmac = new Uint8Array(16), iv = new Uint8Array(16);
        window.crypto.getRandomValues(iv);
        var data = new Uint8Array(nodeBuffer);
        var keys = keys = getKeys();
        var algorithmInfo =  {name: "AES-CBC", iv: new Uint8Array(iv)};
            
        return window.crypto.subtle.importKey("raw", new Uint8Array(keys.enc), algorithmInfo, false, ["encrypt"]).then(function(key) 
        {
            return window.crypto.subtle.encrypt(algorithmInfo, key, data.buffer).then(function(encryptedData)
            {
                var t = new Uint8Array(encryptedData);
                var n = new Uint8Array(iv.length + t.length);
                n.set(iv, 0);
                n.set(t, iv.length);
                var algorithmInfo = {name: "HMAC", hash: { name: "SHA-256" } };
                return window.crypto.subtle.importKey("raw", new Uint8Array(keys.mac), algorithmInfo, false, ["sign"]).then(function(key)
                {
                    return window.crypto.subtle.sign(algorithmInfo, key, n).then(function(hmac)
                    {
                        return BinaryReader.build(hmac, n).readBuffer();
                    });
                });
                
            }).catch(function(e) 
            {
                console.error(e.code + ", " + e.toString());
            });

        });
    }
    else
    {
        // multi device
        return MultiDevice.encryptPacket(nodeBuffer, isIncoming, counter);
    }

}

WACrypto.isTagBasedPayload = function(payload)
{
    var looksTagBased = false;
    if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) 
    {
        var array = new Uint8Array(payload);
        if (array.includes(44))
        {
            for (var o, i=0, a = [];(o=array[i]) != 44;i++) // 44 == ','
                a.push(o);
    
            var tag = String.fromCharCode.apply(String, a);
            looksTagBased =  tag.length < 40 && !/[\x00-\x1F]/.test(tag);
        }
    }
    else
    {
        looksTagBased = true;
    }

    return looksTagBased;
}

WACrypto.parseWebSocketPayload = function(payload)
{
    if (!WACrypto.isTagBasedPayload(payload))
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

WACrypto.packNodesForSending = async function(nodesInfo, isMultiDevice = false, isIncoming = false, tag=undefined)
{
    // convert to binary protocol
    var packetBinaryWriter = new BinaryWriter();
    for (var i = 0; i < nodesInfo.length; i++)
    {
        var nodeInfo = nodesInfo[i];
        var node = nodeInfo.node;
        var counter = nodeInfo.counter;
        var decryptedFrame = nodeInfo.decryptedFrame;

        var nodeBinaryWriter = new BinaryWriter();
        
        if (isMultiDevice) nodeBinaryWriter.pushByte(0); // push flags

        // serialize the node to buffer
        var nodePacker = new NodePacker(isMultiDevice);
        nodePacker.writeNode(nodeBinaryWriter, node);
        var nodeBuffer = nodeBinaryWriter.toBuffer();

        var data = await WACrypto.encryptWithWebCrypto(nodeBuffer, isMultiDevice, isIncoming, counter);
        var frame = new WAPacket({"isMultiDevice": isMultiDevice, "data": data, "tag": tag, "binaryOpts": {}});
        packetBinaryWriter.pushBytes(isIncoming ? frame.serializeWithoutBinaryOpts() : frame.serialize());
    }

    return packetBinaryWriter.toBuffer();
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

function toArayBufer(array)
{
    return array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset);
}