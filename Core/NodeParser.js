(function() {

function NodeBinaryReader(e) 
{
	var t = new BinaryReader(e);
	this.readByte = function() {
		return t.readUint8()
	}
	,
	this.readInt16 = function() {
		return t.readUint16()
	}
	,
	this.readInt20 = function() {
		var e = 15 & t.readUint8()
		  , r = t.readUint8()
		  , n = t.readUint8();
		return (e << 16) + (r << 8) + n
	}
	,
	this.readInt32 = function() {
		return t.readUint32()
	}
	,
	this.readString = function(e) {
		return t.readString(e)
	}
	,
	this.readBytes = function(e) {
		return t.readBuffer(e)
	}
	,
	this.debugInfo = function() {
		return "offset: " + t._readIndex + " byte: " + t._buffer[t._readIndex]
	}
}

function NodeParser(e) 
{
        var t = [void 0, void 0, void 0, "200", "400", "404", "500", "501", "502", "action", "add", "after", "archive", "author", "available", "battery", "before", "body", "broadcast", "chat", "clear", "code", "composing", "contacts", "count", "create", "debug", "delete", "demote", "duplicate", "encoding", "error", "false", "filehash", "from", "g.us", "group", "groups_v2", "height", "id", "image", "in", "index", "invis", "item", "jid", "kind", "last", "leave", "live", "log", "media", "message", "mimetype", "missing", "modify", "name", "notification", "notify", "out", "owner", "participant", "paused", "picture", "played", "presence", "preview", "promote", "query", "raw", "read", "receipt", "received", "recipient", "recording", "relay", "remove", "response", "resume", "retry", "s.whatsapp.net", "seconds", "set", "size", "status", "subject", "subscribe", "t", "text", "to", "true", "type", "unarchive", "unavailable", "url", "user", "value", "web", "width", "mute", "read_only", "admin", "creator", "short", "update", "powersave", "checksum", "epoch", "block", "previous", "409", "replaced", "reason", "spam", "modify_tag", "message_info", "delivery", "emoji", "title", "description", "canonical-url", "matched-text", "star", "unstar", "media_key", "filename", "identity", "unread", "page", "page_count", "search", "media_message", "security", "call_log", "profile", "ciphertext", "invite", "gif", "vcard", "frequent", "privacy", "blacklist", "whitelist", "verify"]
          , r = []
          , n = 
		  {
            0: "0",
            1: "1",
            2: "2",
            3: "3",
            4: "4",
            5: "5",
            6: "6",
            7: "7",
            8: "8",
            9: "9",
            10: "-",
            11: ".",
            15: "\0"
		   };
		var o = 
		{
			STREAM_END: 2,
			LIST_EMPTY: 0,
			DICTIONARY_0: 236,
			DICTIONARY_1: 237,
			DICTIONARY_2: 238,
			DICTIONARY_3: 239,
			LIST_8: 248,
			LIST_16: 249,
			JID_PAIR: 250,
			HEX_8: 251,
			BINARY_8: 252,
			BINARY_20: 253,
			BINARY_32: 254,
			NIBBLE_8: 255,
			SINGLE_BYTE_MAX: 256,
			PACKED_MAX: 254
    	};
        this.readNode = function(e) {
            var t = e.readByte(), r = this.readListSize(e, t);
            if (t = e.readByte(), t === o.STREAM_END)
                throw new Error("unexpected stream end " + e.debugInfo());
            var n = this.readString(e, t);
            if (0 === r || !n)
                throw new Error("invalid node. 0 list or empty tag" + e.debugInfo());
            var a = r - 2 + r % 2 >> 1
              , i = this.readAttributes(e, a);
            if (r % 2 === 1)
                return [n, i, void 0];
            var d;
            if (t = e.readByte(),
            this.isListTag(t))
                d = this.readList(e, t);
            else if (t === o.BINARY_8) {
                var s = e.readByte();
                d = e.readBytes(s)
            } else if (t === o.BINARY_20) {
                var c = e.readInt20();
                d = e.readBytes(c)
            } else if (t === o.BINARY_32) {
                var p = e.readInt32();
                d = e.readBytes(p)
            } else
                d = this.readString(e, t);
            return [n, i, d]
        }
        ,
        this.isListTag = function(e) {
            return e === o.LIST_EMPTY || e === o.LIST_8 || e === o.LIST_16
        }
        ,
        this.readListSize = function(e, t) {
            if (t === o.LIST_EMPTY)
                return 0;
            if (t === o.LIST_8)
                return e.readByte();
            if (t === o.LIST_16)
                return e.readInt16();
            throw new Error("invalid list size " + e.debugInfo())
        }
        ,
        this.readString = function(e, t) {
            if (t === -1)
                throw new Error("invalid start token readString" + e.debugInfo());
            if (t > 2 && t < 236) {
                var r = this.getToken(t);
                return "s.whatsapp.net" === r && (r = "c.us"),
                r
            }
            switch (t) {
            case o.DICTIONARY_0:
            case o.DICTIONARY_1:
            case o.DICTIONARY_2:
            case o.DICTIONARY_3:
                var n = e.readByte();
                return this.getTokenDouble(t - o.DICTIONARY_0, n);
            case o.LIST_EMPTY:
                return;
            case o.BINARY_8:
                return e.readString(e.readByte());
            case o.BINARY_20:
                return e.readString(e.readInt20());
            case o.BINARY_32:
                return e.readString(e.readInt32());
            case o.JID_PAIR:
                var a = this.readString(e, e.readByte())
                  , i = this.readString(e, e.readByte());
                if ("undefined" != typeof a && "undefined" != typeof i)
                    return a + "@" + i;
                if ("undefined" != typeof i)
                    return i;
                throw new Error("invalid jid " + a + "," + i + " " + e.debugInfo());
            case o.NIBBLE_8:
			case o.HEX_8:
                return this.readPacked8(t, e);
            default:
                throw new Error("invalid string " + e.debugInfo())
            }
        }
        ,
        this.getToken = function(e) {
            var r;
            if (e >= 0 && e < t.length && (r = t[e]),
            "undefined" == typeof r)
                throw new Error("invalid token " + e);
            return r
        }
        ,
        this.getTokenDouble = function(e, t) {
            var n, o = 256 * e + t;
            if (o >= 0 && o < r.length && (n = r[o]),
            "undefined" == typeof n)
                throw new Error("invalid double byte token " + e + " " + t);
            return n
        }
        ,
        this.readAttributes = function(e, t) {
            for (var r, n, o = t ? {} : void 0, a = 0; a < t; a++)
                r = this.readString(e, e.readByte()),
                n = this.readString(e, e.readByte()),
                o[r] = n;
            return o
        }
        ,
        this.readList = function(e, t) {
            for (var r = [], n = this.readListSize(e, t), o = 0; o < n; o++)
                r.push(this.readNode(e));
            return r
        }
        ,
		this.readPacked8 = function(e, t) {
            for (var n = t.readByte(), r = n >> 7, a = 127 & n, i = "", o = 0; o < a; o++) {
                var s = t.readByte();
                i += this.unpackByte(e, (240 & s) >> 4),
                i += this.unpackByte(e, 15 & s)
            }
            return r && (i = i.substring(0, i.length - 1)),
            i
        }
        ,
        this.unpackByte = function(e, t) {
            switch (e) {
            case o.NIBBLE_8:
                return this.unpackNibble(t);
            case o.HEX_8:
                return this.unpackHex(t);
            default:
                throw new Error("unpack non-nibble/hex type: " + e)
            }
        }
        ,
        this.unpackNibble = function(e) {
            if (!n.hasOwnProperty(e))
                throw new Error("invalid nibble to unpack: " + e);
            return n[e]
        }
        ,
        this.unpackHex = function(e) {
            if (e >= 0 && e <= 15)
                return e.toString(16).toUpperCase();
            throw new Error("invalid hex to unpack: " + e)
        },
        this.nibblesToBytes = function(e) {
            for (var t = e.readByte(), r = t >> 7, n = 127 & t, o = "", a = 0; a < n; a++) {
                var i = e.readByte()
                  , d = this.unpackBytePair(i);
                o += d[0],
                o += d[1]
            }
            return r && (o = o.substring(0, o.length - 1)),
            o
        }
        ,
        this.unpackBytePair = function(e) {
            var t = (240 & e) >> 4
              , r = 15 & e;
            if (!n.hasOwnProperty(t))
                throw new Error("invalid nibble to unpack: " + t);
            if (!n.hasOwnProperty(r))
                throw new Error("invalid nibble to unpack: " + r);
            var o = n[t]
              , a = n[r];
            return [o, a]
        }
        ,
        this.bytesToString = function(e) {
            for (var t = "", r = 0; r < e.length; r++)
                t += String.fromCharCode(e[r]);
            return t
        }
    }
	
	window.NodeParser = NodeParser;
	window.NodeBinaryReader = NodeBinaryReader;
	
})();