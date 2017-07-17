function BinaryWriter() {
        function e(e) {
            t++,
            n.push(e)
        }
        var t = 0
          , n = [];
        this.pushInt16 = function(t) {
            if ("number" != typeof t)
                throw new Error("invalid int16");
            e((65280 & t) >> 8),
            e((255 & t) >> 0)
        }
        ,
        this.pushInt20 = function(t) {
            if ("number" != typeof t)
                throw new Error("invalid int20");
            e((983040 & t) >> 16),
            e((65280 & t) >> 8),
            e((255 & t) >> 0)
        }
        ,
        this.pushInt32 = function(t) {
            if ("number" != typeof t)
                throw new Error("invalid int32");
            e((4278190080 & t) >> 24),
            e((16711680 & t) >> 16),
            e((65280 & t) >> 8),
            e((255 & t) >> 0)
        }
        ,
        this.pushByte = function(t) {
            if ("number" != typeof t || t < 0 || t > 255)
                throw new Error("invalid byte value: " + t);
            e(t)
        }
        ,
        this.pushBytes = function(e) {
            if (!(e instanceof ArrayBuffer))
                throw new Error("invalid byte buffer");
            t += e.byteLength,
            n.push(e)
        }
        ,
        this.pushUint8Array = function(e) {
            if ("[object Uint8Array]" !== Object.prototype.toString.call(e))
                throw new Error("invalid Uint8Array");
            t += e.length;
            for (var r = 0; r < e.length; r++)
                n.push(e[r])
        }
        ,
        this.pushString = function(e) {
            if ("string" != typeof e)
                throw new Error("invalid string");
            t += BinaryReader.numUtf8Bytes(e),
            n.push(e)
        }
        ,
        this.toBuffer = function() {
            return BinaryReader.build.apply(null, n).readBuffer()
        }
    }