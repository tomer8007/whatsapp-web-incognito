function WAPacket(e) 
{
      var params = arguments.length > 0 && e != undefined ? e : {};
      this.isMultiDevice = params.isMultiDevice;
      this.data = params.data,
      this.isToPhone = this.data instanceof ArrayBuffer,
      this.tag = params.tag,
      this.clientCacheable = !!params.clientCacheable,
      this.retryOn5xx = !!params.retryOn5xx,
      this.onSend = params.onSend,
      this.onDrop = params.onDrop,
      this.binaryOpts = params.binaryOpts,
      this.on5xx = params.on5xx,
      this.resendGuard = params.resendGuard,
      this.state = c.NEW,
      this.age = 0,
      this.resends = 0,
      this.resendTimer = 0,
      this.ephemeral = !!params.ephemeral,
      this.ignore = !!params.ignore
};
var c = 
{
      NEW: "REQUEST_STATE_NEW",
      SENT: "REQUEST_STATE_SENT",
      WEBDACKED: "REQUEST_STATE_WEBDACKED",
      WILL_RETRY: "REQUEST_STATE_WILL_RETRY"
};

WAPacket.prototype = 
{
    getTag: function() {
        return this.tag || (this.onSend ? this.onSend.tag : void 0)
    },
    toString: function() {
        var e = this.data;
        return this.binaryOpts ? this.binaryOpts.debugString : Array.isArray(e) ? 0 === e.length ? "[]" : 1 === e.length ? "[" + e[0] + "]" : "query" === e[0] || "action" === e[0] ? "[" + e[0] + ", " + e[1] + (e.length > 2 ? ", ..." : "") + "]" : void 0 : Object.isObject(e) ? "{...}" : "" + e
    },
    serialize: function() {
      if (!this.isMultiDevice)
      {
          var e = this.tag;
          if (this.binaryOpts) {
              var t = this.binaryOpts
                , n = t.metric ? t.metric : 0
                , r = (this.ignore ? 0 : 1) << 7 | (!this.ignore && t.ackRequest ? 1 : 0) << 6 | (t.available === !0 ? 1 : 0) << 5 | (t.available === !1 ? 1 : 0) << 4 | (t.expires ? 1 : 0) << 3 | (t.skipOffline ? 1 : 0) << 2;
              return BinaryReader.build(e, ",", n, r, this.data).readBuffer();
          }
          var a = this.data;
          return e + ",," + a;
      }
      else
      {
          // multi device
          var binaryReader = new BinaryReader();
          
          var size = this.data.byteLength;
          binaryReader.writeUint8(size >> 16);
          binaryReader.writeUint16(65535 & size);
          binaryReader.write(this.data);

          binaryReader._readIndex = 0;
          return binaryReader.readBuffer();
      }
    },
    serializeWithoutBinaryOpts: function() {
      if (this.isMultiDevice) return this.serialize();

      var e = this.tag;
      if (this.binaryOpts) {
          var t = this.binaryOpts
            , n = t.metric ? t.metric : 0
            , r = (this.ignore ? 0 : 1) << 7 | (!this.ignore && t.ackRequest ? 1 : 0) << 6 | (t.available === !0 ? 1 : 0) << 5 | (t.available === !1 ? 1 : 0) << 4 | (t.expires ? 1 : 0) << 3 | (t.skipOffline ? 1 : 0) << 2;
            
            return BinaryReader.build(e, ",", this.data).readBuffer();
      }
      var a = this.data;
      return e + ",," + a;
  },
}