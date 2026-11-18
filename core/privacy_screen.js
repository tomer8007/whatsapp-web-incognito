//
// Privacy screen (isolated world): blur classes on <body> (the CSS is in styles.css) and a passcode lock overlay.
// This is a privacy screen, not data security: use the Vault to protect data.
//

var PRIVACY_LOCK_DISCLAIMER = "Kunci ini layar privasi, bukan pengaman data. Untuk melindungi data, gunakan Vault.";

// What each blur option targets. `selector` is the canonical one: it must appear in styles.css (a test checks it)
// and it is registered in the diagnostics.
var PRIVACY_BLUR_TARGETS = {
    blurChatList: { cls: "incognito-blur-chatlist", selector: '#pane-side [role="listitem"]' },
    blurMessages: { cls: "incognito-blur-messages", selector: '[data-id] .selectable-text' },
    blurMedia:    { cls: "incognito-blur-media",    selector: '[data-id] img[src^="blob:"]' },
    blurAvatars:  { cls: "incognito-blur-avatars",  selector: 'img[src*="pps.whatsapp.net"]' },
};

function blurClassesFor(options)
{
    var classes = [];
    Object.keys(PRIVACY_BLUR_TARGETS).forEach(function(key)
    {
        if (options && options[key]) classes.push(PRIVACY_BLUR_TARGETS[key].cls);
    });
    return classes;
}

// PBKDF2-SHA256, 200000 iterations -> base64
async function hashPasscode(code, salt)
{
    var encoder = new TextEncoder();
    var base = await crypto.subtle.importKey("raw", encoder.encode(String(code)), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(String(salt)), iterations: 200000, hash: "SHA-256" }, base, 256);
    var binary = "";
    new Uint8Array(bits).forEach(function(byte) { binary += String.fromCharCode(byte); });
    return btoa(binary);
}

// state: "locked" | "unlocked". Starts locked (unless deps.startUnlocked). verify(code) -> Promise<bool>.
// deps.idleMs is read on every tick, so it may be changed later.
function createLock(deps)
{
    var state = deps.startUnlocked ? "unlocked" : "locked";
    var lastActivity = deps.now();

    return {
        state: function() { return state; },

        unlock: async function(code)
        {
            var ok = false;
            try { ok = !!(await deps.verify(code)); }
            catch (e) { ok = false; }
            if (ok)
            {
                state = "unlocked";
                lastActivity = deps.now();
            }
            return ok;
        },

        // user input: only matters while unlocked
        activity: function()
        {
            if (state == "unlocked") lastActivity = deps.now();
        },

        tick: function()
        {
            if (state == "unlocked" && deps.now() - lastActivity >= deps.idleMs) state = "locked";
            return state;
        },

        lockNow: function() { state = "locked"; },
    };
}

