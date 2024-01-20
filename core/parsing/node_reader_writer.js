//
// This is the WhatsApp Web implemenation for the binary nodes encoding/decoding.
// All needed modules were copied, with some modifications.
//

var WACopiedModules = [];

WACopiedModules[415227] = (e, thiz, n)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.default = function(e) {
        const t = new Error(e);
        if (void 0 === t.stack)
            try {
                throw t
            } catch (e) {}
        return t
    }
}

WACopiedModules[654302] = e=>{
    "use strict";
    var t = Object.prototype.hasOwnProperty
      , n = "function" == typeof WeakMap ? new WeakMap : new Map;
    function r(e) {
        var t = n.get(e);
        if (void 0 !== t)
            return t;
        var r = new Map;
        return Object.getOwnPropertyNames(e).forEach((function(t) {
            r.set(e[t], t)
        }
        )),
        n.set(e, r),
        r
    }
    var i = Object.freeze(Object.defineProperties(Object.create(null), {
        isValid: {
            value: function(e) {
                return r(this).has(e)
            }
        },
        cast: {
            value: function(e) {
                return this.isValid(e) ? e : void 0
            }
        },
        members: {
            value: function() {
                return r(this).keys()
            }
        },
        getName: {
            value: function(e) {
                return r(this).get(e)
            }
        }
    }));
    function o(e) {
        var n = Object.create(i);
        for (var r in e)
            t.call(e, r) && Object.defineProperty(n, r, {
                value: e[r]
            });
        return Object.freeze(n)
    }
    var a = Object.freeze(Object.defineProperties(Object.create(null), {
        isValid: {
            value: function(e) {
                return "string" == typeof e && t.call(this, e)
            }
        },
        cast: {
            value: i.cast
        },
        members: {
            value: function() {
                return Object.getOwnPropertyNames(this)
            }
        },
        getName: {
            value: function(e) {
                return e
            }
        }
    }));
    o.Mirrored = function(e) {
        for (var t = Object.create(a), n = 0, r = e.length; n < r; ++n)
            Object.defineProperty(t, e[n], {
                value: e[n]
            });
        return Object.freeze(t)
    }
    ,
    Object.freeze(o.Mirrored),
    e.exports = Object.freeze(o)
}

WACopiedModules[390934] = (e, thiz, findModule)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.NUM_HEX_IN_LONG = thiz.HEX_LOWER = void 0,
    thiz.bytesToBuffer = function(e) {
        const t = e.buffer;
        return 0 === e.byteOffset && e.length === t.byteLength ? t : t.slice(e.byteOffset, e.byteOffset + e.length)
    }
    ,
    thiz.bytesToDebugString = function(e) {
        let t = !0
          , n = e.length;
        for (; t && n; ) {
            const r = e[--n];
            t = 32 <= r && r < 127
        }
        return t ? JSON.stringify(String.fromCharCode.apply(String, e)) : s(e)
    }
    ,
    thiz.createHexLong = c,
    thiz.createHexLongFrom32Bits = function(e, t) {
        let n = arguments.length > 2 && void 0 !== arguments[2] && arguments[2];
        const r = g(e)
          , i = g(t);
        return `${n ? "-" : ""}0x${r}${i}`
    }
    ,
    thiz.hexAt = l,
    thiz.hexLongFromNumber = function(e) {
        const t = e < 0;
        return c(t ? (-e).toString(16) : e.toString(16), t)
    }
    ,
    thiz.hexLongIsNegative = f,
    thiz.hexLongToHex = p,
    thiz.hexOrThrow = u,
    thiz.isBiggerHexLong = function(e, t) {
        const n = f(e)
          , r = f(t);
        if (n !== r)
            return !n;
        const i = p(e) > p(t);
        return n ? !i : i
    }
    ,
    thiz.negateHexLong = function(e) {
        return f(e) ? e.slice(1) : "-" + e
    }
    ,
    thiz.parseHex = function(e) {
        const t = u(e);
        if (t.length % 2 != 0)
            throw (0,
            i.default)(`parseHex given hex "${t}" which is not a multiple of 8-bits.`);
        const n = new Uint8Array(t.length >> 1);
        for (let e = 0, r = 0; e < t.length; e += 2,
        r++)
            n[r] = l(t, e) << 4 | l(t, e + 1);
        return n.buffer
    }
    ,
    thiz.randomHex = function(e) {
        const t = new Uint8Array(e);
        return self.crypto.getRandomValues(t),
        s(t)
    }
    ,
    thiz.toHex = s,
    thiz.toLowerCaseHex = function(e) {
        const t = [];
        for (let n = 0; n < e.length; n++) {
            const r = e[n];
            t.push(o[r >> 4], o[15 & r])
        }
        return String.fromCharCode.apply(String, t)
    }
    ;
    var i = findModule(415227);
    thiz.NUM_HEX_IN_LONG = 16;
    const a = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 65, 66, 67, 68, 69, 70]
      , o = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102];
    function s(e) {
        const t = [];
        for (let n = 0; n < e.length; n++) {
            const r = e[n];
            t.push(a[r >> 4], a[15 & r])
        }
        return String.fromCharCode.apply(String, t)
    }
    function l(e, t) {
        const n = e.charCodeAt(t);
        return n <= 57 ? n - 48 : n <= 70 ? 10 + n - 65 : 10 + n - 97
    }
    function u(e) {
        if (/[^0-9a-fA-F]/.test(e))
            throw (0,
            i.default)(`"${e}" is not a valid hex`);
        return e
    }
    function c(e) {
        let t = arguments.length > 1 && void 0 !== arguments[1] && arguments[1];
        const n = u(e);
        return _(n, 16),
        `${t ? "-" : ""}0x${d(n, 16)}`
    }
    function d(e, t) {
        const n = t - e.length;
        let r = e;
        for (let e = 0; e < n; e++)
            r = "0" + r;
        return r
    }
    function p(e) {
        return e.substring(e.indexOf("0x") + 2)
    }
    function f(e) {
        return "-" === e[0]
    }
    function _(e, t) {
        if (e.length > t)
            throw (0,
            i.default)(`"${e}" is longer than ${4 * t} bits.`)
    }
    function g(e) {
        if (e > 4294967295 || e < -4294967296)
            throw (0,
            i.default)("uint32ToLowerCaseHex given number over 32 bits");
        return d((e >= 0 ? e : 4294967296 + e).toString(16), 8)
    }
    thiz.HEX_LOWER = o
}

WACopiedModules[367420] = (e, thiz, findModule)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.default = function(e) {
        throw (0,
        i.default)(`Impossible value, the default statement should never be reached for value: ${e}`)
    }
    ;
    var i = findModule(415227)
}

WACopiedModules[361592] = (e,t)=>{
    "use strict";
    Object.defineProperty(t, "__esModule", {
        value: !0
    }),
    t.default = function(e) {
        const t = e.replace(/>\s{0,}</g, "><").replace(/</g, "~::~<").replace(/\s*xmlns:/g, "~::~xmlns:").replace(/\s*xmlns=/g, "~::~xmlns=").split("~::~")
          , n = t.length;
        let r = !1
          , i = 0
          , a = ""
          , o = 0;
        const s = ["\n"];
        for (o = 0; o < 100; o++)
            s.push(s[o] + "    ");
        const l = function(e, t) {
            const n = /^<[\w:\-.,]+/.exec(e[t - 1])
              , r = /^<\/[\w:\-.,]+/.exec(e[t]);
            return null != n && null != r && n[0] === r[0]
        };
        for (o = 0; o < n; o++)
            t[o].search(/<!/) > -1 ? (a += s[i] + t[o],
            r = !0,
            (t[o].search(/-->/) > -1 || t[o].search(/\]>/) > -1 || t[o].search(/!DOCTYPE/) > -1) && (r = !1)) : t[o].search(/-->/) > -1 || t[o].search(/\]>/) > -1 ? (a += t[o],
            r = !1) : l(t, o) ? (a += t[o],
            r || i--) : t[o].search(/<\w/) > -1 && -1 === t[o].search(/<\//) && -1 === t[o].search(/\/>/) ? a = a += r ? t[o] : s[i++] + t[o] : t[o].search(/<\w/) > -1 && t[o].search(/<\//) > -1 ? a = a += r ? t[o] : s[i] + t[o] : t[o].search(/<\//) > -1 ? a = a += r ? t[o] : s[0 === i ? i : --i] + t[o] : t[o].search(/\/>/) > -1 ? a = a += r ? t[o] : s[i] + t[o] : t[o].search(/<\?/) > -1 || t[o].search(/xmlns:/) > -1 || t[o].search(/xmlns=/) > -1 ? a += s[i] + t[o] : a += t[o];
        return "\n" === a[0] ? a.slice(1) : a
    }
}

