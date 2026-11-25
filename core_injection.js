// Ensure client-side checks see a desktop platform on mobile/Waydroid/GeckoView
(function () {
	'use strict';

	var manifest = typeof WAIBundleManifest !== 'undefined' ? WAIBundleManifest : {};
	// Literal fallback only: the canonical value lives in shared/bundle_manifest.js.
	// A-ua in scripts/verify-bundles.mjs syncs rules.json, bundle_manifest.js and
	// MainActivity.kt — this fallback's drift is why it carries a comment here.
	var DESKTOP_UA = manifest.DESKTOP_UA ||
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

	try {
		var isMobileDevice = (
			(navigator.userAgent && (/Android|Mobile|Phone|Tablet/i).test(navigator.userAgent)) ||
			(navigator.platform && (/Android|arm|Linux\s+i686/i).test(navigator.platform)) ||
			(navigator.userAgentData && navigator.userAgentData.mobile) ||
			(typeof window !== 'undefined' && window.screen && (window.screen.width < 800 || window.screen.height < 800))
		);

		if (isMobileDevice) {
			Object.defineProperty(navigator, 'userAgent', { get: function () { return DESKTOP_UA; }, configurable: true });
			Object.defineProperty(navigator, 'appVersion', { get: function () { return DESKTOP_UA.replace(/^Mozilla\//, ''); }, configurable: true });
			Object.defineProperty(navigator, 'platform', { get: function () { return 'Linux x86_64'; }, configurable: true });
			if (navigator.userAgentData) {
				Object.defineProperty(navigator, 'userAgentData', {
					get: function () {
						return {
							mobile: false,
							brands: [
								{ brand: 'Chromium', version: '144' },
								{ brand: 'Google Chrome', version: '144' },
								{ brand: 'Not-A.Brand', version: '24' }
							],
							platform: 'Linux',
							getHighEntropyValues: async function () {
								return {
									architecture: 'x86',
									bitness: '64',
									mobile: false,
									model: '',
									platform: 'Linux',
									platformVersion: '6.5.0',
									uaFullVersion: '144.0.0.0'
								};
							}
						};
					},
					configurable: true
				});
			}
			if (typeof window !== 'undefined' && window.screen && window.screen.width < 800) {
				Object.defineProperty(screen, 'width', { get: function () { return 1024; }, configurable: true });
				Object.defineProperty(screen, 'availWidth', { get: function () { return 1024; }, configurable: true });
			}
		}
	} catch (e) {}

	var MAIN_CRITICAL = manifest.MAIN_CRITICAL || ['core/ws_hook.js', 'core/comms_worker_fix.js'];
	var MAIN_REST = manifest.MAIN_REST || [];
	var DEFERRED = manifest.DEFERRED || [];

	function waitForMountTarget(cb) {
		var target = document.head || document.documentElement;
		if (target) {
			cb(target);
			return;
		}
		var tries = 0;
		(function poll() {
			var el = document.head || document.documentElement;
			if (el) {
				cb(el);
				return;
			}
			if (++tries < 200) {
				setTimeout(poll, 5);
			}
		})();
	}

	function injectScript(scriptName) {
		return new Promise(function (resolve) {
			waitForMountTarget(function (target) {
				var s = document.createElement('script');
				s.src = chrome.runtime.getURL(scriptName);
				s.async = false; // execute in insertion order
				s.onload = function () {
					if (this.parentNode) this.parentNode.removeChild(this);
					resolve(true);
				};
				s.onerror = function () {
					if (this.parentNode) this.parentNode.removeChild(this);
					resolve(false);
				};
				target.appendChild(s);
			});
		});
	}

	async function injectScripts() {
		var i;
		// Critical hooks (ws_hook + comms_worker_fix) must execute before any WA socket/worker starts (C1).
		for (i = 0; i < MAIN_CRITICAL.length; i++) {
			await injectScript(MAIN_CRITICAL[i]);
		}

		// Queue main scripts with async=false so browsers preserve dependency order while fetching in parallel.
		if (MAIN_REST.length) {
			await Promise.all(MAIN_REST.map(injectScript));
		}

		if (DEFERRED.length) {
			setTimeout(function () {
				for (var j = 0; j < DEFERRED.length; j++) {
					injectScript(DEFERRED[j]);
				}
			}, 10);
		}
	}

	injectScripts();
})();
