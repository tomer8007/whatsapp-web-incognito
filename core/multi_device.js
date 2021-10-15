// Mult device support
var MultiDevice = {};

var originalImportKey = crypto.subtle.importKey;

MultiDevice.readKey = null;
MultiDevice.readKeyImported = null;
MultiDevice.writeKey = null;
MultiDevice.writeKeyImported = null;
MultiDevice.readCounter = 0;
MultiDevice.writeCounter = 0;

MultiDevice.initialize = function()
{
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
    
    var frames = []
    while (binaryReader._readIndex + 3 < payload.byteLength)
    {
        var size = binaryReader.readUint8() << 16 | binaryReader.readUint16();
        var frame = binaryReader.readBuffer(size);
        var counter = isIncoming ? MultiDevice.readCounter++ : MultiDevice.writeCounter++;
        var frameInfo = {frame: frame, counter: counter};
        frames.push(frameInfo);

        if (multipleFrames)
        {
        }
    }

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
        if (looksLikeServerHello) console.log("WAIncgnito: server hello");
        if (looksLikeClientFinish) console.log("WAIncgnito: client finish");
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


MultiDevice.initialize();