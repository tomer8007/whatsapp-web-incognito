inject();

async function inject() 
{
	await addScript('Core/WebScoketInterception.js');
	await addScript('Core/BinaryReader.js');
	await addScript('Core/WAPacket.js');
	await addScript('Core/Crypto.js');
	await addScript('Core/NodeParser.js');
	await addScript('Core/BinaryWriter.js');
	await addScript('Core/NodePacker.js');
	await addScript('Core/MessageParser.js');
	await addScript('Core/MessageTypes.js');
	await addScript('Core/Main.js');
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

