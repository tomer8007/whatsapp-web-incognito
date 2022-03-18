// 
// Noise protocol handling
//

var MultiDevice = {};

var originalImportKey = crypto.subtle.importKey;

MultiDevice.initialize = function()
{
    MultiDevice.readKey = null;
    MultiDevice.readKeyImported = null;
    MultiDevice.writeKey = null;
    MultiDevice.writeKeyImported = null;
    MultiDevice.readCounter = 0;
    MultiDevice.writeCounter = 0;
    MultiDevice.incomingQueue = new PromiseQueue();
    MultiDevice.outgoingQueue = new PromiseQueue();

    // install our hook in order to discover the Noise keys
    window.crypto.subtle.importKey = async function(format, keyData, algorithm, extractable, keyUsages)
    {
        if (format == "raw" && algorithm == "AES-GCM" && keyData.length == 32 && extractable == false && keyUsages.length == 1)
        {
            var key = await originalImportKey.apply(window.crypto.subtle, ["raw", new Uint8Array(keyData), algorithm, false, ["decrypt", "encrypt"]]);

            if (keyUsages.includes("encrypt"))
            {
                MultiDevice.writeKey = keyData;
                MultiDevice.writeCounter = 0;
                MultiDevice.writeKeyImported = key;
                console.log("WAIncognito: Noise encryption key has been replaced.");
                
            }
            else if (keyUsages.includes("decrypt"))
            {
                console.log("WAIncognito: Noise decryption key has been replaced.");
                MultiDevice.readKey = keyData;
                MultiDevice.readKeyImported = key;
                MultiDevice.readCounter = 0;

            }
        }

        return originalImportKey.call(window.crypto.subtle, format, keyData, algorithm, extractable, keyUsages);
    };
};

MultiDevice.decryptNoisePacket = async function(payload, isIncoming = true)
{    
    if (MultiDevice.looksLikeHandshakePacket(payload) || MultiDevice.readKey == null) return null;

    // split to frames
    var binaryReader = new BinaryReader();
    binaryReader.writeBuffer(payload);
    binaryReader._readIndex = 0;
    
    var multipleFrames = false;
    if (MultiDevice.sizeOfPacket(payload) != payload.byteLength - 3)
    {
        multipleFrames = true;
    }

    var frames = [];
    while (binaryReader._readIndex + 3 < payload.byteLength)
    {
        var size = binaryReader.readUint8() << 16 | binaryReader.readUint16();
        var frame = binaryReader.readBuffer(size);
        var counter = isIncoming ? MultiDevice.readCounter++ : MultiDevice.writeCounter++;
        var frameInfo = {frame: frame, counter: counter};

        frames.push(frameInfo);
    }

    try
    {
        for (var i = 0; i < frames.length; i++)
        {
            var frameInfo = frames[i];
    
            var currentFrame = frameInfo.frame;
            var counter = frameInfo.counter;
            
            var key = isIncoming ? MultiDevice.readKeyImported : MultiDevice.writeKeyImported;
            var algorithmInfo = {name: "AES-GCM", iv: MultiDevice.counterToIV(counter), additionalData: new ArrayBuffer(0)};
    
            var decryptedFrame = await window.crypto.subtle.decrypt(algorithmInfo, key, currentFrame);
            var flags = new Uint8Array(decryptedFrame)[0];
            decryptedFrame = decryptedFrame.slice(1);
            if (flags & 2)
            {
                // zlib compressed. decompress
                decryptedFrame = toArayBufer(pako.inflate(new Uint8Array(decryptedFrame)));
            }
    
            frames[i] = {frame: decryptedFrame, counter: counter};  
        }
    }
    catch (exception)
    {
        if (exception.name.includes("OperationError"))
        {
            // reverse the counter, in case this is another socket
            if (isIncoming) MultiDevice.readCounter--;
            else MultiDevice.writeBuffer--;
            throw "Wrong counter in decryption";
        }
        else
        {
            throw exception;
        }
    }

    return frames;
};

MultiDevice.encryptPacket = async function(payload, isIncoming = true, counter = 0)
{    
    var keyData = isIncoming ? MultiDevice.readKey : MultiDevice.writeKey;
    var key = isIncoming ? MultiDevice.readKeyImported : MultiDevice.writeKeyImported;

    var algorithmInfo = {name: "AES-GCM", iv: MultiDevice.counterToIV(counter), additionalData: new ArrayBuffer(0)};
    return window.crypto.subtle.encrypt(algorithmInfo, key, payload)
    .catch(function(e) {
        console.error(e);
        //debugger;
    });
    
};

MultiDevice.sizeOfPacket = function(payload)
{
    var binaryReader = new BinaryReader();
    binaryReader.writeBuffer(payload);
    binaryReader._readIndex = 0;

    var size = binaryReader.readUint8() << 16 | binaryReader.readUint16();
    return size;
};


