// ===========================================================================
// core/diagnostics.js  -  ADDED BY THE PATCH
//
// Runs in the page world, last in the injection order. It records what the
// other injected scripts actually managed to publish, and reports it back to
// core/ui.js so a failure says *what* broke instead of only
// "interception is not working".
//
// You can also call it by hand from the DevTools console on web.whatsapp.com:
//
//     WAIncognitoDiagnostics()
//
// and it returns a plain object describing the state of every dependency.
// ===========================================================================

(function()
{
	function typeOf(name)
	{
		try
		{
			return typeof window[name];
		}
		catch (e)
		{
			return "unavailable";
		}
	}

	// e.g. namesOf("dcodeIO", ["Long","ByteBuffer","ProtoBuf"]) -> "Long+ByteBuffer+ProtoBuf"
	function namesOf(objectName, propertyNames)
	{
		var object;
		try
		{
			object = window[objectName];
		}
		catch (e)
		{
			return "unavailable";
		}

		if (typeof object === "undefined" || object === null)
			return "missing";

		var present = [];
		for (var i = 0; i < propertyNames.length; i++)
		{
			try
			{
				if (typeof object[propertyNames[i]] !== "undefined")
					present.push(propertyNames[i]);
			}
			catch (e) { }
		}

		return present.length ? present.join("+") : "present but empty";
	}

	// ws_hook.js replaces the WebSocket constructor with a function whose body
	// references `wsHook`, so this reliably tells whether the hook is installed.
	function isWebSocketHooked()
	{
		try
		{
			if (typeof window.wsHook === "undefined")
				return false;

			return String(window.WebSocket).indexOf("wsHook") !== -1;
		}
		catch (e)
		{
			return false;
		}
	}

	// PATCH: probing WhatsApp's internal module registry with require() is noisy.
	// On current WhatsApp Web the registry resolves nothing from this script's
	// scope, so every probe raises an ErrorUtils-caught "Requiring unknown
	// module ..." in the console - several times per page load, which buries any
	// genuine error. The version is cosmetic diagnostic detail, so it is read
	// only from globals WhatsApp already exposes, and the require() probes are
	// gated behind an explicit opt-in.
	var PROBE_WA_MODULES = false;

	function getWhatsAppVersion()
	{
		try
		{
			if (window.Debug && window.Debug.VERSION)
				return String(window.Debug.VERSION);
		}
		catch (e) { }

		try
		{
			if (window.WAWebBuildConstants && window.WAWebBuildConstants.VERSION)
				return String(window.WAWebBuildConstants.VERSION);
		}
		catch (e) { }

		if (!PROBE_WA_MODULES)
			return null;

		try
		{
			if (typeof window.require !== "function")
				return null;

			var constants = window.require("WAWebBuildConstants");
			if (constants && constants.VERSION)
				return String(constants.VERSION);
		}
		catch (e) { }

		try
		{
			if (typeof window.require !== "function")
				return null;

			var waConstants = window.require("WAWebConstants");
			if (waConstants && waConstants.WA_VERSION)
				return String(waConstants.WA_VERSION);
		}
		catch (e) { }

		return null;
	}

	function collect()
	{
		return {
			generatedAt: new Date().toISOString(),
			userAgent: navigator.userAgent,
			whatsAppVersion: getWhatsAppVersion(),

			// Globals the injected scripts are supposed to publish.
			// "dcodeIO" being "missing" is the signature of the bug this patch fixes.
			dcodeIO: namesOf("dcodeIO", ["Long", "ByteBuffer", "ProtoBuf"]),
			libsignal: namesOf("libsignal", ["HKDF", "Curve", "crypto", "SessionCipher", "SessionBuilder", "Protobuf"]),
			pako: typeOf("pako"),
			pbf: typeOf("Pbf"),

			// The WebSocket hook.
			wsHook: typeOf("wsHook"),
			webSocketHooked: isWebSocketHooked(),

			// interception.js sets this to false as soon as one packet has been
			// decrypted, parsed and re-packed. "boolean" + false == working.
			isInitializing: typeOf("isInitializing"),

			// The page's own loader globals. These are what used to make the
			// libsignal UMD wrappers skip publishing `dcodeIO`.
			pageRequire: typeOf("require"),
			pageModule: typeOf("module"),
			pageDefine: typeOf("define")
		};
	}

	function report()
	{
		var facts;
		try
		{
			facts = collect();
		}
		catch (e)
		{
			facts = { error: String(e) };
		}

		window.WAIncognitoLastDiagnostics = facts;

		try
		{
			document.dispatchEvent(new CustomEvent('onWAIncognitoDiagnostics',
				{ detail: JSON.stringify(facts) }));
		}
		catch (e) { }
	}

	// Manual entry point for the DevTools console.
	window.WAIncognitoDiagnostics = function()
	{
		report();
		return window.WAIncognitoLastDiagnostics;
	};

	report();

	// Report again a few times: `isInitializing` only flips once the first
	// packet is intercepted, and Comet's loader globals appear slightly later.
	setTimeout(report, 1000);
	setTimeout(report, 3000);
	setTimeout(report, 8000);
	setTimeout(report, 15000);
})();
