// ===========================================================================
// core/diagnostics.js  -  ADDED BY THE PATCH (2.5.8.3), EXTENDED IN 2.5.8.4
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
//
// ---------------------------------------------------------------------------
// 2.5.8.4 - RUNTIME PROBE
// ---------------------------------------------------------------------------
// On the 2.5.8.3 build every dependency loaded and the WebSocket hook was
// installed, yet interception still reported as broken. That means the failure
// is in the *runtime* path, which is designed to fail silently - every packet
// is passed through untouched, so nothing turns red:
//
//     wsHook.before/after -> MultiDevice.decryptNoisePacket
//       -> getGoodCounterIndexForDecryption -> crypto.subtle.decrypt
//
// This version instruments that path non-destructively (every wrapper calls
// through and returns the original result) and reports counters plus a verdict.
// Nothing here changes interception behaviour - it only measures it, so the
// numbers can be trusted.
// ===========================================================================

(function()
{
	// -----------------------------------------------------------------------
	// Part 1 (2.5.8.3): static dependency check
	// -----------------------------------------------------------------------

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

	// -----------------------------------------------------------------------
	// Part 2 (2.5.8.4): runtime probe - measure the interception path
	// -----------------------------------------------------------------------

	var probe =
	{
		installedAt: Date.now(),
		beforeCalls: 0,      // frames the page tried to SEND through the hook
		afterCalls: 0,       // frames the page RECEIVED through the hook
		afterNull: 0,        // hook returned null (packet left untouched)
		decryptCalls: 0,
		decryptOk: 0,        // frames actually decrypted -> interception works
		decryptNull: 0,      // returned null: no key, or classified as a handshake
		counterCalls: 0,
		counterThrows: 0,    // "COUNTER PROBLEM" - frame passed through
		importKeyHookDetectedAtInstall: "?",  // recorded BEFORE this file wraps importKey
		imports: [],         // every crypto.subtle.importKey call seen
		logs: [],            // the extension's own log lines
		errors: []
	};

	window.WAIncognitoNoiseProbe = probe;

	function safe(fn, fallback)
	{
		try { return fn(); }
		catch (e) { return fallback; }
	}

	function push(list, item)
	{
		if (list.length < 40)
			list.push(item);
	}

	function describeValue(value)
	{
		return safe(function()
		{
			if (value === null) return "null";
			if (value === undefined) return "undefined";
			if (value instanceof Uint8Array) return "Uint8Array(" + value.length + ")";
			if (value instanceof ArrayBuffer) return "ArrayBuffer(" + value.byteLength + ")";
			if (typeof CryptoKey !== "undefined" && value instanceof CryptoKey)
				return "CryptoKey(" + value.algorithm.name + ")";
			return typeof value;
		}, "?");
	}

	// The exact rule core/multi_device.js uses to recognise a Noise frame key.
	function matchesExtensionKeyRule(record)
	{
		return record.format === "raw" &&
			record.algorithm === "AES-GCM" &&
			record.keyBytes === 32 &&
			record.extractable === false &&
			record.usageCount === 1;
	}

	function countMatchingImports()
	{
		var n = 0;
		for (var i = 0; i < probe.imports.length; i++)
		{
			if (matchesExtensionKeyRule(probe.imports[i]))
				n++;
		}
		return n;
	}

	function instrument()
	{
		if (window.__waIncognitoProbeInstalled)
			return;
		window.__waIncognitoProbeInstalled = true;

		// Capture the extension's own log lines. Errors from other scripts are
		// recorded too, because an exception elsewhere in the page is often the
		// reason a packet was passed through.
		["log", "warn", "error", "info"].forEach(function(level)
		{
			var original = console[level];
			console[level] = function()
			{
				safe(function()
				{
					var text = Array.prototype.map.call(arguments, function(a)
					{
						if (typeof a === "string") return a;
						if (a instanceof Error) return a.name + ": " + a.message;
						return Object.prototype.toString.call(a);
					}).join(" ");

					if (/incognito|noise|counter|interception/i.test(text))
						push(probe.logs, "[console." + level + "] " + text.slice(0, 400));
					else if (level === "error")
						push(probe.errors, text.slice(0, 400));
				});

				return original.apply(console, arguments);
			};
		});

		// Every importKey call, with a flag saying whether the extension's own
		// capture rule would have accepted it. This is the decisive evidence:
		// if WhatsApp imports the Noise keys in a shape the rule does not match,
		// no key is ever stored and every packet is passed through silently.
		safe(function()
		{
			if (!window.crypto || !window.crypto.subtle || typeof window.crypto.subtle.importKey !== "function")
				return;

			// Recorded BEFORE wrapping: once the probe is in place, the source of
			// importKey is the probe's own wrapper, so a live check could never
			// report the extension's hook again.
			probe.importKeyHookDetectedAtInstall = safe(function()
			{
				var source = String(window.crypto.subtle.importKey);
				if (source.indexOf("Noise decryption key") !== -1) return "yes";
				if (source.indexOf("native code") !== -1) return "NO - still native";
				return "unknown (already wrapped by something else)";
			}, "?");

			var originalImport = window.crypto.subtle.importKey;
			window.crypto.subtle.importKey = function(format, keyData, algorithm, extractable, keyUsages)
			{
				safe(function()
				{
					if (probe.imports.length >= 40) return;

					var record =
					{
						format: format,
						algorithm: (typeof algorithm === "string") ? algorithm
							: ((algorithm && algorithm.name) || String(algorithm)),
						keyBytes: (keyData && keyData.length) || (keyData && keyData.byteLength) || "?",
						extractable: extractable,
						usages: Array.isArray(keyUsages) ? keyUsages.join("+") : String(keyUsages),
						usageCount: Array.isArray(keyUsages) ? keyUsages.length : -1,
						atMs: Date.now() - probe.installedAt
					};
					record.matched = matchesExtensionKeyRule(record);
					probe.imports.push(record);
				});

				return originalImport.apply(this, arguments);
			};
		});

		var hooks = safe(function() { return window.wsHook; }, null);

		if (hooks && typeof hooks.before === "function")
		{
			var originalBefore = hooks.before;
			hooks.before = function()
			{
				probe.beforeCalls++;
				var result = originalBefore.apply(this, arguments);
				if (result && typeof result.then === "function")
					result.catch(function(e) { push(probe.errors, "wsHook.before: " + e); });
				return result;
			};
		}

		if (hooks && typeof hooks.after === "function")
		{
			var originalAfter = hooks.after;
			hooks.after = function()
			{
				probe.afterCalls++;
				var result = originalAfter.apply(this, arguments);
				if (result && typeof result.then === "function")
				{
					result.then(function(v) { if (v == null) probe.afterNull++; },
						function(e) { push(probe.errors, "wsHook.after: " + e); });
				}
				return result;
			};
		}

		var multiDevice = safe(function() { return window.MultiDevice; }, null);

		if (multiDevice && typeof multiDevice.decryptNoisePacket === "function")
		{
			var originalDecrypt = multiDevice.decryptNoisePacket;
			multiDevice.decryptNoisePacket = function()
			{
				probe.decryptCalls++;
				var promise;
				try
				{
					promise = originalDecrypt.apply(this, arguments);
				}
				catch (e)
				{
					push(probe.errors, "decryptNoisePacket (sync throw): " + e);
					throw e;
				}

				if (promise && typeof promise.then === "function")
				{
					promise.then(function(v) { if (v == null) probe.decryptNull++; else probe.decryptOk++; },
						function(e) { push(probe.errors, "decryptNoisePacket: " + e); });
				}
				return promise;
			};
		}

		if (multiDevice && typeof multiDevice.getGoodCounterIndexForDecryption === "function")
		{
			var originalCounter = multiDevice.getGoodCounterIndexForDecryption;
			multiDevice.getGoodCounterIndexForDecryption = function()
			{
				probe.counterCalls++;
				var promise = originalCounter.apply(this, arguments);
				if (promise && typeof promise.then === "function")
				{
					promise.catch(function(e)
					{
						probe.counterThrows++;
						push(probe.errors, "counter: " + e);
					});
				}
				return promise;
			};
		}
	}

	// The one-line answer. core/ui.js shows the same verdict in the dialog.
	function diagnose()
	{
		var multiDevice = safe(function() { return window.MultiDevice; }, null);

		if (!multiDevice)
			return "injected-scripts-missing: MultiDevice is not in the page world at all.";

		if (probe.beforeCalls === 0 && probe.afterCalls === 0)
		{
			var commsFix = safe(function () { return window.WAIncognitoCommsModeFix; }, null);

			if (commsFix && commsFix.disabled)
				return "no-frames-reached-the-hook: the main-thread comms fallback was disabled by " +
					"window.__waIncognitoSkipCommsWorkerFix while WhatsApp still runs its socket in a Web Worker.";

			if (commsFix && !commsFix.patched)
				return "no-frames-reached-the-hook: WhatsApp is running its socket in a Web Worker and " +
					"WAIncognito could not find WAWebCommsGating to force the main-thread path " +
					"(factory hook installed: " + commsFix.factoryHookInstalled +
					", require seen: " + commsFix.requireSeen + ").";

			return "no-frames-reached-the-hook: the hook is installed but never saw a frame. Either the page " +
				"has had no traffic yet, or WhatsApp Web runs its socket in a context the main-world hook " +
				"cannot see.";
		}

		if (multiDevice.readKey == null)
		{
			if (probe.imports.length === 0)
				return "noise-key-never-imported: WhatsApp did not call crypto.subtle.importKey in the main " +
					"world during this session, so the extension could never capture a Noise key.";

			if (countMatchingImports() === 0)
				return "noise-key-import-shape-unrecognised: importKey WAS called " + probe.imports.length +
					" time(s), but none matched the extension's rule (raw + AES-GCM + 32 bytes + " +
					"extractable=false + exactly 1 usage). See the import list - this is the bug.";

			return "noise-key-missing-despite-matching-import: a matching import happened but readKey is still " +
				"null - the hook is no longer in the call path.";
		}

		if (probe.decryptOk > 0)
			return "decrypting-ok: frames are being decrypted (" + probe.decryptOk + "), interception works.";

		if (probe.counterThrows > 0)
			return "counter-problem: decryption failed " + probe.counterThrows + " time(s) because the frame " +
				"counter could not be resolved; every packet was passed through.";

		if (probe.decryptCalls > 0 && probe.decryptCalls === probe.decryptNull)
			return "packets-passed-through: decryptNoisePacket was called " + probe.decryptCalls +
				" time(s) and returned null every time.";

		return "unknown: send the full report.";
	}

	function runtimeSnapshot()
	{
		var multiDevice = safe(function() { return window.MultiDevice; }, null);

		return {
			readKey: multiDevice ? describeValue(multiDevice.readKey) : "n/a",
			writeKey: multiDevice ? describeValue(multiDevice.writeKey) : "n/a",
			readCounters: multiDevice ? safe(function() { return JSON.stringify(multiDevice.readCounters); }, "?") : "n/a",
			writeCounters: multiDevice ? safe(function() { return JSON.stringify(multiDevice.writeCounters); }, "?") : "n/a",
			readCounterIndex: multiDevice ? multiDevice.readCounterIndex : "n/a",
			writeCounterIndex: multiDevice ? multiDevice.writeCounterIndex : "n/a",
			numPacketsSinceHandshake: multiDevice ? multiDevice.numPacketsSinceHandshake : "n/a",
			incomingQueuePending: multiDevice ? safe(function() { return multiDevice.incomingQueue.queue.length; }, "?") : "n/a",
			outgoingQueuePending: multiDevice ? safe(function() { return multiDevice.outgoingQueue.queue.length; }, "?") : "n/a",
			isInitializing: safe(function() { return String(window.isInitializing); }, "?"),
			importKeyHooked: probe.importKeyHookDetectedAtInstall,
			whatsAppSocket: safe(function()
			{
				var socket = window.WhatsAppAPI && window.WhatsAppAPI.Communication &&
					window.WhatsAppAPI.Communication.socket;
				if (!socket) return "none";
				return "$7=" + socket.$7 + " $8=" + socket.$8;
			}, "?"),
			counters: {
				beforeCalls: probe.beforeCalls,
				afterCalls: probe.afterCalls,
				afterNull: probe.afterNull,
				decryptCalls: probe.decryptCalls,
				decryptOk: probe.decryptOk,
				decryptNull: probe.decryptNull,
				counterCalls: probe.counterCalls,
				counterThrows: probe.counterThrows
			},
			importsSeen: probe.imports.length,
			importsMatchingExtensionRule: countMatchingImports(),
			imports: probe.imports.slice(0, 8),
			extensionLogs: probe.logs.slice(-25),
			errors: probe.errors.slice(0, 10),
			diagnosis: diagnose()
		};
	}

	// -----------------------------------------------------------------------
	// Part 3: reporting
	// -----------------------------------------------------------------------

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
			pageDefine: typeOf("define"),

			// 2.5.8.4: what the interception path is actually doing.
			elapsedSinceProbeInstallMs: Date.now() - probe.installedAt,
			runtime: runtimeSnapshot(),

			// 2.5.8.5: did the main-thread comms fallback get forced? When WhatsApp
			// runs its socket in the backend Web Worker, the main-world hook is blind
			// until WAWebCommsGating.isCommsInWorker() is overridden.
			commsModeFix: safe(function ()
			{
				var fix = window.WAIncognitoCommsModeFix;
				if (!fix) return null;
				return {
					patched: fix.patched,
					method: fix.method,
					factoryHookInstalled: fix.factoryHookInstalled,
					requireSeen: fix.requireSeen,
					originalValueAtPatch: fix.originalValueAtPatch
				};
			}, null)
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

	// Full report, including the runtime counters, as one readable block.
	window.WAIncognitoNoiseProbeReport = function()
	{
		report();
		var facts = window.WAIncognitoLastDiagnostics;
		console.log("%cWAIncognito runtime probe report\n" + JSON.stringify(facts, null, 2),
			"font-family:monospace;font-size:12px;color:#2563eb");
		try
		{
			if (typeof copy === "function") copy(JSON.stringify(facts, null, 2));
		}
		catch (e) { }
		return facts;
	};

	instrument();
	report();

	// Report again a few times: `isInitializing` only flips once the first
	// packet is intercepted, Comet's loader globals appear slightly later, and
	// the Noise handshake needs a moment to produce the keys.
	setTimeout(report, 1000);
	setTimeout(report, 3000);
	setTimeout(report, 8000);
	setTimeout(report, 15000);
	setTimeout(report, 30000);
})();
