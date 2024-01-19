//
// Encryption & decryption of WhatsApp packets
//

var WACrypto = {};

WACrypto.decryptWithWebCrypto = async function(buffer, isIncoming = true) 
{
    if (buffer instanceof Uint8Array) buffer = toArayBufer(buffer);

    var decryptedFrames = MultiDevice.decryptNoisePacket(buffer, isIncoming);
    return decryptedFrames;
}

WACrypto.encryptWithWebCrypto = function(nodeBuffer, isIncoming = false, counter = 0) 
{
    if (nodeBuffer instanceof Uint8Array) nodeBuffer = toArayBufer(nodeBuffer);

    // multi device
    return MultiDevice.encryptPacket(nodeBuffer, isIncoming, counter);

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

WACrypto.packNodesForSending = async function(nodesInfo, isIncoming = false)
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
        
        nodeBinaryWriter.pushByte(0); // push flags

        // serialize the node to buffer
        var nodePacker = new NodePacker();
        nodePacker.writeNode(nodeBinaryWriter, node);
        var nodeBuffer = nodeBinaryWriter.toBuffer();

        var data = await WACrypto.encryptWithWebCrypto(nodeBuffer, isIncoming, counter);
        var frame = new WAPacket({"data": data});
        packetBinaryWriter.pushBytes(frame.serialize());
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