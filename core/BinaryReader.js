(function() {
    function BinaryReader() 
	{
        var e = arguments.length <= 0 || void 0 === arguments[0] ? void 0 : arguments[0]
          , t = !(arguments.length <= 1 || void 0 === arguments[1]) && arguments[1];
        e instanceof ArrayBuffer && (e = new Uint8Array(e)),
        "number" == typeof e ? (this._buffer = new Uint8Array(e),
        this._readEndIndex = 0) : e instanceof ArrayBuffer ? (this._buffer = new Uint8Array(e),
        this._readEndIndex = e.byteLength) : e instanceof Uint8Array ? (this._buffer = e,
        this._readEndIndex = e.length) : (this._buffer = null,
        this._readEndIndex = 0),
        this._readIndex = 0,
        this._writeIndex = this._readEndIndex,
        this._view = null,
        this._littleEndian = !!t,
        this._hiddenWrites = 0
    }
    function n() {
        for (var e = 0, t = arguments.length, n = Array(t), a = 0; a < t; a++)
            n[a] = arguments[a];
        for (var i = 0; i < n.length; i++) {
            var d = n[i];
            "string" == typeof d ? e += o(d) : "number" == typeof d ? e++ : d instanceof BinaryReader ? e += d.size() : d instanceof ArrayBuffer ? e += d.byteLength : d instanceof Uint8Array && (e += d.length)
        }
        var s = new BinaryReader(e);
        return s.write.apply(s, n),
        s
    }
    function o(e) {
        if (e === m)
            return _;
        for (var t = 0, r = 0; r < e.length; r++) {
            var n = e.charCodeAt(r);
            n < 128 ? t++ : n < 2048 ? t += 2 : n < 55296 || 57344 <= n && n <= 65535 ? t += 3 : (i(e, r, n),
            r++,
            t += 4)
        }
        return m = e,
        _ = t
    }
    function a(e, t, r) {
        e._hiddenWrites++;
        var n = e._writeIndex;
        try {
            t(e, r),
            n = e._writeIndex
        } finally {
            e._hiddenWrites--,
            e._writeIndex = n
        }
    }
    function i(e, t, r) {
        if (r < 55296 || 56320 <= r)
            throw new TypeError("Invalid first surrogate at wchar-position " + t + ' in "' + e + '"');
        if (++t === e.length)
            throw new TypeError('String ends with incomplete surrogate pair in "' + e + '"');
        var n = e.charCodeAt(t);
        if (n < 56320 || 57344 <= n)
            throw new TypeError("Invalid second surrogate at wchar-position " + t + ' in "' + e + '"')
    }
    function d(e, t, r, n) {
        if ("number" != typeof e || e !== e || Math.floor(e) !== e || e < t || e >= r)
            throw new TypeError("string" == typeof e ? 'WriteError: string "' + e + '" is not a valid ' + n : "WriteError: " + e + " is not a valid " + n)
    }
    function s(e) {
        return e._view || (e._view = new DataView(e._buffer.buffer,e._buffer.byteOffset))
    }
    function advanceGlobally(e, t) {
        if (t < 0)
            throw new Error("ReadError: given negative number of bytes to read");
        var r = e._readIndex
          , n = r + t;
        if (n > e._readEndIndex)
            throw new Error(r === e._readEndIndex ? "ReadError: tried to read from depleted binary" : "ReadError: tried to read beyond end of binary");
        return e._readIndex = n,
        r
    }
    function p(e, t) {
        var r = e._writeIndex
          , n = r + t
          , o = e._buffer;
        if (!o || n > o.length) {
            var a = Math.max(n, o ? 2 * o.length : 64)
              , i = new Uint8Array(a);
            o && i.set(o),
            e._buffer = i,
            e._view = null
        }
        return e._writeIndex = n,
        e._hiddenWrites || (e._readEndIndex = n),
        r
    }
    function u(e, t, r) {
        var n = advanceGlobally(r, 8)
          , o = s(r)
          , a = o.getInt32(t ? n + 4 : n, t)
          , i = o.getInt32(t ? n : n + 4, t);
        return l(e, a, i)
    }
    function f(e, t, r) {
        var n = p(r, 8)
          , o = e < 0;
        o && (e = -e);
        var a = Math.floor(e / 4294967296)
          , i = e - 4294967296 * a
          , d = s(r);
        if (d.setUint32(t ? n + 4 : n, a, t),
        d.setUint32(t ? n : n + 4, i, t),
        o) {
            for (var c = r._buffer, u = n; u < n + 8; u++)
                c[u] = 255 & ~c[u];
            var f = 255;
            if (t)
                for (var l = n; l < n + 8 && 255 === f; l++)
                    f = c[l],
                    c[l] = 255 === f ? 0 : f + 1;
            else
                for (var g = n + 7; g >= n && 255 === f; g--)
                    f = c[g],
                    c[g] = 255 === f ? 0 : f + 1
        }
    }
    function l(e, t, n) {
        var o = t >> 20
          , a = 0 === o || e && o === -1
          , i = t >= 0 ? t : e ? t : 4294967296 + t
          , d = n >= 0 ? n : 4294967296 + n
          , s = 4294967296 * i + d;
        return a ? s : BinaryReader.onLongLong(s, e, t, n)
    }
    var g = 65533
      , h = new Uint8Array(10);
    BinaryReader.prototype = {
        size: function() {
            return this._readEndIndex - this._readIndex
        },
        peek: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? void 0 : arguments[1]
              , r = this._readIndex;
            try {
                return e(this, t)
            } finally {
                this._readIndex = r
            }
        },
        advance: function(e) {
            advanceGlobally(this, e)
        },
        readUint8: function() {
            return this._buffer[advanceGlobally(this, 1)]
        },
        readInt8: function() {
            var e = advanceGlobally(this, 1);
            return s(this).getInt8(e)
        },
        readUint16: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this._littleEndian : arguments[0]
              , t = advanceGlobally(this, 2);
            return s(this).getUint16(t, e)
        },
        readInt32: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this._littleEndian : arguments[0]
              , t = advanceGlobally(this, 4);
            return s(this).getInt32(t, e)
        },
        readUint32: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this._littleEndian : arguments[0]
              , t = advanceGlobally(this, 4);
            return s(this).getUint32(t, e)
        },
        readInt64: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this._littleEndian : arguments[0];
            return u(!0, e, this)
        },
        readUint64: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this._littleEndian : arguments[0];
            return u(!1, e, this)
        },
        readFloat32: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this._littleEndian : arguments[0]
              , t = advanceGlobally(this, 4);
            return s(this).getFloat32(t, e)
        },
        readFloat64: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this._littleEndian : arguments[0]
              , t = advanceGlobally(this, 8);
            return s(this).getFloat64(t, e)
        },
        readVarInt: function() {
            var e = this._readIndex
              , t = this._readEndIndex - e
              , r = this._buffer;
            t <= 0 && advanceGlobally(this, 1);
            var n = void 0
              , o = r[e];
            for (n = 1; n < t && n < 11 && 128 & o; n++)
                o = r[e + n];
            var a = n;
            if (a > 10 || 10 === a && r[e + 9] > 1)
                throw new Error("ParseError: varint exceeds 64 bits");
            128 & o && advanceGlobally(this, a + 1),
            advanceGlobally(this, a);
            var i = 0
              , d = 0;
            for (n = 0; n < 3 && n < a; n++,
            d += 7)
                i |= (127 & r[e + n]) << d;
            if (a < 4)
                return i;
            var s = 0;
            for (d = 0,
            n = 3; n < 6 && n < a; n++,
            d += 7)
                s |= (127 & r[e + n]) << d;
            if (a < 5)
                return s << 21 | i;
            if (a < 7)
                return 2097152 * s + i;
            var p = 0;
            for (d = 0,
            n = 6; n < 9 && n < a; n++,
            d += 7)
                p |= (127 & r[e + n]) << d;
            10 === a && (p |= (1 & r[e + 9]) << 21);
            var u = p << 10 | s >> 11
              , f = s << 21 | i;
            return l(!0, u, f)
        },
        readBuffer: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this.size() : arguments[0];
            if (0 === e)
                return new ArrayBuffer(0);
            var t = advanceGlobally(this, e)
              , r = this._buffer
              , n = t + r.byteOffset
              , o = r.buffer;
            return 0 === n && this._readIndex === o.byteLength ? o : o.slice(n, n + e)
        },
        readByteArray: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this.size() : arguments[0];
            if (0 === e)
                return new Uint8Array(0);
            var t = advanceGlobally(this, e);
            return this._buffer.subarray(t, t + e)
        },
        readBinary: function() {
            var e = arguments.length <= 0 || void 0 === arguments[0] ? this.size() : arguments[0]
              , t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1];
            if (0 === e)
                return new BinaryReader((void 0),t);
            var n = advanceGlobally(this, e)
              , o = this._buffer.subarray(n, n + e);
            return new BinaryReader(o,t)
        },
        readString: function(e) {
            for (var t = advanceGlobally(this, e), r = t + e, n = this._buffer, o = [], a = void 0, i = t, d = e; i < r; i++,
            d--) {
                o.length > 5e3 && (a || (a = []),
                a.push(String.fromCharCode.apply(String, o)),
                o = []);
                var s = 0 | n[i];
                if (0 === (128 & s))
                    o.push(s);
                else if (d >= 2 && 192 === (224 & s)) {
                    var p = 0 | n[i + 1];
                    if (128 === (192 & p)) {
                        var u = (31 & s) << 6 | 63 & p;
                        u >= 128 ? (i++,
                        d--,
                        o.push(u)) : o.push(g)
                    } else
                        o.push(g)
                } else if (d >= 3 && 224 === (240 & s)) {
                    var f = 0 | n[i + 1]
                      , l = 0 | n[i + 2];
                    if (128 === (192 & f) && 128 === (192 & l)) {
                        var h = (15 & s) << 12 | (63 & f) << 6 | 63 & l;
                        h >= 2048 && !(55296 <= h && h < 57344) ? (i += 2,
                        d -= 2,
                        o.push(h)) : o.push(g)
                    } else
                        o.push(g)
                } else if (d >= 4 && 240 === (248 & s)) {
                    var m = 0 | n[i + 1]
                      , _ = 0 | n[i + 2]
                      , b = 0 | n[i + 3];
                    if (128 === (192 & m) && 128 === (192 & _) && 128 === (192 & b)) {
                        var v = (7 & s) << 18 | (63 & m) << 12 | (63 & _) << 6 | 63 & b;
                        if (v >= 65536 && v <= 1114111) {
                            i += 3,
                            d -= 3;
                            var y = v - 65536;
                            o.push(55296 | y >> 10, 56320 | 1023 & y)
                        } else
                            o.push(g)
                    } else
                        o.push(g)
                } else
                    o.push(g)
            }
            var w = String.fromCharCode.apply(String, o);
            return a ? (a.push(w),
            a.join("")) : w
        },
        write: function() {
            for (var e = 0; e < arguments.length; e++) {
                var t = arguments[e];
                "string" == typeof t ? this.writeString(t) : "number" == typeof t ? this.writeUint8(t) : t instanceof BinaryReader ? this.writeBinary(t) : t instanceof ArrayBuffer ? this.writeBuffer(t) : t instanceof Uint8Array && this.writeByteArray(t)
            }
        },
        writeUint8: function(e) {
            d(e, 0, 256, "uint8");
            var t = p(this, 1);
            this._buffer[t] = e
        },
        writeInt8: function(e) {
            d(e, -128, 128, "signed int8");
            var t = p(this, 1);
            this._buffer[t] = e
        },
        writeUint16: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1];
            d(e, 0, 65536, "uint16");
            var r = p(this, 2);
            s(this).setUint16(r, e, t)
        },
        writeInt16: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1];
            d(e, -32768, 32768, "signed int16");
            var r = p(this, 2);
            s(this).setInt16(r, e, t)
        },
        writeUint32: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1];
            d(e, 0, 4294967296, "uint32");
            var r = p(this, 4);
            s(this).setUint32(r, e, t)
        },
        writeInt32: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1];
            d(e, -2147483648, 2147483648, "signed int32");
            var r = p(this, 4);
            s(this).setInt32(r, e, t)
        },
        writeUint64: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1];
            d(e, -0x8000000000000000, 0x8000000000000000, "signed int64"),
            f(e, t, this)
        },
        writeInt64: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1];
            d(e, 0, 0x10000000000000000, "uint64"),
            f(e, t, this)
        },
        writeFloat32: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1]
              , r = p(this, 4);
            s(this).setFloat32(r, e, t)
        },
        writeFloat64: function(e) {
            var t = arguments.length <= 1 || void 0 === arguments[1] ? this._littleEndian : arguments[1]
              , r = p(this, 8);
            s(this).setFloat64(r, e, t)
        },
        writeVarInt: function(e) {
            d(e, -0x8000000000000000, 0x8000000000000000, "varint (signed int64)");
            var t = e < 0;
            t && (e = -e);
            for (var r = e < 128 && 1 || e < 16384 && 2 || e < 2097152 && 3 || e < 268435456 && 4 || e < 34359738368 && 5 || e < 4398046511104 && 6 || e < 562949953421312 && 7 || e < 72057594037927940 && 8 || 9, n = p(this, t ? 10 : r), o = this._buffer, a = e, i = n, s = r; s > 4; s--) {
                var c = Math.floor(a / 128)
                  , u = a - 128 * c;
                o[i++] = 128 | 127 & u,
                a = c
            }
            for (; s > 1; s--)
                o[i++] = 128 | 127 & a,
                a >>= 7;
            if (o[i++] = a,
            t) {
                for (var f = n; f < i; f++)
                    o[f] = 128 | 127 & ~o[f];
                for (var l = i; l < n + 9; l++)
                    o[l] = 255;
                o[n + 9] = 1;
                for (var g = 255, h = n; h < n + 9 && 255 === g; h++)
                    g = o[h],
                    o[h] = 255 === g ? 128 : g + 1
            }
        },
        writeBinary: function(e) {
            var t = e._readIndex
              , r = e._readEndIndex;
            if (t !== r) {
                var n = p(this, r - t);
                this._buffer.set(e._buffer.subarray(t, r), n)
            }
        },
        writeBuffer: function(e) {
            this.writeByteArray(new Uint8Array(e))
        },
        writeByteArray: function(e) {
            var t = p(this, e.length);
            this._buffer.set(e, t)
        },
        writeString: function(e) {
            for (var t = p(this, o(e)), r = this._buffer, n = 0; n < e.length; n++) {
                var a = e.charCodeAt(n);
                if (a < 128)
                    r[t++] = a;
                else if (a < 2048)
                    r[t++] = 192 | a >> 6,
                    r[t++] = 128 | 63 & a;
                else if (a < 55296 || 57344 <= a)
                    r[t++] = 224 | a >> 12,
                    r[t++] = 128 | a >> 6 & 63,
                    r[t++] = 128 | 63 & a;
                else {
                    var i = 65536 + ((1023 & a) << 10 | 1023 & e.charCodeAt(++n));
                    r[t++] = 240 | i >> 18,
                    r[t++] = 128 | i >> 12 & 63,
                    r[t++] = 128 | i >> 6 & 63,
                    r[t++] = 128 | 63 & i
                }
            }
        },
        writeBytes: function() {
            for (var e = 0; e < arguments.length; e++)
                d(arguments[e], 0, 256, "byte");
            for (var t = p(this, arguments.length), r = this._buffer, n = 0; n < arguments.length; n++)
                r[t + n] = arguments[n]
        },
        writeWithVarIntLength: function(e, t) {
            var r = this._writeIndex;
            a(this, e, t);
            var n = this._writeIndex;
            this.writeVarInt(n - r);
            for (var o = this._writeIndex - n, i = this._buffer, d = 0; d < o; d++)
                h[d] = i[n + d];
            for (var s = n - 1; s >= r; s--)
                i[s + o] = i[s];
            for (var c = 0; c < o; c++)
                i[r + c] = h[c]
        }
    },
    BinaryReader.onLongLong = function(e) {
        throw new Error("ReadError: integer exceeded 52 bits (" + e + ")")
    }
    ,
    BinaryReader.build = n;
    var m = ""
      , _ = 0;
    BinaryReader.numUtf8Bytes = o;
	
	window.BinaryReader = BinaryReader;
 
 })();