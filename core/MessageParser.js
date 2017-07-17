var messageParser = {};

(function() {
    function n(e) {
        return e && e.__esModule ? e : {
            "default": e
        }
    }
    function o(e, t) {
        for (var r = S(e), n = r.names, a = r.types, i = r.meta, d = void 0, s = 0; s < a.length && !d; s++) {
            var c = a[s];
            c & 256 && void 0 === t[n[s]] ? d = [n[s]] : (c & P) === 14 && t[n[s]] && (d = o(i[s], t[n[s]]),
            d && d.push(n[s]))
        }
        return d
    }
    function a(e, t, r) {
        return "number" != typeof e || e !== e || Math.floor(e) !== e ? {
            path: [],
            error: "value must be an int, given " + k(e)
        } : (e < t || e >= r) && {
            path: [],
            error: "value out of range, given " + e
        }
    }
    function i(e, t, r) {
        return e ? void 0 : {
            path: [],
            error: "value must be " + t + ", given " + k(r)
        }
    }
    function d(e, t) {
        var r = S(t)
          , n = r.names
          , o = r.types
          , a = r.meta;
        if (!(e instanceof t))
            return {
                path: [],
                error: "value not of proper class, given " + k(e)
            };
        for (var i = void 0, d = 0; d < n.length && !i; d++) {
            var s = n[d]
              , c = o[d]
              , p = e[s];
            if (c & (I | R))
                if (Array.isArray(p))
                    for (var u = a[d], f = ne[c & P], l = 0; l < p.length && !i; l++)
                        i = f(p[l], u),
                        i && i.path.push(s + "[" + l + "]");
                else
                    i = {
                        path: [s],
                        error: "repeated field must be array, given " + k(p)
                    };
            else
                void 0 !== p && (i = ne[c & P](p, a[d]),
                i && i.path.push(s))
        }
        return i
    }
    function s(e, t) {
        var r = o(e, t);
        if (r)
            throw r.reverse(),
            new TypeError("Message missing required value this." + r.join("."))
    }
    function c(e, t) {
        s(e, t);
        var r = d(t, e);
        if (r)
            throw r.path.reverse(),
            new TypeError("Invalid value at this." + r.path.join(".") + ": " + r.error)
    }
    function p(e, t) {
        e.writeVarInt(t)
    }
    function u(e, t) {
        e.writeVarInt(t >= 0 ? 2 * t : 2 * -t + 1)
    }
    function f(e, t) {
        e.writeVarInt(BinaryReader.numUtf8Bytes(t)),
        e.writeString(t)
    }
    function l(e, t) {
        e.writeVarInt(t.byteLength),
        e.writeBuffer(t)
    }
    function g(e, t) {
        for (var r = S(t.constructor), n = r.names, o = r.fields, a = r.types, i = 0; i < n.length; i++) {
            var d = n[i]
              , s = t[d];
            if (void 0 !== s) {
                oe = d;
                var c = o[i]
                  , p = a[i]
                  , u = p & P
                  , f = 8 * c | N(p);
                if (p & I)
                    s.length > 0 && (e.writeVarInt(f),
                    ie[u](e, s));
                else if (p & R)
                    for (var l = ae[u], g = 0; g < s.length; g++)
                        e.writeVarInt(f),
                        l(e, s[g]);
                else
                    e.writeVarInt(f),
                    ae[u](e, s)
            }
        }
    }
    function h(e, t) {
        e.writeWithVarIntLength(g, t)
    }
    function m(e) {
        var t = arguments.length <= 1 || void 0 === arguments[1] ? new BinaryReader : arguments[1];
        return c(e.constructor, e),
        g(t, e),
        oe = void 0,
        t
    }
    function _() {
        return void 0 !== oe ? "Last encoded value for " + oe : "No information known"
    }
    function b(e, t) {
        var r = t instanceof BinaryReader ? t : new BinaryReader(t)
          , n = v(e, r, void 0);
        return s(e, n), n
    }
    function v(e, t, r) {
        var n = S(e)
          , o = n.names
          , a = n.fields
          , i = n.types
          , d = n.meta;
        r || (r = new e);
        for (var s = 0, c = a[0]; t.size(); ) {
            var p = T(t, 0, 4294967296, "field and enc type")
              , u = 7 & p
              , f = p >>> 3;
            if (f !== c) {
                var l = s;
                do
                    ++s === a.length && (s = 0),
                    c = a[s];
                while (f !== c && s !== l)
            }
            if (f === c) {
                var g = o[s]
                  , h = i[s];
                A(u, h, g);
                var m = h & P
                  , _ = d[s];
                if (h & I)
                    for (var b = t.readVarInt(), y = t.readBinary(b), w = r[g]; y.size(); ) {
                        var E = C(g, m, y);
                        (m !== 8 || _[E]) && w.push(E)
                    }
                else if (m === 14) {
                    var N = t.readVarInt()
                      , k = t.readBinary(N);
                    if (h & R)
                        r[g].push(v(_, k, void 0));
                    else {
                        var x = r[g];
                        r[g] = v(_, k, x)
                    }
                } else {
                    var $ = C(g, m, t);
                    (m !== 8 || _[$]) && (h & R ? r[g].push($) : r[g] = $)
                }
            } else
                u === Z ? t.readVarInt() : u === ee ? t.advance(8) : u === te ? t.advance(t.readVarInt()) : u === re && t.advance(4)
        }
        return r
    }
    function y(e, t) {
        function r(t) {
            return b(e, t)
        }
        var n = arguments.length <= 2 || void 0 === arguments[2] ? {} : arguments[2];
        e._spec = t,
        e._defaults = n,
        e.parse = r,
        e.encode = m
    }
    function w(e, t, r) {
        var n = S(t)
          , o = n.names
          , a = n.types
          , i = n.defaults;
        r || (r = void 0);
        for (var d = 0; d < o.length; d++) {
            var s = o[d]
              , c = r && r[s];
            void 0 !== c ? e[s] = c : void 0 !== i[d] ? e[s] = i[d] : a[d] & R ? e[s] = [] : e[s] = void 0
        }
    }
    function E(e, t, r, n, o) {
        this.names = e,
        this.fields = t,
        this.types = r,
        this.defaults = n,
        this.meta = o
    }
    function S(e) {
        if (e._compiledSpec)
            return e._compiledSpec;
        var t = e._spec;
        if (!t)
            throw new Error("Message Class " + e + " does not have _spec");
        var r = e._defaults
        //, n = (0, $["default"])(t)
		  , n = Object.keys(t)
          , o = new Array(n.length)
          , a = []
          , i = []
          , d = new Array(n.length);
        n.sort(function(e, r) {
            return t[e][0] - t[r][0]
        });
        for (var s = 0; s < n.length; s++) {
            var c = t[n[s]];
            d[s] = r[n[s]];
            var p = c[1];
            if (a.push(c[0]),
            i.push(p),
            (p & P) === 14)
                o[s] = c[2];
            else if ((p & P) === 8) {
                var u = c[2]
                  , f = !0
                  , l = 0;
                for (var g in u)
                    f && g !== l++ && (f = !1);
                var h = void 0;
                if (f) {
                    h = [];
                    for (var m = 0; m < l; m++)
                        h.push(!0)
                } else {
                    h = {};
                    for (var _ in u)
                        h[u[_]] = !0
                }
                o[s] = h
            } else
                o[s] = null
        }
        var b = new E(n,a,i,d,o);
        return e._compiledSpec = b,
        b
    }
    function N(e) {
        if (e & I)
            return te;
        var t = e & P;
        return t <= 8 ? Z : t <= 11 ? ee : t <= 14 ? te : re
    }
    function C(e, t, r) {
        switch (t) {
        case 1:
            return T(r, -2147483648, 2147483648, e);
        case 2:
            return r.readVarInt();
        case 3:
            return T(r, 0, 4294967296, e);
        case 4:
            return T(r, 0, 1 / 0, e);
        case 5:
            var n = T(r, 0, 4294967296, e);
            return 1 & n ? -(n >>> 1) : n >>> 1;
        case 6:
            var o = r.readVarInt() / 2
              , a = Math.floor(o);
            return a !== o ? -a : a;
        case 7:
            return !!T(r, 0, 2, e);
        case 8:
            return r.readVarInt();
        case 9:
            return r.readUint64(!0);
        case 10:
            return r.readInt64(!0);
        case 11:
            return r.readFloat64(!0);
        case 12:
            return r.readString(r.readVarInt());
        case 13:
            return r.readBuffer(r.readVarInt());
        case 15:
            return r.readUint32(!0);
        case 16:
            return r.readInt32(!0);
        case 17:
            return r.readFloat32(!0)
        }
    }
    function T(e, t, r, n) {
        var o = e.readVarInt();
        if (o < t || o >= r)
            throw new Error("FormatError: " + n + " encoded with out-of-range value " + o);
        return o
    }
    function A(e, t, r) {
        if (e !== N(t))
            throw new Error("FormatError: " + r + " encoded with wire type " + e)
    }
    function k(e) {
        return "string" == typeof e ? '"' + e + '"' : Array.isArray(e) ? "[" + e.join(", ") + "]" : "" + e
    }
    var R = 64
      , I = 128
      , P = 31
      , Z = 0
      , ee = 1
      , te = 2
      , re = 5
      , ne = [void 0, function(e) {
        return a(e, -2147483648, 2147483648)
    }
    , function(e) {
        return a(e, -0x8000000000000000, 0x8000000000000000)
    }
    , function(e) {
        return a(e, 0, 4294967296)
    }
    , function(e) {
        return a(e, 0, 0x10000000000000000)
    }
    , function(e) {
        return a(e, -2147483648, 2147483648)
    }
    , function(e) {
        return a(e, -0x8000000000000000, 0x8000000000000000)
    }
    , function(e) {
        return i("boolean" == typeof e, "boolean", e)
    }
    , function(e, t) {
        return i("number" == typeof e && t[e], "in enum", e)
    }
    , function(e) {
        return a(e, 0, 0x10000000000000000)
    }
    , function(e) {
        return a(e, -0x8000000000000000, 0x8000000000000000)
    }
    , function(e) {
        return i("number" == typeof e, "number", e)
    }
    , function(e) {
        return i("string" == typeof e, "string", e)
    }
    , function(e) {
        return i(e instanceof ArrayBuffer || e instanceof Uint8Array, "ArrayBuffer or Uint8Array", name, e)
    }
    , d, function(e) {
        return a(e, 0, 4294967296)
    }
    , function(e) {
        return a(e, -2147483648, 2147483648)
    }
    , function(e) {
        return i("number" == typeof e, "number", e)
    }
    ]
      , oe = void 0
      , ae = [void 0, p, p, p, p, u, u, function(e, t) {
        e.writeVarInt(t ? 1 : 0)
    }
    , p, function(e, t) {
        e.writeUint64(t, !0)
    }
    , function(e, t) {
        e.writeInt64(t, !0)
    }
    , function(e, t) {
        e.writeFloat64(t, !0)
    }
    , f, l, h, function(e, t) {
        e.writeUint32(t, !0)
    }
    , function(e, t) {
        e.writeInt32(t, !0)
    }
    , function(e, t) {
        e.writeFloat32(t, !0)
    }
    ]
      , ie = ae.map(function(e) {
        function t(t, r) {
            for (var n = 0; n < r.length; n++)
                e(t, r[n])
        }
        if (e)
            return function(e, r) {
                e.writeWithVarIntLength(t, r)
            }
    });
	
	messageParser.initMessageValues = w;
	messageParser.createMessageType = y;
	
})();