// binary reader/writer
WACopiedModules[904704] = (e, thiz, findModule)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.Binary = void 0,
    thiz.longFitsInDouble = f,
    thiz.numUtf8Bytes = p,
    thiz.parseInt64OrThrow = V,
    thiz.parseUint64OrThrow = H;
    var i = findModule(415227)
      , a = findModule(390934);
    const o = 65533
      , s = new Uint8Array(10)
      , l = new Uint8Array(0);
    class BinaryClass {
        constructor() {
            var e = this;
            let t = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : l
              , n = arguments.length > 1 && void 0 !== arguments[1] && arguments[1];
            this._buffer = new Uint8Array(0),
            this._readEndIndex = 0,
            this._writeIndex = 0,
            this.write = function() {
                for (let t = 0; t < arguments.length; t++) {
                    const thingToWrite = t < 0 || arguments.length <= t ? void 0 : arguments[t];
                    "string" == typeof thingToWrite ? e.writeString(thingToWrite) : "number" == typeof thingToWrite ? e.writeUint8(thingToWrite) : thingToWrite instanceof BinaryClass ? e.writeBinary(thingToWrite) : thingToWrite instanceof ArrayBuffer ? e.writeBuffer(thingToWrite) : thingToWrite instanceof Uint8Array && e.writeByteArray(thingToWrite)
                }
            }
            ,
            t instanceof ArrayBuffer ? (this._buffer = new Uint8Array(t),
            this._readEndIndex = this._writeIndex = t.byteLength) : t instanceof Uint8Array && (this._buffer = t,
            this._readEndIndex = this._writeIndex = t.length),
            this._bytesTrashed = 0,
            this._earliestIndex = this._readIndex = 0,
            this._view = null,
            this._littleEndian = n,
            this._hiddenReads = 0,
            this._hiddenWrites = 0
        }
        size() {
            return this._readEndIndex - this._readIndex
        }
        peek(e, t) {
            this._hiddenReads++;
            const n = this._readIndex
              , r = this._bytesTrashed;
            try {
                return e(this, t)
            } finally {
                this._hiddenReads--,
                this._readIndex = n - (this._bytesTrashed - r)
            }
        }
        advance(e) {
            this._shiftReadOrThrow(e)
        }
        readWithViewParser(e, t, n, r) {
            return t(this._getView(), this._shiftReadOrThrow(e), e, n, r)
        }
        readWithBytesParser(e, t, n, r) {
            return t(this._buffer, this._shiftReadOrThrow(e), e, n, r)
        }
        readUint8() {
            return _(this, 1, m, !1)
        }
        readInt8() {
            return _(this, 1, m, !0)
        }
        readUint16() {
            return _(this, 2, h, arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this._littleEndian)
        }
        readInt32() {
            return _(this, 4, y, arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this._littleEndian)
        }
        readUint32() {
            return _(this, 4, E, arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this._littleEndian)
        }
        readInt64() {
            return _(this, 8, S, V, arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this._littleEndian)
        }
        readUint64() {
            return _(this, 8, S, H, arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this._littleEndian)
        }
        readLong(e) {
            return _(this, 8, S, e, arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian)
        }
        readFloat32() {
            return _(this, 4, v, arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this._littleEndian)
        }
        readFloat64() {
            return _(this, 8, T, arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this._littleEndian)
        }
        readVarInt(e) {
            const t = g(this, 0, M, this.size());
            return g(this, t, b, e)
        }
        readBuffer() {
            let e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this.size();
            return 0 === e ? new ArrayBuffer(0) : g(this, e, A)
        }
        readByteArray() {
            let e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this.size();
            return 0 === e ? new Uint8Array(0) : g(this, e, C)
        }
        readBinary() {
            let e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : this.size()
              , t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian;
            if (0 === e)
                return new BinaryClass(void 0,t);
            const n = g(this, e, C);
            return new BinaryClass(n,t)
        }
        indexOf(e) {
            if (0 === e.length)
                return 0;
            const t = this._buffer
              , n = this._readEndIndex
              , r = this._readIndex;
            let i = 0
              , a = r;
            for (let o = r; o < n; o++)
                if (t[o] === e[i]) {
                    if (0 === i && (a = o),
                    i++,
                    i === e.byteLength)
                        return o - r - e.byteLength + 1
                } else
                    i > 0 && (i = 0,
                    o = a);
            return -1
        }
        readString(e) {
            return g(this, e, P)
        }
        ensureCapacity(e) {
            this._maybeReallocate(this._readIndex + e)
        }
        ensureAdditionalCapacity(e) {
            this._maybeReallocate(this._writeIndex + e)
        }
        writeToView(e, t, n, r) {
            const i = this._shiftWriteMaybeReallocate(e);
            return t(this._getView(), i, e, n, r)
        }
        writeToBytes(e, t, n, r) {
            const i = this._shiftWriteMaybeReallocate(e);
            return t(this._buffer, i, e, n, r)
        }
        writeUint8(e) {
            Y(e, 0, 256, "uint8"),
            I(this, 1, R, e, !1)
        }
        writeInt8(e) {
            Y(e, -128, 128, "signed int8"),
            I(this, 1, R, e, !0)
        }
        writeUint16(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian;
            Y(e, 0, 65536, "uint16"),
            O(this, 2, N, e, t)
        }
        writeInt16(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian;
            Y(e, -32768, 32768, "signed int16"),
            O(this, 2, D, e, t)
        }
        writeUint32(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian;
            Y(e, 0, 4294967296, "uint32"),
            O(this, 4, w, e, t)
        }
        writeInt32(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian;
            Y(e, -2147483648, 2147483648, "signed int32"),
            O(this, 4, L, e, t)
        }
        writeUint64(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian;
            Y(e, 0, 0x10000000000000000, "uint64"),
            O(this, 8, k, e, t)
        }
        writeInt64(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian;
            Y(e, -0x8000000000000000, 0x8000000000000000, "signed int64"),
            O(this, 8, k, e, t)
        }
        writeFloat32(e) {
            O(this, 4, x, e, arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian)
        }
        writeFloat64(e) {
            O(this, 8, B, e, arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian)
        }
        writeVarInt(e) {
            Y(e, -0x8000000000000000, 0x8000000000000000, "varint (signed int64)");
            const t = e < 0
              , n = t ? -e : e;
            let r = Math.floor(n / 4294967296)
              , i = n - 4294967296 * r;
            t && (r = ~r,
            0 === i ? r++ : i = -i);
            I(this, K(r, i), F, r, i)
        }
        writeVarIntFromHexLong(e) {
            const t = (0,
            a.hexLongIsNegative)(e)
              , n = t ? (0,
            a.negateHexLong)(e) : e
              , r = (0,
            a.hexLongToHex)(n);
            let i = 0
              , o = 0;
            for (let e = 0; e < a.NUM_HEX_IN_LONG; e++)
                i = i << 4 | o >>> 28,
                o = o << 4 | (0,
                a.hexAt)(r, e);
            t && (i = ~i,
            0 === o ? i++ : o = -o);
            I(this, K(i, o), F, i, o)
        }
        writeBinary(e) {
            const t = e.peek((e=>e.readByteArray()));
            if (t.length) {
                const e = this._shiftWriteMaybeReallocate(t.length);
                this._buffer.set(t, e)
            }
        }
        writeBuffer(e) {
            this.writeByteArray(new Uint8Array(e))
        }
        writeByteArray(e) {
            const t = this._shiftWriteMaybeReallocate(e.length);
            this._buffer.set(e, t)
        }
        writeBufferView(e) {
            this.writeByteArray(new Uint8Array(e.buffer,e.byteOffset,e.byteLength))
        }
        writeString(e) {
            I(this, p(e), U, e)
        }
        writeHexLong(e) {
            O(this, 8, G, e, arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : this._littleEndian)
        }
        writeBytes() {
            for (var e = arguments.length, t = new Array(e), n = 0; n < e; n++)
                t[n] = arguments[n];
            for (let e = 0; e < t.length; e++)
                Y(t[e], 0, 256, "byte");
            I(this, t.length, j, t)
        }
        writeAtomically(e, t) {
            this._hiddenWrites++;
            let n = this._writeIndex
              , r = this._bytesTrashed;
            try {
                const i = e(this, t);
                return n = this._writeIndex,
                r = this._bytesTrashed,
                i
            } finally {
                this._hiddenWrites--,
                this._writeIndex = n - (this._bytesTrashed - r)
            }
        }
        writeWithVarIntLength(e, t) {
            const n = this._writeIndex
              , r = this.writeAtomically(e, t)
              , i = this._writeIndex;
            this.writeVarInt(i - n);
            const a = this._writeIndex - i
              , o = this._buffer;
            for (let e = 0; e < a; e++)
                s[e] = o[i + e];
            for (let e = i - 1; e >= n; e--)
                o[e + a] = o[e];
            for (let e = 0; e < a; e++)
                o[n + e] = s[e];
            return r
        }
        static build() {
            for (var e = arguments.length, t = new Array(e), n = 0; n < e; n++)
                t[n] = arguments[n];
            let r = 0;
            for (let e = 0; e < t.length; e++) {
                const n = t[e];
                "string" == typeof n ? r += p(n) : "number" == typeof n ? r++ : n instanceof BinaryClass ? r += n.size() : n instanceof ArrayBuffer ? r += n.byteLength : n instanceof Uint8Array && (r += n.length)
            }
            const i = new BinaryClass;
            return i.ensureCapacity(r),
            i.write.apply(i, arguments),
            i
        }
        _getView() {
            return this._view || (this._view = new DataView(this._buffer.buffer,this._buffer.byteOffset))
        }
        _shiftReadOrThrow(e) {
            if (e < 0)
                throw (0,
                i.default)("ReadError: given negative number of bytes to read");
            const t = this._readIndex
              , n = t + e;
            if (n > this._readEndIndex)
                throw (0,
                i.default)(t === this._readEndIndex ? "ReadError: tried to read from depleted binary" : "ReadError: tried to read beyond end of binary");
            return this._readIndex = n,
            this._hiddenReads || (this._earliestIndex = n),
            t
        }
        _maybeReallocate(e) {
            const t = this._buffer;
            if (e <= t.length)
                return e;
            {
                const n = this._earliestIndex
                  , r = e - n
                  , i = Math.max(r, 2 * (t.length - n), 64)
                  , a = new Uint8Array(i);
                return n ? (a.set(t.subarray(n)),
                this._bytesTrashed += n,
                this._readIndex -= n,
                this._readEndIndex -= n,
                this._writeIndex -= n,
                this._earliestIndex = 0) : a.set(t),
                this._buffer = a,
                this._view = null,
                r
            }
        }
        _shiftWriteMaybeReallocate(e) {
            const t = this._maybeReallocate(this._writeIndex + e)
              , n = this._writeIndex;
            return this._writeIndex = t,
            this._hiddenWrites || (this._readEndIndex = t),
            n
        }
    }
    thiz.Binary = BinaryClass;
    let c = ""
      , d = 0;
    function p(e) {
        if (e === c)
            return d;
        const t = e.length;
        let n = 0;
        for (let r = 0; r < t; r++) {
            const i = e.charCodeAt(r);
            if (i < 128)
                n++;
            else if (i < 2048)
                n += 2;
            else if (i < 55296 || 57344 <= i && i <= 65535)
                n += 3;
            else if (55296 <= i && i < 56320 && r + 1 !== t) {
                const t = e.charCodeAt(r + 1);
                56320 <= t && t < 57344 ? (r++,
                n += 4) : n += 3
            } else
                n += 3
        }
        return c = e,
        d = n
    }
    function f(e, t, n) {
        const r = t >> 21;
        if (e) {
            const e = Boolean(2097151 & t || n);
            return 0 === r || -1 === r && e
        }
        return 0 === r
    }
    function _(e, t, n, r, i) {
        return e.readWithViewParser(t, n, r, i)
    }
    function g(e, t, n, r, i) {
        return e.readWithBytesParser(t, n, r, i)
    }
    function m(e, t, n, r) {
        return r ? e.getInt8(t) : e.getUint8(t)
    }
    function h(e, t, n, r) {
        return e.getUint16(t, r)
    }
    function y(e, t, n, r) {
        return e.getInt32(t, r)
    }
    function E(e, t, n, r) {
        return e.getUint32(t, r)
    }
    function S(e, t, n, r, i) {
        return r(e.getInt32(i ? t + 4 : t, i), e.getInt32(i ? t : t + 4, i))
    }
    function v(e, t, n, r) {
        return e.getFloat32(t, r)
    }
    function T(e, t, n, r) {
        return e.getFloat64(t, r)
    }
    function M(e, t, n, r) {
        const a = Math.min(r, 10);
        let o = 0
          , s = 128;
        for (; o < a && 128 & s; )
            s = e[t + o++];
        if (10 === o && s > 1)
            throw (0,
            i.default)("ParseError: varint exceeds 64 bits");
        return 128 & s ? o + 1 : o
    }
    function b(e, t, n, r) {
        let i = 0
          , a = 0
          , o = n;
        10 === n && (o--,
        a = 1 & e[t + o]);
        for (let n = o - 1; n >= 0; n--)
            i = i << 7 | a >>> 25,
            a = a << 7 | 127 & e[t + n];
        return r(i, a)
    }
    function A(e, t, n) {
        const r = t + e.byteOffset
          , i = e.buffer;
        return 0 === r && n === i.byteLength ? i : i.slice(r, r + n)
    }
    function C(e, t, n) {
        return e.subarray(t, t + n)
    }
    function P(e, t, n) {
        const r = t + n;
        let i = []
          , a = null;
        for (let n = t; n < r; n++) {
            i.length > 5e3 && (a || (a = []),
            a.push(String.fromCharCode.apply(String, i)),
            i = []);
            const t = 0 | e[n];
            if (0 == (128 & t))
                i.push(t);
            else if (192 == (224 & t)) {
                const a = $(e, n + 1, r);
                if (a) {
                    n++;
                    const e = (31 & t) << 6 | 63 & a;
                    e >= 128 ? i.push(e) : i.push(o)
                } else
                    i.push(o)
            } else if (224 == (240 & t)) {
                const a = $(e, n + 1, r)
                  , s = $(e, n + 2, r);
                if (a && s) {
                    n += 2;
                    const e = (15 & t) << 12 | (63 & a) << 6 | 63 & s;
                    e >= 2048 && !(55296 <= e && e < 57344) ? i.push(e) : i.push(o)
                } else
                    a ? (n++,
                    i.push(o)) : i.push(o)
            } else if (240 == (248 & t)) {
                const a = $(e, n + 1, r)
                  , s = $(e, n + 2, r)
                  , l = $(e, n + 3, r);
                if (a && s && l) {
                    n += 3;
                    const e = (7 & t) << 18 | (63 & a) << 12 | (63 & s) << 6 | 63 & l;
                    if (e >= 65536 && e <= 1114111) {
                        const t = e - 65536;
                        i.push(55296 | t >> 10, 56320 | 1023 & t)
                    } else
                        i.push(o)
                } else
                    a && s ? (n += 2,
                    i.push(o)) : a ? (n++,
                    i.push(o)) : i.push(o)
            } else
                i.push(o)
        }
        const s = String.fromCharCode.apply(String, i);
        return a ? (a.push(s),
        a.join("")) : s
    }
    function O(e, t, n, r, i) {
        return e.writeToView(t, n, r, i)
    }
    function I(e, t, n, r, i) {
        return e.writeToBytes(t, n, r, i)
    }
    function R(e, t, n, r) {
        e[t] = r
    }
    function N(e, t, n, r, i) {
        e.setUint16(t, r, i)
    }
    function D(e, t, n, r, i) {
        e.setInt16(t, r, i)
    }
    function w(e, t, n, r, i) {
        e.setUint32(t, r, i)
    }
    function L(e, t, n, r, i) {
        e.setInt32(t, r, i)
    }
    function k(e, t, n, r, i) {
        const a = r < 0
          , o = a ? -r : r;
        let s = Math.floor(o / 4294967296)
          , l = o - 4294967296 * s;
        a && (s = ~s,
        0 === l ? s++ : l = -l),
        e.setUint32(i ? t + 4 : t, s, i),
        e.setUint32(i ? t : t + 4, l, i)
    }
    function x(e, t, n, r, i) {
        e.setFloat32(t, r, i)
    }
    function B(e, t, n, r, i) {
        e.setFloat64(t, r, i)
    }
    function F(e, t, n, r, i) {
        let a = r
          , o = i;
        const s = t + n - 1;
        for (let n = t; n < s; n++)
            e[n] = 128 | 127 & o,
            o = a << 25 | o >>> 7,
            a >>>= 7;
        e[s] = o
    }
    function U(e, t, n, r) {
        let i = t;
        const a = r.length;
        for (let t = 0; t < a; t++) {
            const n = r.charCodeAt(t);
            if (n < 128)
                e[i++] = n;
            else if (n < 2048)
                e[i++] = 192 | n >> 6,
                e[i++] = 128 | 63 & n;
            else if (n < 55296 || 57344 <= n)
                e[i++] = 224 | n >> 12,
                e[i++] = 128 | n >> 6 & 63,
                e[i++] = 128 | 63 & n;
            else if (55296 <= n && n < 56320 && t + 1 !== a) {
                const a = r.charCodeAt(t + 1);
                if (56320 <= a && a < 57344) {
                    t++;
                    const r = 65536 + ((1023 & n) << 10 | 1023 & a);
                    e[i++] = 240 | r >> 18,
                    e[i++] = 128 | r >> 12 & 63,
                    e[i++] = 128 | r >> 6 & 63,
                    e[i++] = 128 | 63 & r
                } else
                    e[i++] = 239,
                    e[i++] = 191,
                    e[i++] = 189
            } else
                e[i++] = 239,
                e[i++] = 191,
                e[i++] = 189
        }
    }
    function G(e, t, n, r, i) {
        const o = (0,
        a.hexLongIsNegative)(r)
          , s = (0,
        a.hexLongToHex)(r);
        let l = 0
          , u = 0;
        for (let e = 0; e < 16; e++)
            l = l << 4 | u >>> 28,
            u = u << 4 | (0,
            a.hexAt)(s, e);
        o && (l = ~l,
        0 === u ? l++ : u = -u),
        e.setUint32(i ? t + 4 : t, l, i),
        e.setUint32(i ? t : t + 4, u, i)
    }
    function j(e, t, n, r) {
        for (let i = 0; i < n; i++)
            e[t + i] = r[i]
    }
    function K(e, t) {
        let n, r;
        for (e ? (n = 5,
        r = e >>> 3) : (n = 1,
        r = t >>> 7); r; )
            n++,
            r >>>= 7;
        return n
    }
    function Y(e, t, n, r) {
        if ("number" != typeof e || e != e || Math.floor(e) !== e || e < t || e >= n)
            throw (0,
            i.default)("string" == typeof e ? `TyperError WriteError: string "${e}" is not a valid ${r}` : `TypeError WriteError: ${String(e)} is not a valid ${r}`)
    }
    function W(e, t, n) {
        let r;
        r = t >= 0 || e ? t : 4294967296 + t;
        const a = 4294967296 * r + (n >= 0 ? n : 4294967296 + n);
        if (!f(e, t, n))
            throw (0,
            i.default)(`ReadError: integer exceeded 53 bits (${a})`);
        return a
    }
    function V(e, t) {
        return W(!0, e, t)
    }
    function H(e, t) {
        return W(!1, e, t)
    }
    function $(e, t, n) {
        if (t >= n)
            return 0;
        const r = 0 | e[t];
        return 128 == (192 & r) ? r : 0
    }
}

