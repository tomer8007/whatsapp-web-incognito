function WAPacket() {
        var e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : {}
          , t = e.data;
        this.data = t,
        this.isToPhone = t instanceof ArrayBuffer,
        this.tag = e.tag,
        this.clientCacheable = !!e.clientCacheable,
        this.retryOn5xx = !!e.retryOn5xx,
        this.onSend = e.onSend,
        this.onDrop = e.onDrop,
        this.binaryOpts = e.binaryOpts,
        this.on5xx = e.on5xx,
        this.resendGuard = e.resendGuard,
        this.state = c.NEW,
        this.age = 0,
        this.resends = 0,
        this.resendTimer = 0,
        this.ephemeral = !!e.ephemeral,
        this.ignore = !!e.ignore
    }
      var c = {
        NEW: "REQUEST_STATE_NEW",
        SENT: "REQUEST_STATE_SENT",
        WEBDACKED: "REQUEST_STATE_WEBDACKED",
        WILL_RETRY: "REQUEST_STATE_WILL_RETRY"
    };
    WAPacket.prototype = {
        getTag: function() {
            return this.tag || (this.onSend ? this.onSend.tag : void 0)
        },
        toString: function() {
            var e = this.data;
            return this.binaryOpts ? this.binaryOpts.debugString : Array.isArray(e) ? 0 === e.length ? "[]" : 1 === e.length ? "[" + e[0] + "]" : "query" === e[0] || "action" === e[0] ? "[" + e[0] + ", " + e[1] + (e.length > 2 ? ", ..." : "") + "]" : void 0 : Object.isObject(e) ? "{...}" : "" + e
        },
        serialize: function() {
            var e = this.tag;
            if (this.binaryOpts) {
                var t = this.binaryOpts
                  , n = t.metric ? t.metric : 0
                  , r = (this.ignore ? 0 : 1) << 7 | (!this.ignore && t.ackRequest ? 1 : 0) << 6 | (t.available === !0 ? 1 : 0) << 5 | (t.available === !1 ? 1 : 0) << 4 | (t.expires ? 1 : 0) << 3 | (t.skipOffline ? 1 : 0) << 2;
                return BinaryReader.build(e, ",", n, r, this.data).readBuffer()
            }
            var a = this.data;
            return e + ",," + a;
        },
    }