//
// DOM wiring (only in the real extension, not in tests)
//
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id)
{
    (function()
    {
        var options = defaultOptions();
        var passcode = null; // {salt, hash}
        var lock = null;
        var warnedNoPasscode = false;

        function applyBlur()
        {
            if (!document.body) return;
            Object.keys(PRIVACY_BLUR_TARGETS).forEach(function(key)
            {
                document.body.classList.toggle(PRIVACY_BLUR_TARGETS[key].cls, !!options[key]);
            });
        }

        function lockIsActive()
        {
            if (!options.lockEnabled) return false;
            if (!passcode)
            {
                if (!warnedNoPasscode) { warnedNoPasscode = true; console.warn("WAIncognito: lock is on but no passcode is set (menu: Kunci layar…)"); }
                return false;
            }
            return true;
        }

        function overlay()
        {
            var element = document.getElementById("incognito-lock");
            if (element) return element;

            element = document.createElement("div");
            element.id = "incognito-lock";
            var box = document.createElement("div");
            box.className = "incognito-lock-box";
            var title = document.createElement("div");
            title.className = "incognito-lock-title";
            title.textContent = "WhatsApp terkunci";
            var input = document.createElement("input");
            input.type = "password";
            input.placeholder = "Passcode";
            input.autocomplete = "off";
            var error = document.createElement("div");
            error.className = "incognito-lock-error";
            var note = document.createElement("div");
            note.className = "incognito-lock-note";
            note.textContent = PRIVACY_LOCK_DISCLAIMER;
            box.appendChild(title);
            box.appendChild(input);
            box.appendChild(error);
            box.appendChild(note);
            element.appendChild(box);

            input.addEventListener("keydown", async function(e)
            {
                if (e.key != "Enter") return;
                var ok = await lock.unlock(input.value);
                input.value = "";
                if (ok) render();
                else error.textContent = "Passcode salah";
            });
            document.body.appendChild(element);
            return element;
        }

        function render()
        {
            var existing = document.getElementById("incognito-lock");
            if (!lockIsActive() || lock.state() == "unlocked")
            {
                if (existing) existing.remove();
                return;
            }
            var element = overlay();
            var input = element.querySelector("input");
            if (input) input.focus();
        }

        var lockDeps = {
            now: function() { return Date.now(); },
            idleMs: options.lockIdleMinutes * 60 * 1000,
            verify: async function(code) { return !!passcode && (await hashPasscode(code, passcode.salt)) === passcode.hash; },
        };

        // a lock created at page load starts locked; one created because the user just turned the option on starts unlocked
        function ensureLock(startUnlocked)
        {
            if (!lock)
            {
                lockDeps.startUnlocked = !!startUnlocked;
                lock = createLock(lockDeps);
            }
            return lock;
        }

        var optionsReceived = false;

        document.addEventListener("onOptionsUpdate", function(e)
        {
            var update = JSON.parse(e.detail);
            var wasEnabled = options.lockEnabled;
            Object.assign(options, update);
            lockDeps.idleMs = options.lockIdleMinutes * 60 * 1000;
            applyBlur();

            var firstFullUpdate = !optionsReceived && "lockEnabled" in update;
            if (firstFullUpdate) optionsReceived = true;
            // turning the lock on from the menu must not lock the user out at once
            var turnedOnNow = optionsReceived && !firstFullUpdate && !wasEnabled && options.lockEnabled;
            if (turnedOnNow) lock = null;
            ensureLock(turnedOnNow);
            render();
        });

        chrome.storage.local.get(["lockPasscode"]).then(function(stored)
        {
            passcode = stored.lockPasscode || null;
            ensureLock(false);
            render();
        });
        chrome.storage.onChanged.addListener(function(changes)
        {
            if (changes.lockPasscode) { passcode = changes.lockPasscode.newValue || null; render(); }
        });

        // while locked, the page gets no keystrokes (except the lock's own input)
        document.addEventListener("keydown", function(e)
        {
            if (!lock || !lockIsActive() || lock.state() != "locked") return;
            var overlayElement = document.getElementById("incognito-lock");
            if (overlayElement && overlayElement.contains(e.target)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);

        ["mousemove", "mousedown", "keydown", "wheel", "touchstart"].forEach(function(name)
        {
            document.addEventListener(name, function() { if (lock) lock.activity(); }, true);
        });

        setInterval(function()
        {
            if (!lock || !lockIsActive()) return;
            var before = lock.state();
            if (lock.tick() != before) render();
        }, 5000);

        // used by the menu (ui.js)
        window.WAIncognitoLock = {
            lockNow: function() { ensureLock(false).lockNow(); render(); },
            hasPasscode: function() { return !!passcode; },
        };

        Diagnostics.register("privacy", "selector", "lock-overlay", function() { return document.getElementById("incognito-lock") ? 1 : 0; });
        Object.keys(PRIVACY_BLUR_TARGETS).forEach(function(key)
        {
            var selector = PRIVACY_BLUR_TARGETS[key].selector;
            Diagnostics.register("privacy", "selector", key + ": " + selector, function() { return document.querySelectorAll(selector).length; });
        });
    })();
}