// JID utils
WACopiedModules[418987] = (e, thiz, findModule)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.WA_USER_JID_SUFFIX = thiz.WA_USER_DOMAIN = thiz.WA_SERVER_JID_SUFFIX = thiz.WA_NEWSLETTER_JID_DOMAIN = thiz.WA_LID_SUFFIX = thiz.SURVEY_USER_JID = thiz.STATUS_JID = thiz.PSA_JID = thiz.MSGR_USER_JID_SUFFIX = thiz.MSGR_USER_DOMAIN = thiz.LID_SUFFIX = thiz.LID_DOMAIN = thiz.INTEROP_USER_JID_SUFFIX = thiz.INTEROP_DOMAIN = thiz.HOSTED_SUFFIX = thiz.HOSTED_LID_SUFFIX = thiz.HOSTED_LID_DOMAIN = thiz.HOSTED_DOMAIN = thiz.DEFAULT_DEVICE_ID = thiz.AUTHOR_SYSTEM = thiz.AUTHOR_ME = void 0,
    thiz.asChatJid = function(e) {
        return e === l ? null : e
    }
    ,
    thiz.asMulticastJid = function(e) {
        return null == K(e) ? e : null
    }
    ,
    thiz.asPhoneChatJid = function(e) {
        return e === l ? null : e
    }
    ,
    thiz.asStatusJid = function(e) {
        return e === l ? l : null
    }
    ,
    thiz.authorAsPhoneUserJid = function(e) {
        if (e === o || e === s)
            return null;
        if (!e.endsWith(y))
            return null;
        return e
    }
    ,
    thiz.authorAsUserJid = function(e) {
        if (e === o || e === s)
            return null;
        return e
    }
    ,
    thiz.authorToUserId = function(e, t) {
        return e === o || e === s ? t : F(e)
    }
    ,
    thiz.createJidUtils = function(e) {
        let {platform: t} = e;
        const n = "msgr" === t ? d : y;
        return {
            toUserJid: function(e) {
                return `${e}${n}`
            },
            getUserDomain: function() {
                return n
            },
            getGroupCallDomain: function() {
                return "@call"
            }
        }
    }
    ,
    thiz.defaultDeviceJidForUser = ie,
    thiz.defaultLidDeviceJidForLidUserJid = function(e) {
        return B(e, 0)
    }
    ,
    thiz.defaultMsgrDeviceJidForUser = function(e) {
        return `${x(e)}:0@msgr`
    }
    ,
    thiz.defaultPhoneDeviceJidForUser = function(e) {
        return `${x(e)}:0@s.whatsapp.net`
    }
    ,
    thiz.extractDeviceIDParts = U,
    thiz.extractDeviceId = G,
    thiz.extractFromJid = H,
    thiz.extractJidFromJidWithType = function(e) {
        if ("phoneDevice" === e.jidType)
            return e.deviceJid;
        if ("interopDevice" === e.jidType)
            return e.deviceJid;
        if ("lidDevice" === e.jidType)
            return e.deviceJid;
        if ("msgrDevice" === e.jidType)
            return e.deviceJid;
        if ("lidUser" === e.jidType)
            return e.userJid;
        if ("interopUser" === e.jidType)
            return e.userJid;
        if ("msgrUser" === e.jidType)
            return e.userJid;
        if ("phoneUser" === e.jidType)
            return e.userJid;
        if ("group" === e.jidType)
            return e.groupJid;
        if ("status" === e.jidType)
            return e.statusJid;
        if ("call" === e.jidType)
            return e.callJid;
        if ("newsletter" === e.jidType)
            return e.newsletterJid;
        if ("hosted" === e.jidType)
            return e.hostedDeviceJid;
        if ("hostedLid" === e.jidType)
            throw (0,
            a.default)("extractJidFromJidWithType: unexpected env");
        return e.jidType,
        e.broadcastJid
    }
    ,
    thiz.extractLidUserJid = function(e) {
        return W(e)
    }
    ,
    thiz.extractPhoneUserJid = function(e) {
        return W(e)
    }
    ,
    thiz.extractUserId = F,
    thiz.extractUserJid = W,
    thiz.fullFormDeviceJidString = function(e) {
        const {user: t, agent: n="0", device: r="0", server: i} = V(e);
        return `${t}.${n}:${r}@${i}`
    }
    ,
    thiz.getGroupDomain = function() {
        return u
    }
    ,
    thiz.getMsgrUserDomain = function() {
        return d
    }
    ,
    thiz.getServerDomain = function() {
        return "@s.whatsapp.net"
    }
    ,
    thiz.getWhatsappUserDomain = function() {
        return y
    }
    ,
    thiz.groupIdFromJid = X,
    thiz.interpretAndValidateJid = $,
    thiz.interpretAsDeviceId = function(e) {
        return e
    }
    ,
    thiz.interpretAsGroupJid = ee,
    thiz.interpretAsNumber = function(e) {
        return e
    }
    ,
    thiz.interpretAsPhoneUserJid = function(e) {
        return e.endsWith(y) ? e : null
    }
    ,
    thiz.interpretAsUserJid = K,
    thiz.isAuthorMe = function(e) {
        return "@me" === e
    }
    ,
    thiz.isAuthorSystem = function(e) {
        return "@system" === e
    }
    ,
    thiz.isLidUser = function(e) {
        return e.endsWith(b)
    }
    ,
    thiz.isPrimaryDevice = function(e) {
        return 0 === G(e)
    }
    ,
    thiz.lidFromLidUserJid = Y,
    thiz.lidOrPhoneFromUserJid = function(e) {
        if (e.endsWith(y))
            return j(e);
        if (e.endsWith(b))
            return Y(e);
        throw (0,
        a.default)(`lidOrPhoneFromUserJid called with non phone or lid jid "${e}"`)
    }
    ,
    thiz.maybeSanitizeLogLineText = function(e) {
        if (!e.includes("@"))
            return e;
        return e.replace(L, Z)
    }
    ,
    thiz.parseJidParts = V,
    thiz.phoneNumberFromJid = j,
    thiz.sanitizeJidForLogging = Z,
    thiz.stripAgentIdFromPhoneDeviceJid = function(e) {
        const {user: t, device: n="0", server: r} = V(e);
        return `${t}:${n}@${r}`
    }
    ,
    thiz.switchOnChatJidType = te,
    thiz.switchOnJidType = function(e, t) {
        if (e === l)
            return t.status();
        return te(e, {
            interopUser: t.interopUser,
            phoneUser: t.phoneUser,
            msgrUser: t.msgrUser,
            lidUser: t.lidUser,
            group: t.group
        })
    }
    ,
    thiz.switchOnMsgrChatJidType = function(e, t) {
        if (e.endsWith(d))
            return t.user(e);
        if (null != ee(e))
            return t.group(e);
        throw (0,
        a.default)(`Can not switch on chat jid ${e}`)
    }
    ,
    thiz.switchOnMulticastJidType = function(e, t) {
        if (e === l)
            return t.multicast(l);
        return ne(e, {
            user: t.user,
            group: t.multicast
        })
    }
    ,
    thiz.switchOnPhoneChatJidType = ne,
    thiz.switchOnPhoneJidType = function(e, t) {
        if (e === l)
            return t.status();
        return ne(e, {
            user: t.user,
            group: t.group
        })
    }
    ,
    thiz.switchOnUserChatJidType = function(e, t) {
        return te(e, {
            lidUser: e=>t.user(e),
            interopUser: e=>t.user(e),
            msgrUser: e=>t.user(e),
            phoneUser: e=>t.user(e),
            group: e=>t.group(e)
        })
    }
    ,
    thiz.threadIdForChatJid = function(e) {
        return te(e, {
            group: e=>X(e),
            lidUser: e=>x(e),
            interopUser: e=>x(e),
            phoneUser: e=>x(e),
            msgrUser: e=>x(e)
        })
    }
    ,
    thiz.toBroadcastJid = function(e) {
        return `${e}@broadcast`
    }
    ,
    thiz.toDeviceJid = function(e, t) {
        return `${x(e)}:${t}${re(e)}`
    }
    ,
    thiz.toGroupJid = function(e) {
        if (e.endsWith(u))
            return e;
        return `${e}@g.us`
    }
    ,
    thiz.toHostedDeviceJid = function(e) {
        if (e.endsWith(I))
            return e;
        return `${e}@hosted`
    }
    ,
    thiz.toHostedLidDeviceJid = function(e) {
        if (e.endsWith(D))
            return e;
        return `${e}@hosted.lid`
    }
    ,
    thiz.toLidDeviceJid = B,
    thiz.toLidUserJid = function(e) {
        return `${e}@lid`
    }
    ,
    thiz.toMsgrDeviceJid = function(e, t) {
        return `${x(e)}:${t}@msgr`
    }
    ,
    thiz.toMsgrUserJid = k,
    thiz.toNewsletterJid = function(e) {
        if (e.endsWith(S))
            return e;
        return `${e}@newsletter`
    }
    ,
    thiz.toPhoneDeviceJid = function(e, t) {
        return `${x(e)}:${t}@s.whatsapp.net`
    }
    ,
    thiz.toPhoneUserJid = function(e) {
        return `${e}@s.whatsapp.net`
    }
    ,
    thiz.unsafeCoerceToChatJid = function(e) {
        return e
    }
    ,
    thiz.unsafeCoerceToDeviceId = ge,
    thiz.unsafeCoerceToDeviceJid = ae,
    thiz.unsafeCoerceToGroupJid = _e,
    thiz.unsafeCoerceToHostedDeviceJid = function(e) {
        return e
    }
    ,
    thiz.unsafeCoerceToHostedLidDeviceJid = function(e) {
        return e
    }
    ,
    thiz.unsafeCoerceToInteropDeviceJid = le,
    thiz.unsafeCoerceToInteropUserJid = pe,
    thiz.unsafeCoerceToLidDeviceJid = ue,
    thiz.unsafeCoerceToMsgrDeviceJid = se,
    thiz.unsafeCoerceToMsgrUserJid = fe,
    thiz.unsafeCoerceToNewsletterJid = function(e) {
        return e
    }
    ,
    thiz.unsafeCoerceToPhoneDeviceJid = oe,
    thiz.unsafeCoerceToPhoneUserJid = de,
    thiz.unsafeCoerceToUserJid = ce,
    thiz.userIdFromJid = x,
    thiz.validateBroadcastJid = J,
    thiz.validateCallJid = function(e) {
        return O.test(e) ? e : null
    }
    ,
    thiz.validateChatJid = function(e) {
        return q(e) || Q(e)
    }
    ,
    thiz.validateDeviceJid = function(e) {
        if (T.test(e) || g.test(e) || f.test(e) || C.test(e) || N.test(e))
            return e;
        if (M.test(e))
            return ie(e);
        return null
    }
    ,
    thiz.validateDomainJid = function(e) {
        return "s.whatsapp.net" === e || "g.us" === e ? e : null
    }
    ,
    thiz.validateGroupJid = Q,
    thiz.validateHostedDeviceJid = function(e) {
        return N.test(e) ? e : null
    }
    ,
    thiz.validateHostedLidDeviceJid = function(e) {
        return w.test(e) ? e : null
    }
    ,
    thiz.validateMulticastJid = function(e) {
        return z(e) || Q(e) || J(e) ? e : null
    }
    ,
    thiz.validateNewsletterJid = function(e) {
        return v.test(e) ? e : null
    }
    ,
    thiz.validateStatusJid = z,
    thiz.validateUserJid = q;
    var i = findModule(367420)
      , a = findModule(415227);
    thiz.DEFAULT_DEVICE_ID = 0;
    const o = "@me";
    thiz.AUTHOR_ME = o;
    const s = "@system";
    thiz.AUTHOR_SYSTEM = s;
    const l = "status@broadcast";
    thiz.STATUS_JID = l;
    thiz.PSA_JID = "0@s.whatsapp.net";
    const u = "@g.us"
      , c = /^([1-9][0-9]{0,19}|(?!10)[1-9][0-9]{4,19}-[1-9][0-9]{9})@g.us$/
      , d = "@msgr";
    thiz.MSGR_USER_DOMAIN = d;
    thiz.MSGR_USER_JID_SUFFIX = "msgr";
    const p = "@interop";
    thiz.INTEROP_DOMAIN = p;
    thiz.INTEROP_USER_JID_SUFFIX = "interop";
    const f = /^([1-9][0-9]{0,2}-[1-9][0-9]{0,14}(:[0])?)@interop$/
      , _ = /^([1-9][0-9]{0,2}-[1-9][0-9]{0,14}(:[0])?)@interop$/
      , g = /^([1-9][0-9]{0,19}(:[1-9][0-9]{0,2})?)@msgr$/
      , m = /^([1-9][0-9]{0,19})@msgr$/
      , h = /^([1-9][0-9]{0,19})(:0)?@msgr$/;
    thiz.WA_SERVER_JID_SUFFIX = "s.whatsapp.net";
    const y = "@s.whatsapp.net";
    thiz.WA_USER_DOMAIN = y;
    const E = "s.whatsapp.net";
    thiz.WA_USER_JID_SUFFIX = E;
    thiz.WA_LID_SUFFIX = "lid";
    const S = "@newsletter";
    thiz.WA_NEWSLETTER_JID_DOMAIN = S;
    const v = /^([1-9][0-9]{0,19})@newsletter$/
      , T = /^(0|((?!10)[1-9][0-9]{4,19}(\.[0-9]{1,2})?(:[0-9]{1,2})))@s.whatsapp.net$/
      , M = /^(0|((?!10)[1-9][0-9]{4,19})(\.[0-9]{1,2})?)@s.whatsapp.net$/
      , b = "@lid";
    thiz.LID_DOMAIN = b;
    thiz.LID_SUFFIX = "lid";
    const A = /^([1-9][0-9]{0,14})@lid$/
      , C = /^([1-9][0-9]{0,14}(:[0-9]{1,2})?)@lid$/
      , P = /^(status|location|[1-9][0-9]{0,19})@broadcast$/
      , O = /^([0-9a-fA-F]{18,32})@call$/
      , I = "@hosted";
    thiz.HOSTED_DOMAIN = I;
    const R = "hosted";
    thiz.HOSTED_SUFFIX = R;
    const N = /^(((?!10)[1-9][0-9]{4,19})):99@hosted$/
      , D = "@hosted.lid";
    thiz.HOSTED_LID_DOMAIN = D;
    thiz.HOSTED_LID_SUFFIX = "hosted.lid";
    const w = /^([1-9][0-9]{0,14}):99@hosted.lid$/;
    thiz.SURVEY_USER_JID = "16505361212@s.whatsapp.net";
    const L = /([0-9a-zA-Z-:]+)@(g\.us|call|s\.whatsapp\.net|broadcast|msgr|lid)/g;
    function k(e) {
        return `${e}@msgr`
    }
    function x(e) {
        if (e.endsWith(y))
            return e.slice(0, -y.length);
        if (e.endsWith(d))
            return e.slice(0, -d.length);
        if (e.endsWith(p))
            return e.slice(0, -p.length);
        if (e.endsWith(b))
            return e.slice(0, -b.length);
        throw (0,
        a.default)(`userIdFromJid called with non-user jid "${e}"`)
    }
    function B(e, t) {
        return `${Y(e)}:${t}@lid`
    }
    function F(e) {
        return e.split("@")[0]
    }
    function U(e) {
        const t = e.split("@")[0].split(":")
          , n = t[0]
          , r = t[1];
        return {
            userId: n,
            deviceID: parseInt(r, 10)
        }
    }
    function G(e) {
        return U(e).deviceID
    }
    function j(e) {
        if (!e.endsWith(y))
            throw (0,
            a.default)(`phoneNumberFromJid called with non-user jid "${e}"`);
        return e.slice(0, -y.length)
    }
    function K(e) {
        return e.endsWith(y) || e.endsWith(p) || e.endsWith(d) || e.endsWith(b) ? e : null
    }
    function Y(e) {
        if (!e.endsWith(b))
            throw (0,
            a.default)(`lidFromLidUserJid called with non-LidUserJid "${e}"`);
        return e.slice(0, -b.length)
    }
    function W(e) {
        const t = e.split("@");
        let n = t[0]
          , r = t[1];
        return n = n.split(":")[0],
        n = n.split(".")[0],
        r === R && (r = E),
        `${n}@${r}`
    }
    function V(e) {
        const [t,n] = e.split("@")
          , [r,i] = t.split(":")
          , [a,o] = r.split(".");
        return {
            user: a,
            device: i,
            agent: o,
            server: n
        }
    }
    function H(e) {
        switch (e.jidType) {
        case "interopUser":
        case "lidUser":
        case "msgrUser":
        case "phoneUser":
            return e.userJid;
        case "group":
            return e.groupJid;
        case "status":
            return e.statusJid;
        case "interopDevice":
        case "lidDevice":
        case "msgrDevice":
        case "phoneDevice":
            return e.deviceJid;
        case "broadcast":
            return e.broadcastJid;
        case "call":
            return e.callJid;
        case "newsletter":
            return e.newsletterJid;
        case "hosted":
            return e.hostedDeviceJid;
        case "hostedLid":
            return e.hostedLidDeviceJid;
        default:
            return (0,
            i.default)(e.jidType)
        }
    }
    function $(e) {
        if (e === l)
            return {
                jidType: "status",
                statusJid: l
            };
        if (M.test(e))
            return {
                jidType: "phoneUser",
                userJid: e
            };
        if (_.test(e))
            return {
                jidType: "interopUser",
                userJid: e
            };
        if (m.test(e))
            return {
                jidType: "msgrUser",
                userJid: e
            };
        if (h.test(e)) {
            return {
                jidType: "msgrUser",
                userJid: k(e.substr(0, e.indexOf(":")))
            }
        }
        return T.test(e) ? {
            jidType: "phoneDevice",
            deviceJid: e
        } : f.test(e) ? {
            jidType: "interopDevice",
            deviceJid: e
        } : g.test(e) ? {
            jidType: "msgrDevice",
            deviceJid: e
        } : c.test(e) ? {
            jidType: "group",
            groupJid: e.endsWith(u) ? e : `${e}@g.us`
        } : P.test(e) ? {
            jidType: "broadcast",
            broadcastJid: e
        } : O.test(e) ? {
            jidType: "call",
            callJid: e
        } : A.test(e) ? {
            jidType: "lidUser",
            userJid: e
        } : C.test(e) ? {
            jidType: "lidDevice",
            deviceJid: e
        } : v.test(e) ? {
            jidType: "newsletter",
            newsletterJid: e
        } : N.test(e) ? {
            jidType: "hosted",
            hostedDeviceJid: e
        } : {
            jidType: "unknown"
        }
    }
    function z(e) {
        return "status@broadcast" === e ? e : null
    }
    function q(e) {
        if (M.test(e) || _.test(e) || m.test(e) || A.test(e))
            return e;
        if (h.test(e)) {
            return k(e.substr(0, e.indexOf(":")))
        }
        return null
    }
    function J(e) {
        return P.test(e) ? e : null
    }
    function Q(e) {
        return c.test(e) ? e : null
    }
    function X(e) {
        if (e.endsWith(u))
            return e.slice(0, -u.length);
        throw (0,
        a.default)(`groupId called with non-group jid "${e}"`)
    }
    function Z(e) {
        const t = $(e);
        return "unknown" === t.jidType ? e : "status" === t.jidType ? t.statusJid : (t.jidType,
        H(t).replace(/^([^@]*)([^@][^@][^@][^@])@(.*)$/, "...$2@$3"))
    }
    function ee(e) {
        return e.endsWith(u) ? e : null
    }
    function te(e, t) {
        if (e.endsWith(y))
            return t.phoneUser(e);
        if (e.endsWith(d))
            return t.msgrUser(e);
        if (e.endsWith(p))
            return t.interopUser(e);
        if (e.endsWith(b))
            return t.lidUser(e);
        if (null != ee(e))
            return t.group(e);
        throw (0,
        a.default)(`Can not switch on chat jid ${e}`)
    }
    function ne(e, t) {
        if (e.endsWith(y))
            return t.user(e);
        if (null != ee(e))
            return t.group(e);
        throw (0,
        a.default)(`Can not switch on chat jid ${e}`)
    }
    function re(e) {
        if (e.endsWith(y))
            return y;
        if (e.endsWith(d))
            return d;
        if (e.endsWith(b))
            return b;
        throw (0,
        a.default)(`userDomainFromJid called with non-user jid "${e}"`)
    }
    function ie(e) {
        return `${x(e)}:0${re(e)}`
    }
    function ae(e) {
        return e
    }
    function oe(e) {
        return e
    }
    function se(e) {
        return e
    }
    function le(e) {
        return e
    }
    function ue(e) {
        return e
    }
    function ce(e) {
        return e
    }
    function de(e) {
        return e
    }
    function pe(e) {
        return e
    }
    function fe(e) {
        return e
    }
    function _e(e) {
        return e
    }
    function ge(e) {
        return e
    }
}