MultiDevice.decryptE2EMessage = async function(messageNode)
{
    if (messageNode[2][0][0] != "enc") return null;

    var remoteJid = messageNode[1]["jid"] ? messageNode[1]["jid"] : messageNode[1]["from"];

    var ciphertext = messageNode[2][0][2];
    var chiphertextType = messageNode[2][0][1]["type"];

    var storage = new moduleRaid().findModule("getSignalProtocolStore")[0].getSignalProtocolStore();
    storage.flushBufferToDiskIfNotMemOnlyMode();

    // open the signal DB
    var signalDBRequest = indexedDB.open("signal-storage", 70);
    var signalDB = await new Promise((resolve, reject) => { signalDBRequest.onsuccess = () => { resolve(signalDBRequest.result); }
        signalDBRequest.onerror = () => {console.error("can't open signal-storage."); reject(false);}
    });

    console.log("backing up");

    // back up the signal DB
    var exported = await exportIdbDatabase(signalDB);

    // decrypt the message
    var address = new libsignal.SignalProtocolAddress(remoteJid.substring(0, remoteJid.indexOf("@")), 0);
    var sessionCipher = new libsignal.SessionCipher(storage, address);
    var message = null;
    switch (chiphertextType)
    {
        case "pkmsg":
            // Pre-Key message
            message = await sessionCipher.decryptPreKeyWhisperMessage(ciphertext);
            break;
        case "msg":
            // Regular message
            message = await sessionCipher.decryptWhisperMessage(ciphertext);
            break;
        case "skmsg":
            // Sender Key message, aka group message
            var participant = messageNode[1]["participant"];
            var participantAddress = new libsignal.SignalProtocolAddress(participant.substring(0, participant.indexOf("@")), 0);
            var groupCipher = new window.libsignal.GroupCipher(storage, remoteJid, participantAddress);
            message = await groupCipher.decryptSenderKeyMessage(ciphertext);
            break;
    }
    
    // unpad the message
    message = new Uint8Array(message);
    message = new Uint8Array(message.buffer, message.byteOffset, message.length - message[message.length - 1]);

    console.log("restoring");
    
    // restore the signal database
    await clearDatabase(signalDB);
    importToIdbDatabase(signalDB, exported);
    await new Promise((resolve, reject) => { setTimeout(() => {signalDB.close(); resolve();}, 80); });

    storage.deleteAllCache();

    return messageTypes.Message.parse(message);
}

MultiDevice.enqueuePromise = async function(promise, argument, isIncoming = false)
{
    var queue = isIncoming ? MultiDevice.incomingQueue : MultiDevice.outgoingQueue;
    return queue.enqueue(promise, argument);
};

MultiDevice.looksLikeHandshakePacket = function(payload)
{
    // Noise protocol handshake flow:
    //    --> e                                                             [client hello]
    //    <-- e, s (encrypted), payload (encrypted NoiseCertificate)        [server hello]
    //    --> s (encrypted public key), payload (encrypted ClientPayload)   [client finish]
    // https://noiseprotocol.org/noise.html#handshake-patterns

    //
    if (payload.byteLength < 8)
    {
        console.log("WAIncognito: got small packet:");
        console.log(payload);
        return true;
    }
    var binaryReader = new BinaryReader();
    binaryReader.writeBuffer(payload);
    binaryReader._readIndex = 0;

    var firstShort = binaryReader.readUint16();
    var secondShort = binaryReader.readUint16();
    var secondDword = binaryReader.readUint32();

    var looksLikeClientHello = firstShort == 0x5741 || firstShort == 0x4544; // 'WA' || 'ED'       
    var looksLikeServerHello = secondDword == 0xfa010a20;
    var looksLikeClientFinish = secondDword == 0x8e010a30 || secondDword == 0x8c010a30;

    if (window.WAdebugMode)
    {
        if (looksLikeClientHello) console.log("WAIncognito: client hello");
        if (looksLikeServerHello) console.log("WAIncognito: server hello");
        if (looksLikeClientFinish) console.log("WAIncognito: client finish");
    }

    return looksLikeClientHello || looksLikeServerHello || looksLikeClientFinish;
};

MultiDevice.counterToIV = function(counter)
{
    const buffer = new ArrayBuffer(12);
    new DataView(buffer).setUint32(8, counter);
    return new Uint8Array(buffer);
};

function toArayBufer(array)
{
    return array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset);
}

// https://medium.com/@karenmarkosyan/how-to-manage-promises-into-dynamic-queue-with-vanilla-javascript-9d0d1f8d4df5
class PromiseQueue {
    constructor()
    {
        this.queue = [];
        this.pendingPromise = false;
    }

    enqueue(promise, argument) {
      return new Promise((resolve, reject) => {
          this.queue.push({
              promise,
              argument,
              resolve,
              reject,
          });
          this.dequeue();
      });
    }
  
  dequeue() {
      if (this.workingOnPromise) {
        return false;
      }
      const item = this.queue.shift();
      if (!item) {
        return false;
      }
      try {
        this.workingOnPromise = true;
        item.promise(item.argument)
          .then((value) => {
            this.workingOnPromise = false;
            item.resolve(value);
            this.dequeue();
          })
          .catch(err => {
            this.workingOnPromise = false;
            item.reject(err);
            this.dequeue();
          })
      } catch (err) {
        this.workingOnPromise = false;
        item.reject(err);
        this.dequeue();
      }
      return true;
    }
}


MultiDevice.initialize();