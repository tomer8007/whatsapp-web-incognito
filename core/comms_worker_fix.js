// ===========================================================================
// core/comms_worker_fix.js  -  ADDED BY THE PATCH (2.5.8.5)
//
// WHY THIS FILE EXISTS
// --------------------
// WhatsApp Web 2.3000.1048653945 moved the WebSocket and the Noise handshake
// out of the main thread and into its dedicated "backend" Web Worker whenever
// the server experiment `web_comms_in_worker` (qex id 5241) is one of
// "worker" / "worker_hrp" / "worker_hrp_bundle":
//
//     __d("WAWebCommsGating",["qex"],function(...){
//         function e(){
//             var e = qex._("5241");
//             return e==="worker" || e==="worker_hrp" || e==="worker_hrp_bundle";
//         }
//         l.isCommsInWorker = e;
//     });
//
// The extension intercepts traffic by replacing `window.WebSocket` (core/
// ws_hook.js) and by wrapping `window.crypto.subtle.importKey` (core/
// multi_device.js). Both of those live in the *main world*. When comms run in
// the worker, neither is ever called there:
//
//   * the WebSocket hook is installed but sees zero frames - the worker owns
//     its own WebSocket;
//   * crypto.subtle.importKey sees zero calls, so no Noise key is ever
//     captured and every packet would be impossible to decrypt anyway.
//
// The 2.5.8.4 runtime probe reports exactly this combination:
//
//     WebSocket hooked: true
//     frames sent/received through hook: 0
//     importKey calls: 0 (matching the key rule: 0)
//     Noise read key: null
//     Diagnosis: no-frames-reached-the-hook
//
// THE FIX
// -------
// WhatsApp still ships the main-thread comms path in the same bundle - it is
// what browsers without module-worker support use (`WAWebOpenSocket` ->
// `new WebSocket(...)`, and the `WAComms` default factory). So instead of
// trying to reach into the worker (impossible for a content script: a web page
// cannot inject code into a Service Worker, and a dedicated worker's script is
// not reachable through the page's CSP), we make WhatsApp choose the path the
// extension already intercepts:
//
//     WAWebCommsGating.isCommsInWorker = function () { return false; };
//
// Nothing else is touched. The backend worker still exists and still handles
// storage; it just no longer owns the socket.
//
// HOW IT IS APPLIED (earliest first)
// ----------------------------------
//   1. `window.__onAfterModuleFactory` is the Comet module system's own
//      post-factory callback. We chain it and rewrite the `WAWebCommsGating`
//      export the moment its factory runs.
//   2. As a fallback, we poll for `window.require` and rewrite the export
//      directly. This covers the case where `WAWebCommsGating` was already
//      required before the callback existed.
//
// Both paths are idempotent, are scoped to a single function on a single
// module, and retry only for ~60 seconds after page start.
//
// Set `window.__waIncognitoSkipCommsWorkerFix = true` before this script runs
// to disable the patch (useful when bisecting a WhatsApp behaviour change).
// ===========================================================================

(function ()
{
	"use strict";

	if (window.__waIncognitoCommsModeFixInstalled)
		return;

	window.__waIncognitoCommsModeFixInstalled = true;

	var report = {
		installedAt: Date.now(),
		patched: false,
		method: null,
		patchedAt: null,
		originalValueAtPatch: null,
		factoryHookInstalled: false,
		requireSeen: false,
		disabled: !!window.__waIncognitoSkipCommsWorkerFix
	};
	window.WAIncognitoCommsModeFix = report;

	if (report.disabled)
	{
		console.log("WAIncognito: comms-worker fix disabled by window.__waIncognitoSkipCommsWorkerFix.");
		return;
	}

	// The function's own source is the only stable identifier: the module is
	// anonymous in the bundle, so we match the experiment strings it contains.
	function isCommsGatingExports(exports)
	{
		try
		{
			return !!exports &&
				typeof exports.isCommsInWorker === "function" &&
				String(exports.isCommsInWorker).indexOf("worker_hrp") !== -1;
		}
		catch (e)
		{
			return false;
		}
	}

	function markPatched(method, exports)
	{
		try { report.originalValueAtPatch = !!exports.isCommsInWorker(); }
		catch (e) { report.originalValueAtPatch = "unknown"; }

		exports.isCommsInWorker = function () { return false; };

		report.patched = true;
		report.method = method;
		report.patchedAt = Date.now();

		console.log("WAIncognito: comms are forced to the main thread " +
			"(WAWebCommsGating.isCommsInWorker -> false, method: " + method + ").");
	}

	function tryPatchExports(exports, method)
	{
		if (report.patched) return true;
		if (!isCommsGatingExports(exports)) return false;

		markPatched(method, exports);
		return true;
	}

	function installFactoryHook()
	{
		try
		{
			// Before the Comet runtime runs, this global is undefined and the
			// runtime will overwrite anything we set. Wait until it exists.
			if (typeof window.__onAfterModuleFactory === "undefined")
				return false;

			if (window.__waIncognitoFactoryHookInstalled)
				return true;

			var previous = window.__onAfterModuleFactory;
			window.__onAfterModuleFactory = function (module)
			{
				try
				{
					if (typeof previous === "function")
						previous(module);
				}
				catch (e) { }

				try
				{
					if (module)
						tryPatchExports(module.exports, "module-factory-hook");
				}
				catch (e) { }
			};

			window.__waIncognitoFactoryHookInstalled = true;
			report.factoryHookInstalled = true;
			return true;
		}
		catch (e)
		{
			return false;
		}
	}

	function tryDirectRequire()
	{
		if (report.patched) return true;

		try
		{
			if (typeof window.require !== "function")
				return false;

			report.requireSeen = true;

			// Requiring a registered module is cheap and returns the cached
			// exports. Before the module is registered, require() throws and we
			// simply retry on the next tick.
			var exports = window.require("WAWebCommsGating");
			return tryPatchExports(exports, "direct-require");
		}
		catch (e)
		{
			return false;
		}
	}

	// Manual entry point for the DevTools console on web.whatsapp.com:
	//
	//     WAIncognitoForceMainThreadComms()
	//
	window.WAIncognitoForceMainThreadComms = function ()
	{
		installFactoryHook();
		tryDirectRequire();
		return report;
	};

	installFactoryHook();

	var attempts = 0;
	var MAX_ATTEMPTS = 1200; // 1200 * 50ms = 60s
	var timer = setInterval(function ()
	{
		attempts++;

		installFactoryHook();
		tryDirectRequire();

		if (report.patched || attempts >= MAX_ATTEMPTS)
			clearInterval(timer);
	}, 50);
})();