// WapJid stuff
WACopiedModules[718682] = (e, thiz,findModule)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.WapJid = thiz.WAP_JID_SUBTYPE = thiz.DomainType = void 0;
    var r = findModule(418987);
    const i = {
        JID: 0,
        JID_U: 1,
        JID_AD: 1,
        JID_FB: 3,
        JID_INTEROP: 4
    };
    thiz.WAP_JID_SUBTYPE = i;
    const domainType = {
        WHATSAPP: 0,
        LID: 1,
        HOSTED: 128,
        HOSTED_LID: 129
    };
    thiz.DomainType = domainType;
    class WapJid {
        constructor(e) {
            this._jid = e
        }
        static createAD(e, t, n) {
            return new WapJid({
                type: i.JID_AD,
                user: e,
                device: null == n ? 0 : n,
                agent: null == t ? 0 : t,
                domainType: domainType.WHATSAPP
            })
        }
        static createJidU(e, t, n) {
            return new WapJid({
                type: i.JID_U,
                user: e,
                device: null == n ? 0 : n,
                domainType: null == t ? domainType.WHATSAPP : t
            })
        }
        static createFbJid(e, t) {
            return new WapJid({
                type: i.JID_FB,
                user: e,
                device: null == t ? 0 : t
            })
        }
        static createInteropJid(e, t, n) {
            return new WapJid({
                type: i.JID_INTEROP,
                user: e,
                device: null == t ? 0 : t,
                integrator: n
            })
        }
        static create(e, t) {
            return new WapJid({
                type: i.JID,
                user: e,
                server: t
            })
        }
        toString() {
            if (this._jid.type === i.JID_AD || this._jid.type === i.JID_U) {
                const {user: e, device: t, domainType: n} = this._jid;
                let i = "";
                return i = n === domainType.WHATSAPP ? r.WA_USER_JID_SUFFIX : n === domainType.HOSTED ? r.HOSTED_SUFFIX : n === domainType.HOSTED_LID ? r.HOSTED_LID_SUFFIX : r.LID_SUFFIX,
                0 === t ? `${e}@${i}` : `${e}:${t}@${i}`
            }
            if (this._jid.type === i.JID_FB) {
                const {user: e, device: t} = this._jid;
                return `${e}:${t}@${r.MSGR_USER_JID_SUFFIX}`
            }
            if (this._jid.type === i.JID_INTEROP) {
                const {user: e, device: t, integrator: n} = this._jid;
                return `${n}-${e}:${t}@${r.INTEROP_USER_JID_SUFFIX}`
            }
            {
                this._jid.type;
                const {user: e, server: t} = this._jid;
                return null != e ? `${e}@${t}` : t
            }
        }
        getInnerJid() {
            return this._jid
        }
    }
    thiz.WapJid = WapJid
}

