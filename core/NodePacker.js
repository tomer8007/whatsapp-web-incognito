function NodePacker() {
	var e = {
        singleByte: [void 0, void 0, void 0, "200", "400", "404", "500", "501", "502", "action", "add", "after", "archive", "author", "available", "battery", "before", "body", "broadcast", "chat", "clear", "code", "composing", "contacts", "count", "create", "debug", "delete", "demote", "duplicate", "encoding", "error", "false", "filehash", "from", "g.us", "group", "groups_v2", "height", "id", "image", "in", "index", "invis", "item", "jid", "kind", "last", "leave", "live", "log", "media", "message", "mimetype", "missing", "modify", "name", "notification", "notify", "out", "owner", "participant", "paused", "picture", "played", "presence", "preview", "promote", "query", "raw", "read", "receipt", "received", "recipient", "recording", "relay", "remove", "response", "resume", "retry", "s.whatsapp.net", "seconds", "set", "size", "status", "subject", "subscribe", "t", "text", "to", "true", "type", "unarchive", "unavailable", "url", "user", "value", "web", "width", "mute", "read_only", "admin", "creator", "short", "update", "powersave", "checksum", "epoch", "block", "previous", "409", "replaced", "reason", "spam", "modify_tag", "message_info", "delivery", "emoji", "title", "description", "canonical-url", "matched-text", "star", "unstar", "media_key", "filename", "identity", "unread", "page", "page_count", "search", "media_message", "security", "call_log", "profile", "ciphertext", "invite", "gif", "vcard", "frequent", "privacy", "blacklist", "whitelist", "verify"],
        doubleByte: [],
        nibbleEncode: {
            0: 0,
            1: 1,
            2: 2,
            3: 3,
            4: 4,
            5: 5,
            6: 6,
            7: 7,
            8: 8,
            9: 9,
            "-": 10,
            ".": 11,
            "\0": 15
        },
        nibbleDecode: {
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
        }
    };
	var p = 
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
        var t, n = {}, r = e.nibbleEncode;
        for (t = 0; t < e.singleByte.length; t++)
            e.singleByte[t] && (n[e.singleByte[t]] = t);
        for (t = 0; t < e.doubleByte.length; t++)
            e.doubleByte[t] && (n[e.doubleByte[t]] = t + p.SINGLE_BYTE_MAX);
        this.writeNode = function(e, t) {
            if (t) {
                if (3 !== t.length)
                    throw new Error("invalid node");
				var n = 0;
				if (t[1])
				{
					var result = {}, key;
					var counter = 0;
					for (key in t[1]) 
					{
						if (t[1].hasOwnProperty(key) && !!t[1][key]) 
						{
							result[key] = t[1][key];
							counter++;
						}
					}
					n = 2 * counter;
				}
                this.writeListStart(e, 1 + n + (t[2] ? 1 : 0)),
                this.writeString(e, t[0]),
                this.writeAttributes(e, t[1]),
                this.writeChildren(e, t[2])
            }
        }
        ,
        this.writeString = function(e, t, r) {
            if ("string" != typeof t)
                throw new Error("invalid string");
            var a, i, o = n[t];
            if ("c.us" !== t || r)
                if ("undefined" == typeof o) {
                    var s = t.indexOf("@");
                    if (s < 1)
                        this.writeStringRaw(e, t);
                    else {
                        var c = t.substring(0, s)
                          , d = t.substring(s + 1);
                        this.writeJid(e, c, d)
                    }
                } else {
                    if (o < p.SINGLE_BYTE_MAX)
                        this.writeToken(e, o);
                    else {
                        var u = o - p.SINGLE_BYTE_MAX
                          , f = u >> 8;
                        switch (i = u % 256,
                        f) {
                        case 0:
                            a = p.DICTIONARY_0;
                            break;
                        case 1:
                            a = p.DICTIONARY_1;
                            break;
                        case 2:
                            a = p.DICTIONARY_2;
                            break;
                        case 3:
                            a = p.DICTIONARY_3;
                            break;
                        default:
                            throw new Error("double byte dictionary token out of range: " + t + " " + o)
                        }
                    }
                    this.writeToken(e, a),
                    this.writeToken(e, i)
                }
            else
                this.writeToken(e, n["s.whatsapp.net"])
        }
        ,
        this.writeStringRaw = function(e, t) {
            var n = BinaryReader.numUtf8Bytes(t);
            if (n >= 4294967296)
                throw new Error("string too large to encode (len = " + n + "): " + t);
            n >= 1 << 20 ? (e.pushByte(p.BINARY_32),
            e.pushInt32(n)) : n >= 256 ? (e.pushByte(p.BINARY_20),
            e.pushInt20(n)) : (e.pushByte(p.BINARY_8),
            e.pushByte(n)),
            e.pushString(t)
        }
        ,
        this.writeJid = function(e, t, n) {
            if (e.pushByte(p.JID_PAIR),
            t)
                try {
                    this.writePackedBytes(e, t)
                } catch (r) {
                    s.warnVerbose("writer:encode-fallback " + r.message, t)(),
                    this.writeString(e, t)
                }
            else
                this.writeToken(e, p.LIST_EMPTY);
            this.writeString(e, n)
        }
        ,
        this.writeToken = function(e, t) {
            if (t < 245)
                e.pushByte(t);
            else if (t <= 500)
                throw new Error("invalid token")
        }
        ,
        this.writeAttributes = function(e, t) {
            if (t)
                for (var n in t)
                    t[n] && (this.writeString(e, n),
                    this.writeString(e, t[n]))
        }
        ,
        this.writeChildren = function(e, t) {
            var n;
            if (t)
                if ("string" == typeof t)
                    this.writeString(e, t, !0);
                else if (t instanceof ArrayBuffer) {
                    if (n = t.byteLength,
                    n >= 4294967296)
                        throw new Error("invalid children; too long (len = " + n);
                    n >= 1 << 20 ? (e.pushByte(p.BINARY_32),
                    e.pushInt32(n)) : n >= 256 ? (e.pushByte(p.BINARY_20),
                    e.pushInt20(n)) : (e.pushByte(p.BINARY_8),
                    e.pushByte(n)),
                    e.pushBytes(t)
                } else {
                    if (!_.isArray(t))
                        throw new Error("invalid children");
                    n = t.length,
                    this.writeListStart(e, n);
                    for (var r = 0; r < n; r++)
                        this.writeNode(e, t[r])
                }
        }
        ,
        this.writeListStart = function(e, t) {
            0 === t ? e.pushByte(p.LIST_EMPTY) : t < 256 ? (e.pushByte(p.LIST_8),
            e.pushByte(t)) : (e.pushByte(p.LIST_16),
            e.pushInt16(t))
        }
        ,
        this.writePackedBytes = function(e, t) {
            try {
                this.writePackedBytesImpl(e, t, p.NIBBLE_8)
            } catch (n) {
                s.warn("writer:enc nib fail, try hex " + n.message, t)(),
                this.writePackedBytesImpl(e, t, p.HEX_8)
            }
        }
        ,
        this.writePackedBytesImpl = function(e, t, n) {
            var r = BinaryReader.numUtf8Bytes(t);
            if (r > p.PACKED_MAX)
                throw new Error("too many bytes to nibble-encode: len = " + r);
            var a, i = Math.ceil(r / 2), o = [], s = 0;
            r % 2 > 0 && (s = 128);
            var d = s | i;
            o.push(n),
            o.push(d);
            for (var u = Math.floor(r / 2), f = 0; f < u; f++)
                a = this.packBytePair(n, t[2 * f], t[2 * f + 1]),
                o.push(a);
            s > 0 && (a = this.packBytePair(n, t[r - 1], "\0"),
            o.push(a));
            var l = new Uint8Array(o);
            e.pushUint8Array(l)
        }
        ,
        this.packBytePair = function(e, t, n) {
            var r, a;
            switch (e) {
            case p.NIBBLE_8:
                r = this.packNibble(t),
                a = this.packNibble(n);
                break;
            case p.HEX_8:
                r = this.packHex(t),
                a = this.packHex(n);
                break;
            default:
                throw new Error("invalid byte pack type: " + e)
            }
            return r << 4 | a
        }
        ,
        this.packNibble = function(e) {
            if (!r.hasOwnProperty(e))
                throw new Error("invalid byte to nibble-pack: " + e);
            return r[e]
        }
        ,
        this.packHex = function(e) {
            switch (e) {
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            case "8":
            case "9":
            case "A":
            case "B":
            case "C":
            case "D":
            case "E":
            case "F":
                return parseInt(e, 16);
            case "\0":
                return 15;
            default:
                throw new Error("packHex:invalid byte: " + e)
            }
        }
    }