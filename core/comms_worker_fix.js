(function () {
    "use strict";

    if (window.__waIncognitoCommsModeFixInstalled) return;
    window.__waIncognitoCommsModeFixInstalled = true;

    var report = {
        installedAt: Date.now(),
        patched: false,
        method: null,
        patchedAt: null,
        originalValueAtPatch: null
    };
    window.WAIncognitoCommsModeFix = report;

    function patchTarget(target, method) {
        if (report.patched || !target || typeof target.isCommsInWorker !== "function") return false;
        try { report.originalValueAtPatch = !!target.isCommsInWorker(); } catch (e) { report.originalValueAtPatch = "unknown"; }
        try {
            Object.defineProperty(target, "isCommsInWorker", {
                value: function () { return false; },
                configurable: true,
                writable: true
            });
        } catch (e) {
            target.isCommsInWorker = function () { return false; };
        }
        report.patched = true;
        report.method = method;
        report.patchedAt = Date.now();
        
        return true;
    }

    function wrapDefine(fn) {
        if (typeof fn !== "function" || fn.__waIncognitoWrapped) return fn;
        var wrapped = function (id, deps, factory) {
            if (id === "WAWebCommsGating" && typeof factory === "function") {
                var origFactory = factory;
                arguments[2] = function () {
                    var res = origFactory.apply(this, arguments);
                    for (var i = 0; i < arguments.length; i++) {
                        var arg = arguments[i];
                        if (arg && typeof arg === "object") {
                            if (patchTarget(arg, "__d-hook")) break;
                            if (arg.exports && patchTarget(arg.exports, "__d-hook-exports")) break;
                        }
                    }
                    return res;
                };
            }
            return fn.apply(this, arguments);
        };
        wrapped.__waIncognitoWrapped = true;
        return wrapped;
    }

    var origDefine;
    if (window.__d) {
        window.__d = wrapDefine(window.__d);
    } else {
        Object.defineProperty(window, "__d", {
            configurable: true,
            get: function () { return origDefine; },
            set: function (val) { origDefine = wrapDefine(val); }
        });
    }
})();