// xml stanza debugging stuff
WACopiedModules[36159] = (e, thiz, n)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.default = function(e) {
        const t = e.replace(/>\s{0,}</g, "><").replace(/</g, "~::~<").replace(/\s*xmlns:/g, "~::~xmlns:").replace(/\s*xmlns=/g, "~::~xmlns=").split("~::~")
          , n = t.length;
        let r = !1
          , i = 0
          , a = ""
          , o = 0;
        const s = ["\n"];
        for (o = 0; o < 100; o++)
            s.push(s[o] + "    ");
        const l = function(e, t) {
            const n = /^<[\w:\-.,]+/.exec(e[t - 1])
              , r = /^<\/[\w:\-.,]+/.exec(e[t]);
            return null != n && null != r && n[0] === r[0]
        };
        for (o = 0; o < n; o++)
            t[o].search(/<!/) > -1 ? (a += s[i] + t[o],
            r = !0,
            (t[o].search(/-->/) > -1 || t[o].search(/\]>/) > -1 || t[o].search(/!DOCTYPE/) > -1) && (r = !1)) : t[o].search(/-->/) > -1 || t[o].search(/\]>/) > -1 ? (a += t[o],
            r = !1) : l(t, o) ? (a += t[o],
            r || i--) : t[o].search(/<\w/) > -1 && -1 === t[o].search(/<\//) && -1 === t[o].search(/\/>/) ? a = a += r ? t[o] : s[i++] + t[o] : t[o].search(/<\w/) > -1 && t[o].search(/<\//) > -1 ? a = a += r ? t[o] : s[i] + t[o] : t[o].search(/<\//) > -1 ? a = a += r ? t[o] : s[0 === i ? i : --i] + t[o] : t[o].search(/\/>/) > -1 ? a = a += r ? t[o] : s[i] + t[o] : t[o].search(/<\?/) > -1 || t[o].search(/xmlns:/) > -1 || t[o].search(/xmlns=/) > -1 ? a += s[i] + t[o] : a += t[o];
        return "\n" === a[0] ? a.slice(1) : a
    }
}

// xml stanza debugging stuff 2
WACopiedModules[747614] = (e, thiz, findModule)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.XmlNode = void 0,
    thiz.attrsToString = a,
    thiz.uint8ArrayToDebugString = o;
    const i = {};
    function a(e) {
        const t = Object.keys(e);
        let n = "";
        for (let r = 0; r < t.length; r++) {
            const i = t[r];
            n += ` ${i}="${e[i].toString()}"`
        }
        return n
    }
    function o(e) {
        let t = "";
        return t = 0 === e.length ? "\x3c!-- empty binary --\x3e" : e.length < 50 ? (0,
        r.bytesToDebugString)(e) : `\x3c!-- ${e.length} bytes --\x3e`,
        t
    }
    thiz.XmlNode = class {
        constructor(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : i
              , n = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : null;
            this.tag = e,
            this.attrs = t,
            this.content = n
        }
        toString() {
            let e = "<" + this.tag;
            e += a(this.attrs);
            const t = this.content;
            return Array.isArray(t) ? e += `>${t.map(String).join("")}</${this.tag}>` : t instanceof Uint8Array ? e += `>${o(t)}</${this.tag}>` : e += null != t ? `>${String(t)}</${this.tag}>` : " />",
            e
        }
    }
}

