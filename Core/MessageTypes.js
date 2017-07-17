var messageTypes = {};

(function () 
{
    function SenderKeyDistributionMessage(e) {
        messageParser.initMessageValues(this, SenderKeyDistributionMessage, e)
    }
    function ImageMessage(e) {
        messageParser.initMessageValues(this, ImageMessage, e)
    }
    function ContactMessage(e) {
        messageParser.initMessageValues(this, ContactMessage, e)
    }
    function LocationMessage(e) {
        messageParser.initMessageValues(this, LocationMessage, e)
    }
    function ExtendedTextMessage(e) {
        messageParser.initMessageValues(this, ExtendedTextMessage, e)
    }
    function DocumentMessage(e) {
        messageParser.initMessageValues(this, DocumentMessage, e)
    }
    function AudioMessage(e) {
        messageParser.initMessageValues(this, AudioMessage, e)
    }
    function VideoMessage(e) {
        messageParser.initMessageValues(this, VideoMessage, e)
    }
    function HighlyStructuredMessage(e) {
        messageParser.initMessageValues(this, HighlyStructuredMessage, e)
    }
    function Call(e) {
        messageParser.initMessageValues(this, Call, e)
    }
    function Chat(e) {
        messageParser.initMessageValues(this, Chat, e)
    }
    function ProtocolMessage(e) {
        messageParser.initMessageValues(this, ProtocolMessage, e)
    }
    function ContactsArrayMessage(e) {
        messageParser.initMessageValues(this, ContactsArrayMessage, e)
    }
    function Message(e) {
        messageParser.initMessageValues(this, Message, e)
    }
    function ContextInfo(e) {
        messageParser.initMessageValues(this, ContextInfo, e)
    }
    function MessageKey(e) {
        messageParser.initMessageValues(this, MessageKey, e)
    }
    function WebMessageInfo(e) {
        messageParser.initMessageValues(this, WebMessageInfo, e)
    }
	
	
    messageParser.createMessageType(SenderKeyDistributionMessage, {
        groupId: [1, 12],
        axolotlSenderKeyDistributionMessage: [2, 13]
    }),
    messageParser.createMessageType(ImageMessage, {
        url: [1, 12],
        mimetype: [2, 12],
        caption: [3, 12],
        fileSha256: [4, 13],
        fileLength: [5, 4],
        height: [6, 3],
        width: [7, 3],
        mediaKey: [8, 13],
        jpegThumbnail: [16, 13],
        contextInfo: [17, 14, ContextInfo]
    }),
    messageParser.createMessageType(ContactMessage, {
        displayName: [1, 12],
        vcard: [16, 12],
        contextInfo: [17, 14, ContextInfo]
    }),
    messageParser.createMessageType(LocationMessage, {
        degreesLatitude: [1, 11],
        degreesLongitude: [2, 11],
        name: [3, 12],
        address: [4, 12],
        url: [5, 12],
        duration: [6, 17],
        accuracyInMeters: [7, 3],
        speedInMps: [8, 17],
        degreesClockwiseFromMagneticNorth: [9, 3],
        axolotlSenderKeyDistributionMessage: [10, 13],
        jpegThumbnail: [16, 13],
        contextInfo: [17, 14, ContextInfo]
    }),
    messageParser.createMessageType(ExtendedTextMessage, {
        text: [1, 12],
        matchedText: [2, 12],
        canonicalUrl: [4, 12],
        description: [5, 12],
        title: [6, 12],
        jpegThumbnail: [16, 13],
        contextInfo: [17, 14, ContextInfo]
    }),
    messageParser.createMessageType(DocumentMessage, {
        url: [1, 12],
        mimetype: [2, 12],
        title: [3, 12],
        fileSha256: [4, 13],
        fileLength: [5, 4],
        pageCount: [6, 3],
        mediaKey: [7, 13],
        fileName: [8, 12],
        jpegThumbnail: [16, 13],
        contextInfo: [17, 14, ContextInfo]
    }),
    messageParser.createMessageType(AudioMessage, {
        url: [1, 12],
        mimetype: [2, 12],
        fileSha256: [3, 13],
        fileLength: [4, 4],
        seconds: [5, 3],
        ptt: [6, 7],
        mediaKey: [7, 13],
        contextInfo: [17, 14, ContextInfo],
        streamingSidecar: [18, 13]
    });
    var O = {
        NONE: 0,
        GIPHY: 1,
        TENOR: 2
    };
    messageParser.createMessageType(VideoMessage, {
        url: [1, 12],
        mimetype: [2, 12],
        fileSha256: [3, 13],
        fileLength: [4, 4],
        seconds: [5, 3],
        mediaKey: [6, 13],
        caption: [7, 12],
        gifPlayback: [8, 7],
        height: [9, 3],
        width: [10, 3],
        jpegThumbnail: [16, 13],
        contextInfo: [17, 14, ContextInfo],
        streamingSidecar: [18, 13],
        gifAttribution: [19, 8, O]
    }),
    messageParser.createMessageType(HighlyStructuredMessage, {
        namespace: [1, 12],
        elementName: [2, 12],
        params: [3, 64 | 12],
        fallbackLg: [4, 12],
        fallbackLc: [5, 12]
    }),
    messageParser.createMessageType(Call, {
        callKey: [1, 13]
    }),
    messageParser.createMessageType(Chat, {
        displayName: [1, 12],
        id: [2, 12]
    });
    var P1 = {
        REVOKE: 0
    };
    messageParser.createMessageType(ProtocolMessage, {
        key: [1, 14, MessageKey],
        type: [2, 8, P1]
    }),
    messageParser.createMessageType(ContactsArrayMessage, {
        displayName: [1, 12],
        contacts: [2, 64 | 14, ContactMessage],
        contextInfo: [17, 14, ContextInfo]
    }),
    messageParser.createMessageType(Message, {
        conversation: [1, 12],
        senderKeyDistributionMessage: [2, 14, SenderKeyDistributionMessage],
        imageMessage: [3, 14, ImageMessage],
        contactMessage: [4, 14, ContactMessage],
        locationMessage: [5, 14, LocationMessage],
        extendedTextMessage: [6, 14, ExtendedTextMessage],
        documentMessage: [7, 14, DocumentMessage],
        audioMessage: [8, 14, AudioMessage],
        videoMessage: [9, 14, VideoMessage],
        call: [10, 14, Call],
        chat: [11, 14, Chat],
        protocolMessage: [12, 14, ProtocolMessage],
        contactsArrayMessage: [13, 14, ContactsArrayMessage],
        highlyStructuredMessage: [14, 14, HighlyStructuredMessage]
    }),
    messageParser.createMessageType(ContextInfo, {
        stanzaId: [1, 12],
        participant: [2, 12],
        quotedMessage: [3, 14, Message],
        remoteJid: [4, 12],
        mentionedJid: [15, 64 | 12],
        editVersion: [16, 3],
        revokeMessage: [17, 7]
    }),
    messageParser.createMessageType(MessageKey, {
        remoteJid: [1, 12],
        fromMe: [2, 7],
        id: [3, 12],
        participant: [4, 12]
    });
    var L = {
        ERROR: 0,
        PENDING: 1,
        SERVER_ACK: 2,
        DELIVERY_ACK: 3,
        READ: 4,
        PLAYED: 5
    };
    messageParser.createMessageType(WebMessageInfo, {
        key: [1, 256 | 14, MessageKey],
        message: [2, 14, Message],
        messageTimestamp: [3, 4],
        status: [4, 8, L],
        participant: [5, 12],
        ignore: [16, 7],
        starred: [17, 7],
        broadcast: [18, 7],
        pushName: [19, 12],
        mediaCiphertextSha256: [20, 13],
        multicast: [21, 7],
        urlText: [22, 7],
        urlNumber: [23, 7]
    }, {
        status: L.PENDING
    }),
    Message.SenderKeyDistributionMessage = SenderKeyDistributionMessage;
    Message.ImageMessage = ImageMessage;
    Message.ContactMessage = ContactMessage;
    Message.LocationMessage = LocationMessage;
    Message.ExtendedTextMessage = ExtendedTextMessage;
    Message.DocumentMessage = DocumentMessage;
    Message.AudioMessage = AudioMessage;
    Message.VideoMessage = VideoMessage;
    VideoMessage.ATTRIBUTION = O;
    Message.HighlyStructuredMessage = HighlyStructuredMessage;
    Message.Call = Call;
    Message.Chat = Chat;
    Message.ProtocolMessage = ProtocolMessage;
    ProtocolMessage.TYPE = P1;
    Message.ContactsArrayMessage = ContactsArrayMessage;
    WebMessageInfo.STATUS = L;
	
	messageTypes.WebMessageInfo = WebMessageInfo;
	messageTypes.Message = Message;
	
})();