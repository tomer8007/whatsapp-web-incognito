# Proto files
These are protobuf files that define Signal and WhatsApp messaging structures
- `WAProto.proto`: WhatsApp end-to-end encrypted payload and related structures, here taken from [Baileys](https://github.com/WhiskeySockets/Baileys/blob/master/WAProto/WAProto.proto). 
    - This is a combination of [WhatsApp's original files](https://github.com/nlitsme/whatsapp-apk-proto): 
        - `e2e.proto`
        - `protocol.proto`
        - `web.proto`
        - `wa5.proto`
        - etc.
- WhisperTextProtocol.proto: Signal structures, from 
    -   https://github.com/signalapp/libsignal-protocol-javascript/blob/master/protos/WhisperTextProtocol.proto
    -   https://github.com/adiwajshing/Baileys/blob/master/WASignalGroup/group.proto
## Compile
Using https://github.com/mapbox/pbf:
```
pbf WAProto.proto --browser > WAProto.js
pbf WhisperTextProtocol.proto --browser > WhisperTextProtocol.js
```