// stanza token stuff
WACopiedModules[969726] = (e, thiz)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.SINGLE_BYTE_TOKEN = thiz.DICT_VERSION = thiz.DICTIONARY_3_TOKEN = thiz.DICTIONARY_2_TOKEN = thiz.DICTIONARY_1_TOKEN = thiz.DICTIONARY_0_TOKEN = thiz.DICTIONARIES = void 0;
    thiz.DICT_VERSION = 3;
    thiz.SINGLE_BYTE_TOKEN = ["xmlstreamstart", "xmlstreamend", "s.whatsapp.net", "type", "participant", "from", "receipt", "id", "notification", "disappearing_mode", "status", "jid", "broadcast", "user", "devices", "device_hash", "to", "offline", "message", "result", "class", "xmlns", "duration", "notify", "iq", "t", "ack", "g.us", "enc", "urn:xmpp:whatsapp:push", "presence", "config_value", "picture", "verified_name", "config_code", "key-index-list", "contact", "mediatype", "routing_info", "edge_routing", "get", "read", "urn:xmpp:ping", "fallback_hostname", "0", "chatstate", "business_hours_config", "unavailable", "download_buckets", "skmsg", "verified_level", "composing", "handshake", "device-list", "media", "text", "fallback_ip4", "media_conn", "device", "creation", "location", "config", "item", "fallback_ip6", "count", "w:profile:picture", "image", "business", "2", "hostname", "call-creator", "display_name", "relaylatency", "platform", "abprops", "success", "msg", "offline_preview", "prop", "key-index", "v", "day_of_week", "pkmsg", "version", "1", "ping", "w:p", "download", "video", "set", "specific_hours", "props", "primary", "unknown", "hash", "commerce_experience", "last", "subscribe", "max_buckets", "call", "profile", "member_since_text", "close_time", "call-id", "sticker", "mode", "participants", "value", "query", "profile_options", "open_time", "code", "list", "host", "ts", "contacts", "upload", "lid", "preview", "update", "usync", "w:stats", "delivery", "auth_ttl", "context", "fail", "cart_enabled", "appdata", "category", "atn", "direct_connection", "decrypt-fail", "relay_id", "mmg-fallback.whatsapp.net", "target", "available", "name", "last_id", "mmg.whatsapp.net", "categories", "401", "is_new", "index", "tctoken", "ip4", "token_id", "latency", "recipient", "edit", "ip6", "add", "thumbnail-document", "26", "paused", "true", "identity", "stream:error", "key", "sidelist", "background", "audio", "3", "thumbnail-image", "biz-cover-photo", "cat", "gcm", "thumbnail-video", "error", "auth", "deny", "serial", "in", "registration", "thumbnail-link", "remove", "00", "gif", "thumbnail-gif", "tag", "capability", "multicast", "item-not-found", "description", "business_hours", "config_expo_key", "md-app-state", "expiration", "fallback", "ttl", "300", "md-msg-hist", "device_orientation", "out", "w:m", "open_24h", "side_list", "token", "inactive", "01", "document", "te2", "played", "encrypt", "msgr", "hide", "direct_path", "12", "state", "not-authorized", "url", "terminate", "signature", "status-revoke-delay", "02", "te", "linked_accounts", "trusted_contact", "timezone", "ptt", "kyc-id", "privacy_token", "readreceipts", "appointment_only", "address", "expected_ts", "privacy", "7", "android", "interactive", "device-identity", "enabled", "attribute_padding", "1080", "03", "screen_height"];
    const n = ["read-self", "active", "fbns", "protocol", "reaction", "screen_width", "heartbeat", "deviceid", "2:47DEQpj8", "uploadfieldstat", "voip_settings", "retry", "priority", "longitude", "conflict", "false", "ig_professional", "replaced", "preaccept", "cover_photo", "uncompressed", "encopt", "ppic", "04", "passive", "status-revoke-drop", "keygen", "540", "offer", "rate", "opus", "latitude", "w:gp2", "ver", "4", "business_profile", "medium", "sender", "prev_v_id", "email", "website", "invited", "sign_credential", "05", "transport", "skey", "reason", "peer_abtest_bucket", "America/Sao_Paulo", "appid", "refresh", "100", "06", "404", "101", "104", "107", "102", "109", "103", "member_add_mode", "105", "transaction-id", "110", "106", "outgoing", "108", "111", "tokens", "followers", "ig_handle", "self_pid", "tue", "dec", "thu", "joinable", "peer_pid", "mon", "features", "wed", "peer_device_presence", "pn", "delete", "07", "fri", "audio_duration", "admin", "connected", "delta", "rcat", "disable", "collection", "08", "480", "sat", "phash", "all", "invite", "accept", "critical_unblock_low", "group_update", "signed_credential", "blinded_credential", "eph_setting", "net", "09", "background_location", "refresh_id", "Asia/Kolkata", "privacy_mode_ts", "account_sync", "voip_payload_type", "service_areas", "acs_public_key", "v_id", "0a", "fallback_class", "relay", "actual_actors", "metadata", "w:biz", "5", "connected-limit", "notice", "0b", "host_storage", "fb_page", "subject", "privatestats", "invis", "groupadd", "010", "note.m4r", "uuid", "0c", "8000", "sun", "372", "1020", "stage", "1200", "720", "canonical", "fb", "011", "video_duration", "0d", "1140", "superadmin", "012", "Opening.m4r", "keystore_attestation", "dleq_proof", "013", "timestamp", "ab_key", "w:sync:app:state", "0e", "vertical", "600", "p_v_id", "6", "likes", "014", "500", "1260", "creator", "0f", "rte", "destination", "group", "group_info", "syncd_anti_tampering_fatal_exception_enabled", "015", "dl_bw", "Asia/Jakarta", "vp8/h.264", "online", "1320", "fb:multiway", "10", "timeout", "016", "nse_retry", "urn:xmpp:whatsapp:dirty", "017", "a_v_id", "web_shops_chat_header_button_enabled", "nse_call", "inactive-upgrade", "none", "web", "groups", "2250", "mms_hot_content_timespan_in_seconds", "contact_blacklist", "nse_read", "suspended_group_deletion_notification", "binary_version", "018", "https://www.whatsapp.com/otp/copy/", "reg_push", "shops_hide_catalog_attachment_entrypoint", "server_sync", ".", "ephemeral_messages_allowed_values", "019", "mms_vcache_aggregation_enabled", "iphone", "America/Argentina/Buenos_Aires", "01a", "mms_vcard_autodownload_size_kb", "nse_ver", "shops_header_dropdown_menu_item", "dhash", "catalog_status", "communities_mvp_new_iqs_serverprop", "blocklist", "default", "11", "ephemeral_messages_enabled", "01b", "original_dimensions", "8", "mms4_media_retry_notification_encryption_enabled", "mms4_server_error_receipt_encryption_enabled", "original_image_url", "sync", "multiway", "420", "companion_enc_static", "shops_profile_drawer_entrypoint", "01c", "vcard_as_document_size_kb", "status_video_max_duration", "request_image_url", "01d", "regular_high", "s_t", "abt", "share_ext_min_preliminary_image_quality", "01e", "32", "syncd_key_rotation_enabled", "data_namespace", "md_downgrade_read_receipts2", "patch", "polltype", "ephemeral_messages_setting", "userrate", "15", "partial_pjpeg_bw_threshold", "played-self", "catalog_exists", "01f", "mute_v2"];
    thiz.DICTIONARY_0_TOKEN = n;
    const r = ["reject", "dirty", "announcement", "020", "13", "9", "status_video_max_bitrate", "fb:thrift_iq", "offline_batch", "022", "full", "ctwa_first_business_reply_logging", "h.264", "smax_id", "group_description_length", "https://www.whatsapp.com/otp/code", "status_image_max_edge", "smb_upsell_business_profile_enabled", "021", "web_upgrade_to_md_modal", "14", "023", "s_o", "smaller_video_thumbs_status_enabled", "media_max_autodownload", "960", "blocking_status", "peer_msg", "joinable_group_call_client_version", "group_call_video_maximization_enabled", "return_snapshot", "high", "America/Mexico_City", "entry_point_block_logging_enabled", "pop", "024", "1050", "16", "1380", "one_tap_calling_in_group_chat_size", "regular_low", "inline_joinable_education_enabled", "hq_image_max_edge", "locked", "America/Bogota", "smb_biztools_deeplink_enabled", "status_image_quality", "1088", "025", "payments_upi_intent_transaction_limit", "voip", "w:g2", "027", "md_pin_chat_enabled", "026", "multi_scan_pjpeg_download_enabled", "shops_product_grid", "transaction_id", "ctwa_context_enabled", "20", "fna", "hq_image_quality", "alt_jpeg_doc_detection_quality", "group_call_max_participants", "pkey", "America/Belem", "image_max_kbytes", "web_cart_v1_1_order_message_changes_enabled", "ctwa_context_enterprise_enabled", "urn:xmpp:whatsapp:account", "840", "Asia/Kuala_Lumpur", "max_participants", "video_remux_after_repair_enabled", "stella_addressbook_restriction_type", "660", "900", "780", "context_menu_ios13_enabled", "mute-state", "ref", "payments_request_messages", "029", "frskmsg", "vcard_max_size_kb", "sample_buffer_gif_player_enabled", "match_last_seen", "510", "4983", "video_max_bitrate", "028", "w:comms:chat", "17", "frequently_forwarded_max", "groups_privacy_blacklist", "Asia/Karachi", "02a", "web_download_document_thumb_mms_enabled", "02b", "hist_sync", "biz_block_reasons_version", "1024", "18", "web_is_direct_connection_for_plm_transparent", "view_once_write", "file_max_size", "paid_convo_id", "online_privacy_setting", "video_max_edge", "view_once_read", "enhanced_storage_management", "multi_scan_pjpeg_encoding_enabled", "ctwa_context_forward_enabled", "video_transcode_downgrade_enable", "template_doc_mime_types", "hq_image_bw_threshold", "30", "body", "u_aud_limit_sil_restarts_ctrl", "other", "participating", "w:biz:directory", "1110", "vp8", "4018", "meta", "doc_detection_image_max_edge", "image_quality", "1170", "02c", "smb_upsell_chat_banner_enabled", "key_expiry_time_second", "pid", "stella_interop_enabled", "19", "linked_device_max_count", "md_device_sync_enabled", "02d", "02e", "360", "enhanced_block_enabled", "ephemeral_icon_in_forwarding", "paid_convo_status", "gif_provider", "project_name", "server-error", "canonical_url_validation_enabled", "wallpapers_v2", "syncd_clear_chat_delete_chat_enabled", "medianotify", "02f", "shops_required_tos_version", "vote", "reset_skey_on_id_change", "030", "image_max_edge", "multicast_limit_global", "ul_bw", "21", "25", "5000", "poll", "570", "22", "031", "1280", "WhatsApp", "032", "bloks_shops_enabled", "50", "upload_host_switching_enabled", "web_ctwa_context_compose_enabled", "ptt_forwarded_features_enabled", "unblocked", "partial_pjpeg_enabled", "fbid:devices", "height", "ephemeral_group_query_ts", "group_join_permissions", "order", "033", "alt_jpeg_status_quality", "migrate", "popular-bank", "win_uwp_deprecation_killswitch_enabled", "web_download_status_thumb_mms_enabled", "blocking", "url_text", "035", "web_forwarding_limit_to_groups", "1600", "val", "1000", "syncd_msg_date_enabled", "bank-ref-id", "max_subject", "payments_web_enabled", "web_upload_document_thumb_mms_enabled", "size", "request", "ephemeral", "24", "receipt_agg", "ptt_remember_play_position", "sampling_weight", "enc_rekey", "mute_always", "037", "034", "23", "036", "action", "click_to_chat_qr_enabled", "width", "disabled", "038", "md_blocklist_v2", "played_self_enabled", "web_buttons_message_enabled", "flow_id", "clear", "450", "fbid:thread", "bloks_session_state", "America/Lima", "attachment_picker_refresh", "download_host_switching_enabled", "1792", "u_aud_limit_sil_restarts_test2", "custom_urls", "device_fanout", "optimistic_upload", "2000", "key_cipher_suite", "web_smb_upsell_in_biz_profile_enabled", "e", "039", "siri_post_status_shortcut", "pair-device", "lg", "lc", "stream_attribution_url", "model", "mspjpeg_phash_gen", "catalog_send_all", "new_multi_vcards_ui", "share_biz_vcard_enabled", "-", "clean", "200", "md_blocklist_v2_server", "03b", "03a", "web_md_migration_experience", "ptt_conversation_waveform", "u_aud_limit_sil_restarts_test1"];
    thiz.DICTIONARY_1_TOKEN = r;
    const i = ["64", "ptt_playback_speed_enabled", "web_product_list_message_enabled", "paid_convo_ts", "27", "manufacturer", "psp-routing", "grp_uii_cleanup", "ptt_draft_enabled", "03c", "business_initiated", "web_catalog_products_onoff", "web_upload_link_thumb_mms_enabled", "03e", "mediaretry", "35", "hfm_string_changes", "28", "America/Fortaleza", "max_keys", "md_mhfs_days", "streaming_upload_chunk_size", "5541", "040", "03d", "2675", "03f", "...", "512", "mute", "48", "041", "alt_jpeg_quality", "60", "042", "md_smb_quick_reply", "5183", "c", "1343", "40", "1230", "043", "044", "mms_cat_v1_forward_hot_override_enabled", "user_notice", "ptt_waveform_send", "047", "Asia/Calcutta", "250", "md_privacy_v2", "31", "29", "128", "md_messaging_enabled", "046", "crypto", "690", "045", "enc_iv", "75", "failure", "ptt_oot_playback", "AIzaSyDR5yfaG7OG8sMTUj8kfQEb8T9pN8BM6Lk", "w", "048", "2201", "web_large_files_ui", "Asia/Makassar", "812", "status_collapse_muted", "1334", "257", "2HP4dm", "049", "patches", "1290", "43cY6T", "America/Caracas", "web_sticker_maker", "campaign", "ptt_pausable_enabled", "33", "42", "attestation", "biz", "04b", "query_linked", "s", "125", "04a", "810", "availability", "1411", "responsiveness_v2_m1", "catalog_not_created", "34", "America/Santiago", "1465", "enc_p", "04d", "status_info", "04f", "key_version", "..", "04c", "04e", "md_group_notification", "1598", "1215", "web_cart_enabled", "37", "630", "1920", "2394", "-1", "vcard", "38", "elapsed", "36", "828", "peer", "pricing_category", "1245", "invalid", "stella_ios_enabled", "2687", "45", "1528", "39", "u_is_redial_audio_1104_ctrl", "1025", "1455", "58", "2524", "2603", "054", "bsp_system_message_enabled", "web_pip_redesign", "051", "verify_apps", "1974", "1272", "1322", "1755", "052", "70", "050", "1063", "1135", "1361", "80", "1096", "1828", "1851", "1251", "1921", "key_config_id", "1254", "1566", "1252", "2525", "critical_block", "1669", "max_available", "w:auth:backup:token", "product", "2530", "870", "1022", "participant_uuid", "web_cart_on_off", "1255", "1432", "1867", "41", "1415", "1440", "240", "1204", "1608", "1690", "1846", "1483", "1687", "1749", "69", "url_number", "053", "1325", "1040", "365", "59", "Asia/Riyadh", "1177", "test_recommended", "057", "1612", "43", "1061", "1518", "1635", "055", "1034", "1375", "750", "1430", "event_code", "1682", "503", "55", "865", "78", "1309", "1365", "44", "America/Guayaquil", "535", "LIMITED", "1377", "1613", "1420", "1599", "1822", "05a", "1681", "password", "1111", "1214", "1376", "1478", "47", "1082", "4282", "Europe/Istanbul", "1307", "46", "058", "1124", "256", "rate-overlimit", "retail", "u_a_socket_err_fix_succ_test", "1292", "1370", "1388", "520", "861", "psa", "regular", "1181", "1766", "05b", "1183", "1213", "1304", "1537"];
    thiz.DICTIONARY_2_TOKEN = i;
    const a = ["1724", "profile_picture", "1071", "1314", "1605", "407", "990", "1710", "746", "pricing_model", "056", "059", "061", "1119", "6027", "65", "877", "1607", "05d", "917", "seen", "1516", "49", "470", "973", "1037", "1350", "1394", "1480", "1796", "keys", "794", "1536", "1594", "2378", "1333", "1524", "1825", "116", "309", "52", "808", "827", "909", "495", "1660", "361", "957", "google", "1357", "1565", "1967", "996", "1775", "586", "736", "1052", "1670", "bank", "177", "1416", "2194", "2222", "1454", "1839", "1275", "53", "997", "1629", "6028", "smba", "1378", "1410", "05c", "1849", "727", "create", "1559", "536", "1106", "1310", "1944", "670", "1297", "1316", "1762", "en", "1148", "1295", "1551", "1853", "1890", "1208", "1784", "7200", "05f", "178", "1283", "1332", "381", "643", "1056", "1238", "2024", "2387", "179", "981", "1547", "1705", "05e", "290", "903", "1069", "1285", "2436", "062", "251", "560", "582", "719", "56", "1700", "2321", "325", "448", "613", "777", "791", "51", "488", "902", "Asia/Almaty", "is_hidden", "1398", "1527", "1893", "1999", "2367", "2642", "237", "busy", "065", "067", "233", "590", "993", "1511", "54", "723", "860", "363", "487", "522", "605", "995", "1321", "1691", "1865", "2447", "2462", "NON_TRANSACTIONAL", "433", "871", "432", "1004", "1207", "2032", "2050", "2379", "2446", "279", "636", "703", "904", "248", "370", "691", "700", "1068", "1655", "2334", "060", "063", "364", "533", "534", "567", "1191", "1210", "1473", "1827", "069", "701", "2531", "514", "prev_dhash", "064", "496", "790", "1046", "1139", "1505", "1521", "1108", "207", "544", "637", "final", "1173", "1293", "1694", "1939", "1951", "1993", "2353", "2515", "504", "601", "857", "modify", "spam_request", "p_121_aa_1101_test4", "866", "1427", "1502", "1638", "1744", "2153", "068", "382", "725", "1704", "1864", "1990", "2003", "Asia/Dubai", "508", "531", "1387", "1474", "1632", "2307", "2386", "819", "2014", "066", "387", "1468", "1706", "2186", "2261", "471", "728", "1147", "1372", "1961"];
    thiz.DICTIONARY_3_TOKEN = a;
    const dictionaries = [n, r, i, a];
    thiz.DICTIONARIES = dictionaries
}

