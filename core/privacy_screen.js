//
// Privacy screen (isolated world): blur classes on <body> (the CSS is in styles.css).
// This is a privacy screen, not data security: use the Vault to protect data.
//


// What each blur option targets.
// `selector` is what the diagnostics count; every entry of `selectors` must appear in styles.css (a test checks it).
// Verified against the live DOM (2.3000.x): data-testid / role hooks only, no atomic class names.
var PRIVACY_BLUR_TARGETS = {
    blurChatList: { cls: "incognito-blur-chatlist", selector: '#pane-side [data-testid="cell-frame-title"]',
        selectors: ['#pane-side [data-testid="cell-frame-title"]', '#pane-side [data-testid="last-msg-status"]'] },
    blurMessages: { cls: "incognito-blur-messages", selector: '#main [data-pre-plain-text]',
        selectors: ['#main [data-pre-plain-text]', '#main [role="row"] span.selectable-text'] },
    blurMedia:    { cls: "incognito-blur-media",    selector: '#main [role="row"] img[src^="blob:"]',
        selectors: ['#main [role="row"] img[src^="blob:"]', '#main [role="row"] video'] },
    blurAvatars:  { cls: "incognito-blur-avatars",  selector: 'img[src*=".cdn.whatsapp.net/"]',
        selectors: ['img[src*=".cdn.whatsapp.net/"]', 'img[src*="pps.whatsapp.net/"]', '#pane-side [data-testid="cell-frame-container"] > div:first-child img'] },
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

//
// DOM wiring (only in the real extension, not in tests)
//
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id)
{
    (function()
    {
        var options = defaultOptions();

        function applyBlur()
        {
            if (!document.body) return;
            Object.keys(PRIVACY_BLUR_TARGETS).forEach(function(key)
            {
                document.body.classList.toggle(PRIVACY_BLUR_TARGETS[key].cls, !!options[key]);
            });
        }

        document.addEventListener("onOptionsUpdate", function(e)
        {
            Object.assign(options, JSON.parse(e.detail));
            applyBlur();
        });

        Object.keys(PRIVACY_BLUR_TARGETS).forEach(function(key)
        {
            var selector = PRIVACY_BLUR_TARGETS[key].selector;
            Diagnostics.register("privacy", "selector", key + ": " + selector, function() { return document.querySelectorAll(selector).length; });
        });
    })();
}
