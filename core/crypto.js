//
// Encryption & decryption of WhatsApp packets
//

var WACrypto = {};

WACrypto.encryptAndPackNodesForSending = async function(nodesInfo, isIncoming = false)
{
    // convert to binary protocol
    var packetBinaryWriter = new BinaryWriter();
    for (var i = 0; i < nodesInfo.length; i++)
    {
        var nodeInfo = nodesInfo[i];
        var node = nodeInfo.node;
        var counter = nodeInfo.counter;
        var decryptedFrame = nodeInfo.decryptedFrame;

        var nodeBuffer = await nodeReaderWriter.encodeStanza(node);

        // encrypt it
        var data = await MultiDevice.encryptPacket(nodeBuffer, isIncoming, counter);

        // Serialize to Noise protocol
        var binaryStream = new BinaryReader();
        
        var size = data.byteLength;
        binaryStream.writeUint8(size >> 16);
        binaryStream.writeUint16(65535 & size);
        binaryStream.write(data);

        binaryStream._readIndex = 0;
        var serializedPacket =  binaryStream.readBuffer();

        packetBinaryWriter.pushBytes(serializedPacket);
    }

    return packetBinaryWriter.toBuffer();
}