// decimal stuff
WACopiedModules[229079] = (e, thiz, findModule)=>{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.decimalStringToLongInt = function(e) {
        if (!/^-?\d+$/.test(e))
            throw __LOG__(2)`"${e}" is not a valid decimal string`,
            new Error("decimalStringToLongInt is given an invalid decimal string");
        const t = "-" === e[0]
          , n = e.replace(/^-?0*/, "")
          , i = n.length;
        if (i < 16 || 16 === i && n <= "9007199254740991")
            return t ? -Number(n) : Number(n);
        if (i > 20 || 20 === i && n > "18446744073709551615" || t && (i > 19 || 19 === i && n > "9223372036854775807"))
            throw __LOG__(2)`"${e}" is over 64 bits`,
            new Error("decimalStringToHexLong is given value over 64 bits");
        let a = 0
          , o = 0;
        for (let e = 0; e < i; e++)
            a = 10 * a + Number(n[e]),
            o = 10 * o + Math.floor(a / 4294967296),
            a %= 4294967296;
        return (0,
        r.createHexLongFrom32Bits)(o, a, t)
    }
    ,
    thiz.isBiggerLongInt = function(e, t) {
        if ("number" == typeof e && "number" == typeof t)
            return e > t;
        const n = "number" == typeof e ? (0,
        r.hexLongFromNumber)(e) : e
          , i = "number" == typeof t ? (0,
        r.hexLongFromNumber)(t) : t;
        return (0,
        r.isBiggerHexLong)(n, i)
    }
    ,
    thiz.longIntToDecimalString = function(e) {
        if ("number" == typeof e)
            return e.toString(10);
        const t = (0,
        r.hexLongToHex)(e)
          , n = [0];
        let i = 0;
        for (let e = 0; e < t.length; e++) {
            i = (0,
            r.hexAt)(t, e);
            for (let e = 0; e < n.length; e++)
                n[e] = 16 * n[e] + i,
                i = n[e] / 10 | 0,
                n[e] %= 10;
            for (; i > 0; )
                n.push(i % 10),
                i = i / 10 | 0
        }
        const a = n.reverse().join("");
        return (0,
        r.hexLongIsNegative)(e) ? "-" + a : a
    }
    ,
    thiz.maybeNumberOrThrowIfTooLarge = void 0,
    thiz.numberOrThrowIfTooLarge = i;
    function i(e) {
        if ("number" != typeof e)
            throw __LOG__(2)`${e} is not a safe integer`,
            new Error("numberOrThrowIfTooLarge is given a non-safe integer");
        return e
    }
    thiz.maybeNumberOrThrowIfTooLarge = e=>null == e ? e : i(e)
}

