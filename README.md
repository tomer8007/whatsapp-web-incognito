# WhatsApp Web Incognito
This is the source code of a chrome extension that disables read receipts and presence updates on WhatsApp Web.
You can find the original extension in [Chrome Web Store](https://chrome.google.com/webstore/detail/whatsapp-web-incognito/dmojkdggbdjlhgmakakajjbbdibkjkgj).
## How it works
This extension works by intercepting the WebSocket frames between chrome and WhatsApp's servers using a modified `WebSocket` constructor (see [wsHook](https://github.com/skepticfx/wshook)). 

Those frames are then decrypted if needed using the local encryption keys (stored in `localStorage`), and decoded from a binary form using a javascript code from WhatsApp's original implementaiton. 

The resulting "nodes" are then simply checked to see if WhatsApp tries to send out a `read`  or `presence` action, and if so, the extension blocks it and fakes a failure response from the server.
## Organization
The main code of the extension is located in `Core/Main.js` and `UI.js`. Other files inside the `Crypto` folder deal with the infrastructure that makes the interception and the decoding works. There is also an additional code for parsing messeges (such as `MessageTypes.js`) that is not used in the extension.
`background.js` mainly keeps track of the saved prefrences using `localStorage`.
