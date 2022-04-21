# Proto files
These are protobuf files that define Signal and WhatsApp messaging structures
- WAProto.proto: WhatsApp end-to-end encrypted payload, from https://github.com/adiwajshing/Baileys/blob/master/WAProto/WAProto.proto
- WhisperTextProtocol.proto: Signal structures, from https://github.com/signalapp/libsignal-protocol-javascript/blob/master/protos/WhisperTextProtocol.proto and https://github.com/adiwajshing/Baileys/blob/master/WASignalGroup/group.proto
## Compile
Using https://github.com/mapbox/pbf:
```
pbf WAProto.proto --browser > WAProto.js
pbf WhisperTextProtocol.proto --browser > WhisperTextProtocol.js
```