// actual node encoder/decoder
WACopiedModules[716358] = (e, thiz, findModule)=>
{
    "use strict";
    Object.defineProperty(thiz, "__esModule", {
        value: !0
    }),
    thiz.TAGS_MAP = // WAIncognito: added by me
    {
        STREAM_END: 2,
        LIST_EMPTY: 0,
        DICTIONARY_0: 236,
        DICTIONARY_1: 237,
        DICTIONARY_2: 238,
        DICTIONARY_3: 239,
        JID_INTEROP: 245,
        JID_FB: 246,
        JID_AD: 247,
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
    thiz.BIG_ENDIAN_CONTENT = function(e) {
        let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : 4
          , n = e;
        const r = new Uint8Array(t);
        for (let e = t - 1; e >= 0; e--)
            r[e] = 255 & n,
            n >>>= 8;
        return r
    }
    ,
    thiz.BROADCAST_JID = function(e) {
        return te(e)
    }
    ,
    thiz.CALL_JID = function(e) {
        return te(e)
    }
    ,
    thiz.CUSTOM_STRING = function(e) {
        return e
    }
    ,
    thiz.DEVICE_JID = function(e) {
        return te(e)
    }
    ,
    thiz.DOMAIN_JID = ne,
    thiz.DROP_ATTR = void 0,
    thiz.GROUP_JID = function(e) {
        return te(e)
    }
    ,
    thiz.HOSTED_LID = thiz.HOSTED = thiz.G_US = void 0,
    thiz.INT = function(e) {
        return e.toString()
    }
    ,
    thiz.JID = te,
    thiz.LONG_INT = function(e) {
        return (0,
        l.longIntToDecimalString)(e)
    }
    ,
    thiz.MAYBE_CUSTOM_STRING = function(e) {
        if (null == e)
            return C;
        return e
    }
    ,
    thiz.NEWSLETTER = void 0,
    thiz.NEWSLETTER_JID = function(e) {
        return te(e)
    }
    ,
    thiz.PARTICIPANT_JID = function(e) {
        return "status" === e.type || "group" === e.type || "broadcast" === e.type ? te(e.author) : C
    }
    ,
    thiz.SMAX_ID = function(e) {
        return e.toString()
    }
    ,
    thiz.STANZA_ID = function(e) {
        return e
    }
    ,
    thiz.S_WHATSAPP_NET = thiz.STATUS_BROADCAST = void 0,
    thiz.TO_JID = function(e) {
        return te(ee(e))
    }
    ,
    thiz.TO_WAP_JID = function(e) {
        return "phoneDevice" === e.jidType || "msgrDevice" === e.jidType || "lidDevice" === e.jidType ? te(e.deviceJid) : "phoneUser" === e.jidType || "msgrUser" === e.jidType || "lidUser" === e.jidType ? te(e.userJid) : "group" === e.jidType ? te(e.groupJid) : "status" === e.jidType ? te(e.statusJid) : "call" === e.jidType ? te(e.callJid) : "interopDevice" === e.jidType ? te(e.deviceJid) : "interopUser" === e.jidType ? te(e.userJid) : "newsletter" === e.jidType ? te(e.newsletterJid) : "hosted" === e.jidType ? te(e.hostedDeviceJid) : "hostedLid" === e.jidType ? te(e.hostedLidDeviceJid) : (e.jidType,
        te(e.broadcastJid))
    }
    ,
    thiz.USER_JID = function(e) {
        return te(e)
    }
    ,
    thiz.WapNode = void 0,
    thiz.decodeAsString = function(e) {
        if (e instanceof c.WapJid)
            return e.toString();
        return e
    }
    ,
    thiz.decodeStanza = function(stanzaBuffer, decompressFunction) {
        const binaryStream = new binaryStreamModule.Binary(stanzaBuffer);
        if (2 & binaryStream.readUint8())
            return __LOG__(2)`Decoding compressed stanza`,
            decompressFunction(binaryStream.readByteArray()).then(
                (buffer=>decodeStanzaReal(new binaryStreamModule.Binary(buffer))));

        return Promise.resolve(decodeStanzaReal(binaryStream))
    }
    ,
    thiz.decodeStanzaDebug = function(e) {
        const t = new binaryStreamModule.Binary(e);
        if (2 & t.readUint8())
            throw (0,
            o.default)("Cannot pass compressed stanza to decodeStanzaDebug");
        return decodeStanzaReal(t)
    }
    ,
    thiz.enableXMLFormat = function() {
        L = !0
    }
    ,
    thiz.encodeStanza = function(nodeToEncode, isIncoming=false) {
        const nodeToEncode2 = nodeToEncode instanceof WapNode ? nodeToEncode : U(nodeToEncode)
          , binaryStream = new binaryStreamModule.Binary;
        encodeThingReal(nodeToEncode2, binaryStream, isIncoming);
        const byteArray = binaryStream.readByteArray()
          , i = new Uint8Array(1 + byteArray.length);
        return i[0] = 0,
        i.set(byteArray, 1),
        i
    }
    ,
    thiz.extractParticipantJid = function(e) {
        switch (e.type) {
        case "group":
        case "status":
        case "broadcast":
            return e.author;
        default:
            return e.type,
            null
        }
    }
    ,
    thiz.extractToJid = ee,
    thiz.generateId = function() {
        if (!b) {
            const e = new Uint16Array(2);
            self.crypto.getRandomValues(e),
            b = `${String(e[0])}.${String(e[1])}-`
        }
        return `${b}${A++}`
    }
    ,
    thiz.makeStanza = U,
    thiz.makeWapNode = B,
    thiz.wap = void 0;
    var i = findModule(367420)
      , binaryStreamModule = findModule(904704)
      , o = findModule(415227)
      , s = findModule(418987)
      , l = findModule(229079)
      , u = findModule(969726)
      , c = findModule(718682)
      , d = findModule(361592)
      , p = findModule(747614);
    const f = s.MSGR_USER_DOMAIN.replace("@", "")
      , _ = s.WA_USER_DOMAIN.replace("@", "")
      , g = s.LID_DOMAIN.replace("@", "")
      , m = s.INTEROP_DOMAIN.replace("@", "")
      , h = s.HOSTED_DOMAIN.replace("@", "")
      , y = s.HOSTED_LID_SUFFIX
      , E = [236, 237, 238, 239]
      , LIST_8 = 248
      , v = 249
      , T = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "-", ".", "�", "�", "�", "�"]
      , M = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F"];
    let b = ""
      , A = 1;
    const C = {
        sentinel: "DROP_ATTR"
    };
    thiz.DROP_ATTR = C;
    const P = c.WapJid.create(null, "g.us");
    thiz.G_US = P;
    const O = c.WapJid.create(null, s.WA_SERVER_JID_SUFFIX);
    thiz.S_WHATSAPP_NET = O;
    const I = c.WapJid.create("status", "broadcast");
    thiz.STATUS_BROADCAST = I;
    const R = c.WapJid.create(null, "newsletter");
    thiz.NEWSLETTER = R;
    const N = c.WapJid.create(null, "hosted");
    thiz.HOSTED = N;
    const D = c.WapJid.create(null, "hosted.lid");
    thiz.HOSTED_LID = D;
    const w = {};
    let L = !1;
    const k = new TextEncoder;
    class WapNode {
        constructor(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : w
              , n = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : null;
            this.tag = e,
            this.attrs = t,
            this.content = n
        }
        toString() {
            let e = "<" + this.tag;
            e += (0,
            p.attrsToString)(this.attrs);
            const t = this.content;
            return Array.isArray(t) ? e += `>${t.map(String).join("")}</${this.tag}>` : e += t ? `>${(0,
            p.uint8ArrayToDebugString)(t)}</${this.tag}>` : " />",
            L && (e = (0,
            d.default)(e)),
            e
        }
    }
    function B(e, t, n) {
        let r = null;
        if (t && null != t.children)
            throw (0,
            o.default)('Children should not be passed via props (see eslint check "react/no-children-props")');
        if (Array.isArray(n))
            r = n.filter(Boolean);
        else if ("string" == typeof n)
            r = binaryStreamModule.Binary.build(n).readByteArray();
        else if (n instanceof ArrayBuffer)
            r = new Uint8Array(n);
        else if (n instanceof Uint8Array)
            r = n;
        else {
            const e = [];
            for (let t = 2; t < arguments.length; t++) {
                const n = arguments[t];
                n && e.push(n)
            }
            r = e
        }
        Array.isArray(r) && 0 === r.length && (r = null);
        const i = {};
        if (t) {
            const n = t;
            Object.keys(n).forEach((t=>{
                if (["__self", "__source"].includes(t))
                    return;
                const r = n[t];
                if (null == r)
                    throw (0,
                    o.default)(`Attr ${t} in <${e}> is null`);
                r !== C && (i[t] = r)
            }
            ))
        }
        return new WapNode(e,i,r)
    }
    thiz.WapNode = WapNode;
    const F = B;
    function U(e) {
        let t = e.content;
        return Array.isArray(t) ? t = t.map(U) : "string" == typeof t && (t = binaryStreamModule.Binary.build(t).readByteArray()),
        new WapNode(e.tag,e.attrs || w,t)
    }
    function encodeThingReal(thingToEncode, t, isIncoming=false) {
        if (null == thingToEncode)
            t.writeUint8(0);
        else if (thingToEncode instanceof WapNode)
            encodeNode(thingToEncode, t, isIncoming);
        else if (thingToEncode instanceof c.WapJid)
            !function(e, t) {
                const n = e.getInnerJid();
                if (n.type === c.WAP_JID_SUBTYPE.JID_U) {
                    const {user: e, device: r, domainType: i} = n;
                    t.writeUint8(247),
                    t.writeUint8(i),
                    t.writeUint8(r),
                    encodeThingReal(e, t)
                } else if (n.type === c.WAP_JID_SUBTYPE.JID_FB) {
                    const {user: e, device: r} = n;
                    t.writeUint8(246),
                    encodeThingReal(e, t),
                    t.writeUint16(r),
                    encodeThingReal(f, t)
                } else if (n.type === c.WAP_JID_SUBTYPE.JID_INTEROP) {
                    const {user: e, device: r, integrator: i} = n;
                    t.writeUint8(245),
                    encodeThingReal(e, t),
                    t.writeUint16(r),
                    t.writeUint16(i)
                } else {
                    const {user: e, server: r} = n;
                    t.writeUint8(250),
                    null != e ? encodeThingReal(e, t) : t.writeUint8(0),
                    encodeThingReal(r, t)
                }
            }(thingToEncode, t);
        else if ("string" == typeof thingToEncode)
            encodeString(thingToEncode, t, isIncoming);
        else {
            if (!(thingToEncode instanceof Uint8Array))
                throw (0,
                o.default)("Invalid payload type " + typeof thingToEncode);
            !function(e, t) {
                encodeBinaryWithLength(e.length, t),
                t.writeByteArray(e)
            }(thingToEncode, t)
        }
    }
    function encodeNode(nodeToEncode, t, isIncoming=false) {
        if (void 0 === nodeToEncode.tag)
            return t.writeUint8(LIST_8),
            void t.writeUint8(0);
        let n = 1;
        nodeToEncode.attrs && (n += 2 * Object.keys(nodeToEncode.attrs).length),
        nodeToEncode.content && n++,
        n < 256 ? (t.writeUint8(LIST_8),
        t.writeUint8(n)) : n < 65536 && (t.writeUint8(v),
        t.writeUint16(n)),
        encodeThingReal(nodeToEncode.tag, t, isIncoming),
        nodeToEncode.attrs && Object.keys(nodeToEncode.attrs).forEach((attributeName=>{
            encodeString(attributeName, t, isIncoming),
            encodeThingReal(nodeToEncode.attrs[attributeName], t, isIncoming)
        }
        ));
        const nodeChildren = nodeToEncode.content;
        if (Array.isArray(nodeChildren)) {
            nodeChildren.length < 256 ? (t.writeUint8(LIST_8),
            t.writeUint8(nodeChildren.length)) : nodeChildren.length < 65536 && (t.writeUint8(v),
            t.writeUint16(nodeChildren.length));
            for (let e = 0; e < nodeChildren.length; e++)
                encodeNode(nodeChildren[e], t, isIncoming)
        } else
            nodeChildren && encodeThingReal(nodeChildren, t, isIncoming)
    }
    let tokensMap, Y;
    function getTokenToIDMap(tokensMap) {
        const t = new Map;
        for (let n = 0; n < tokensMap.length; n++)
            t.set(tokensMap[n], n);
        return t
    }
    function encodeString(stringToEncode, t, isIncoming=false) {
        if ("" === stringToEncode)
            return t.writeUint8(252),
            void t.writeUint8(0);
        null == tokensMap && (tokensMap = getTokenToIDMap(u.SINGLE_BYTE_TOKEN));
        const tokenIDtoWrite = tokensMap.get(stringToEncode);
        if (null != tokenIDtoWrite)
            return void t.writeUint8(tokenIDtoWrite + 1);
        if (null == Y) {
            Y = [];
            for (let e = 0; e < u.DICTIONARIES.length; ++e)
                Y.push(getTokenToIDMap(u.DICTIONARIES[e]))
        }
        for (let n = 0; n < Y.length; ++n) {
            const r = Y[n].get(stringToEncode);
            if (null != r)
                return t.writeUint8(E[n]),
                void t.writeUint8(r)
        }
        const lengthOfString = (0, binaryStreamModule.numUtf8Bytes)(stringToEncode);

        if (lengthOfString < 128) {
            if (!/[^0-9.-]+?/.exec(stringToEncode))
                return void nibbleEncodeOfNumber(stringToEncode, 255, t); // decimnal number
            if (!/[^0-9A-F]+?/.exec(stringToEncode))
                return void nibbleEncodeOfNumber(stringToEncode, 251, t) // hex number
        }
        encodeBinaryWithLength(lengthOfString, t),
        t.writeString(stringToEncode)
    }
    function nibbleEncodeOfNumber(stringToEncode, tokenID, n) {
        const r = stringToEncode.length % 2 == 1;
        n.writeUint8(tokenID);
        let i = Math.ceil(stringToEncode.length / 2);
        r && (i |= 128),
        n.writeUint8(i);
        let a = 0;
        for (let r = 0; r < stringToEncode.length; r++) {
            const i = stringToEncode.charCodeAt(r);
            let s = null;
            if (48 <= i && i <= 57 ? s = i - 48 : 255 === tokenID ? 45 === i ? s = 10 : 46 === i && (s = 11) : 251 === tokenID && 65 <= i && i <= 70 && (s = i - 55),
            null == s)
                throw (0,
                o.default)(`Cannot nibble encode ${i}`);
            r % 2 == 0 ? (a = s << 4,
            r === stringToEncode.length - 1 && (a |= 15,
            n.writeUint8(a))) : (a |= s,
            n.writeUint8(a))
        }
    }
    function encodeBinaryWithLength(length, t) {
        if (length < 256)
            t.writeUint8(252),
            t.writeUint8(length);
        else if (length < 1048576)
            t.writeUint8(253),
            t.writeUint8(length >>> 16 & 255),
            t.writeUint8(length >>> 8 & 255),
            t.writeUint8(255 & length);
        else {
            if (!(length < 4294967296))
                throw (0,
                o.default)(`Binary with length ${length} is too big for WAP protocol`);
            t.writeUint8(254),
            t.writeUint32(length)
        }
    }
    function decodeStringReal(e, t) {
        const n = e.readUint8();
        if (0 === n)
            return null;
        if (n === LIST_8)
            return q(e, e.readUint8());
        if (n === v)
            return q(e, e.readUint16());
        if (252 === n) {
            const n = e.readUint8();
            return decodeBinary(e, n, t)
        }
        if (253 === n) {
            const n = e.readUint8()
              , r = e.readUint8()
              , i = e.readUint8();
            return decodeBinary(e, ((15 & n) << 16) + (r << 8) + i, t)
        }
        if (254 === n) {
            const n = e.readUint32();
            return decodeBinary(e, n, t)
        }
        if (250 === n)
            return function(e) {
                const t = function(e) {
                    const t = decodeStringReal(e, !0);
                    if (null != t && "string" != typeof t)
                        throw (0,
                        o.default)("WAWap:decodeNullableString got invalid value, string expected");
                    return t
                }(e)
                  , n = Q(e);
                return c.WapJid.create(t, n)
            }(e);
        if (246 === n)
            return function(e) {
                const t = Q(e)
                  , n = e.readUint16();
                return Q(e),
                c.WapJid.createFbJid(t, n)
            }(e);
        if (245 === n)
            return function(e) {
                const t = Q(e)
                  , n = e.readUint16()
                  , r = e.readUint16();
                return Q(e),
                c.WapJid.createInteropJid(t, n, r)
            }(e);
        if (247 === n)
            return function(e) {
                let t = null;
                const n = e.readUint8();
                if (0 === n)
                    t = c.DomainType.WHATSAPP;
                else {
                    if (1 !== n)
                        throw (0,
                        o.default)(`decodeJidU - Invalid domain type encoding ${n}`);
                    t = c.DomainType.LID
                }
                const r = e.readUint8()
                  , i = Q(e);
                return c.WapJid.createJidU(i, t, r)
            }(e);
        if (255 === n) {
            const t = e.readUint8();
            return decodeNibbleEncoding(e, T, t >>> 7, 127 & t)
        }
        if (251 === n) {
            const t = e.readUint8();
            return decodeNibbleEncoding(e, M, t >>> 7, 127 & t)
        }
        if (n <= 0 || n >= 240)
            throw (0,
            o.default)("Unable to decode WAP buffer");
        if (n >= 236 && n <= 239) {
            const t = n - 236
              , r = u.DICTIONARIES[t];
            if (void 0 === r)
                throw (0,
                o.default)(`Missing WAP dictionary ${t}`);
            const i = e.readUint8()
              , a = r[i];
            if (void 0 === a)
                throw (0,
                o.default)(`Invalid value index ${i} in dict ${t}`);
            return a
        }
        const r = u.SINGLE_BYTE_TOKEN[n - 1];
        if (void 0 === r)
            throw (0,
            o.default)(`Undefined token with index ${n}`);
        return r
    }
    function q(e, t) {
        const n = [];
        for (let r = 0; r < t; r++)
            n.push(decodeStanzaReal(e));
        return n
    }
    function decodeStanzaReal(e) {
        const typeValid = e.readUint8();
        let n, r;
        if (typeValid === LIST_8)
            n = e.readUint8();
        else {
            if (typeValid !== v)
                throw (0,
                o.default)(`Failed to decode node since type byte ${String(typeValid)} is invalid`);
            n = e.readUint16()
        }
        let i = null;
        if (0 === n)
            throw (0,
            o.default)("Failed to decode node, list cannot be empty");
        const a = Q(e);
        for (n -= 1; n > 1; ) {
            r || (r = {});
            const t = Q(e)
              , i = decodeStringReal(e, !0);
            r[t] = i,
            n -= 2
        }
        return 1 === n && (i = decodeStringReal(e, !1),
        i instanceof c.WapJid && (i = String(i)),
        "string" == typeof i && (i = k.encode(i))),
        new WapNode(a,r,i)
    }
    function Q(e) {
        const t = decodeStringReal(e, !0);
        if ("string" != typeof t)
            throw (0,
            o.default)("WAWap:decodeString got invalid value, string expected");
        return t
    }
    function decodeBinary(e, t) {
        let n = arguments.length > 2 && void 0 !== arguments[2] && arguments[2];
        return n ? e.readString(t) : e.readByteArray(t)
    }
    function decodeNibbleEncoding(e, t, n, r) {
        const i = new Array(2 * r - n);
        for (let n = 0; n < i.length - 1; n += 2) {
            const r = e.readUint8();
            i[n] = t[r >>> 4],
            i[n + 1] = t[15 & r]
        }
        if (n) {
            const n = e.readUint8();
            i[i.length - 1] = t[n >>> 4]
        }
        return i.join("")
    }
    function ee(e) {
        switch (e.type) {
        case "group":
            return e.groupJid;
        case "status":
            return s.STATUS_JID;
        case "device":
            return e.deviceJid;
        case "newsletter":
            return e.newsletterJid;
        case "hosted":
            return e.hostedDeviceJid;
        case "hostedLid":
            return e.hostedLidDeviceJid;
        default:
            return e.type,
            e.broadcastJid
        }
    }
    function te(e) {
        const t = (0,
        s.validateDomainJid)(e);
        if (null != t)
            return ne(t);
        const n = e.split("@");
        let r = n[0];
        const i = n[1];
        let a = null
          , l = null;
        if (i !== _ && i !== f && i !== m && i !== g && i !== h && i !== y || -1 !== r.indexOf(":") && ([r,a] = r.split(":"),
        l = parseInt(a, 10)),
        i === m) {
            const [e,t] = r.split("-");
            return c.WapJid.createInteropJid(t, l, parseInt(e, 10))
        }
        if (i === f)
            return c.WapJid.createFbJid(r, l);
        let u = null;
        if (i === g)
            u = c.DomainType.LID;
        else {
            if (i === h)
                throw (0,
                o.default)("wid invalid env");
            if (i === y)
                throw (0,
                o.default)("lid invalid env");
            u = c.DomainType.WHATSAPP
        }
        return null != l && 0 !== l ? c.WapJid.createJidU(r, u, l) : c.WapJid.create(r, i)
    }
    function ne(e) {
        return "s.whatsapp.net" === e ? O : "g.us" === e ? P : "newsletter" === e ? R : (0,
        i.default)(e)
    }
    thiz.wap = F
}

findWACopiedMoudle = function(moduleID)
{
    if (moduleID in WACopiedModules)
    {
        var theObject = new Object();
        var foundModuleFunction = WACopiedModules[moduleID];
        foundModuleFunction(null, theObject, findWACopiedMoudle);
        return theObject;
    }
    else
    {
        debugger;
    }  
}

var nodeReaderWriter = findWACopiedMoudle(716358);
