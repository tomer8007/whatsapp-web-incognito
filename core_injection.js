inject();

async function inject() 
{
	await addScript('core/WebScoketInterception.js');
	await addScript('core/BinaryReader.js');
	await addScript('core/WAPacket.js');
	await addScript('core/Crypto.js');
	await addScript('core/NodeParser.js');
	await addScript('core/BinaryWriter.js');
	await addScript('core/NodePacker.js');
	await addScript('core/MessageParser.js');
	await addScript('core/MessageTypes.js');
	await addScript('core/Main.js');
}

function addScript(scriptName) {
	return new Promise(function(resolve, reject) {
		var s = document.createElement('script');
		s.src = chrome.extension.getURL(scriptName);
		s.onload = function() {
			this.parentNode.removeChild(this);
			resolve(true);
		};
		(document.head||document.documentElement).appendChild(s);
	});
}