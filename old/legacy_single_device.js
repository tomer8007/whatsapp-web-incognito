// This file contains code that was used in earlier versions of the extension,
// when WhatsApp Web mirrored the traffic through the phone.

// It it not used anymore, and is there for historical reasons.

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
                var encryptedData2 = new Uint8Array(encryptedData);
                var totalEncryptedData = new Uint8Array(iv.length + encryptedData2.length);
                totalEncryptedData.set(iv, 0);
                totalEncryptedData.set(encryptedData2, iv.length);
                var algorithmInfo = {name: "HMAC", hash: { name: "SHA-256" } };
                return window.crypto.subtle.importKey("raw", new Uint8Array(keys.mac), algorithmInfo, false, ["sign"]).then(function(key)
                {
                    return window.crypto.subtle.sign(algorithmInfo, key, totalEncryptedData).then(function(hmac)
                    {
                        return BinaryReader.build(hmac, totalEncryptedData).readBuffer();
                    });
                });
                
            }).catch(function(e) 
            {
                console.error(e.code + ", " + e.toString());
            });

        });
    }
}

NodeHandler.interceptOutgoingNode = async function (node, isMultiDevice)
{
    try
    {
        //
        // Check for message nodes
        //
        if (node.tag == "message" || node.tag == "action")
        {
            // manipulating a message node

            if (!isMultiDevice && node.tag == "action")
            {
                // non-multi device

                var participants = node.content;
                for (var j = 0; j < participants.length; j++)
                {
                    var child = participants[j];
                    if (child.tag == "message")
                    {
                        var messageNode = await this.onSentEncNode(child, isMultiDevice);
                        participants[j] = messageNode;
                    }
                }
            }
        }
        
    }
    catch (exception)
    {
        console.error("WhatsIncognito: Allowing WA packet due to exception:");
        console.error(exception);
        console.error(exception.stack);
        return node;
    }

    return node;
}

NodeHandler.onSentEncNode = async function (messageNode, remoteJid, isMultiDevice)
{
    if (!isMultiDevice)
    {
        var message = (await decryptE2EMessagesFromNode(messageNode, isMultiDevice))[0];
        if (WAdebugMode)
        {
            console.log("WAIncognito: Sending message:");
            console.log(message);
        }

        if (message == null || message.key == null) return;
        remoteJid = message.key.remoteJid;
    }

    // ...

    // do message manipulation if needed
    //         ...
    var putBreakpointHere = 1;

    if (!isMultiDevice)
    {
        // TODO: following lines are commented out due to non-complete message types
        // re-assmble everything
        //messageBuffer = messageTypes.WebMessageInfo.encode(message).readBuffer();
        //messageNode.content = messageBuffer;
    }

    return messageNode;
}

async function decryptE2EMessagesFromNode(node, isMultiDevice)
{
    if (!isMultiDevice)
    {
        // the message is not singal-encrypted, so just parse it
        switch (node.tag)
        {
            case "message":
                var message = WebMessageInfo.read(new Pbf(node.content));
                return [message];
            default:
                return [];
        }
    }
}

NodeHandler.onE2EMessageNodeReceived = function(currentNode, message, isMultiDevice, encNodes, messageNodes)
{
    var isAllowed = true;
    var remoteJid = null;
    var participant = null;
    if (!isMultiDevice)
    {
        // non multi-device
        remoteJid = message.key.remoteJid;
        messageId = message.key.id;
        message = message.message;
    }

    // ...
    //
}

WAPacket.prototype = 
{
    getTag: function() {
        return this.tag || (this.onSend ? this.onSend.tag : void 0)
    },
    toString: function() {
        var e = this.data;
        return this.binaryOpts ? this.binaryOpts.debugString : Array.isArray(e) ? 0 === e.length ? "[]" : 1 === e.length ? "[" + e[0] + "]" : "query" === e[0] || "action" === e[0] ? "[" + e[0] + ", " + e[1] + (e.length > 2 ? ", ..." : "") + "]" : void 0 : Object.isObject(e) ? "{...}" : "" + e
    },
    serialize: function() {
      if (!this.isMultiDevice)
      {
          var e = this.tag;
          if (this.binaryOpts) {
              var t = this.binaryOpts
                , n = t.metric ? t.metric : 0
                , r = (this.ignore ? 0 : 1) << 7 | (!this.ignore && t.ackRequest ? 1 : 0) << 6 | (t.available === !0 ? 1 : 0) << 5 | (t.available === !1 ? 1 : 0) << 4 | (t.expires ? 1 : 0) << 3 | (t.skipOffline ? 1 : 0) << 2;
              return BinaryReader.build(e, ",", n, r, this.data).readBuffer();
          }
          var a = this.data;
          return e + ",," + a;
      }
    },
    serializeWithoutBinaryOpts: function() {  
        var e = this.tag;
        if (this.binaryOpts) {
            var t = this.binaryOpts
              , n = t.metric ? t.metric : 0
              , r = (this.ignore ? 0 : 1) << 7 | (!this.ignore && t.ackRequest ? 1 : 0) << 6 | (t.available === !0 ? 1 : 0) << 5 | (t.available === !1 ? 1 : 0) << 4 | (t.expires ? 1 : 0) << 3 | (t.skipOffline ? 1 : 0) << 2;
              
              return BinaryReader.build(e, ",", this.data).readBuffer();
        }
        var a = this.data;
        return e + ",," + a;
    },
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