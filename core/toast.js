//
// Small self-dismissing toasts (isolated world).
// The page world only dispatches `waIncognitoToast` {kind: "delete"|"edit"|"status-delete", chatName, preview, targetId?};
// this world decides, from the options, whether to show it.
//

var TOAST_DURATION_MS = 10000;
var TOAST_PREVIEW_MAX = 80;

// FIFO queue of visible toasts. push() returns the toast that must be removed to stay within `max`, or null.
function createToastQueue(max = 3)
{
    var items = [];
    return {
        push: function(item)
        {
            items.push(item);
            return items.length > max ? items.shift() : null;
        },
        remove: function(id)
        {
            items = items.filter(function(item) { return item.id !== id; });
        },
        items: function() { return items.slice(); }
    };
}

function formatToast(toast, settings)
{
    var titles = { "delete": "toast.delete", "edit": "toast.edit", "status-delete": "toast.statusDelete" };
    var title = titles[toast.kind] ? t(titles[toast.kind]) : "WAIncognito";
    var chatName = toast.chatName || "";

    if ((settings && settings.hidePreview) || !toast.preview) return { title: title, body: chatName };

    var preview = String(toast.preview);
    if (preview.length > TOAST_PREVIEW_MAX) preview = preview.slice(0, TOAST_PREVIEW_MAX) + "…";
    return { title: title, body: chatName + ": " + preview };
}

function shouldShowToast(kind, options)
{
    if (!options) return false;
    if (kind == "edit") return options.toastOnEdit === true;
    return options.toastOnDelete === true; // "delete" and "status-delete"
}

function isAnyBlurEnabled(options)
{
    return !!(options && (options.blurChatList || options.blurMessages || options.blurMedia || options.blurAvatars));
}

//
// DOM wiring (only in the real extension, not in tests)
//
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id)
{
    (function()
    {
        var toastOptions = defaultOptions();
        var queue = createToastQueue(3);
        var nextId = 1;

        document.addEventListener("onOptionsUpdate", function(e)
        {
            Object.assign(toastOptions, JSON.parse(e.detail));
        });

        function container()
        {
            var element = document.getElementById("incognito-toasts");
            if (!element)
            {
                element = document.createElement("div");
                element.id = "incognito-toasts";
                document.body.appendChild(element);
            }
            return element;
        }

        function removeToast(item)
        {
            queue.remove(item.id);
            clearTimeout(item.timer);
            if (item.element && item.element.parentNode) item.element.parentNode.removeChild(item.element);
        }

        document.addEventListener("waIncognitoToast", function(e)
        {
            var toast = JSON.parse(e.detail);
            if (!shouldShowToast(toast.kind, toastOptions)) return;

            var text = formatToast(toast, { hidePreview: isAnyBlurEnabled(toastOptions) });
            var element = document.createElement("div");
            element.className = "incognito-toast incognito-toast-" + toast.kind;
            element.setAttribute("role", "status");
            var content = document.createElement("div");
            content.className = "incognito-toast-content";
            var title = document.createElement("div");
            title.className = "incognito-toast-title";
            title.textContent = text.title;
            var body = document.createElement("div");
            body.className = "incognito-toast-body";
            body.textContent = text.body;
            content.appendChild(title);
            content.appendChild(body);
            var close = document.createElement("button");
            close.type = "button";
            close.className = "incognito-toast-close";
            close.setAttribute("aria-label", t("common.close"));
            close.textContent = "\u00d7";
            element.appendChild(content);
            element.appendChild(close);

            var item = { id: nextId++, element: element, timer: null };
            function start() { clearTimeout(item.timer); item.timer = setTimeout(function() { removeToast(item); }, TOAST_DURATION_MS); }
            function pause() { clearTimeout(item.timer); }
            close.addEventListener("click", function(ev) { ev.stopPropagation(); removeToast(item); });
            // an edit toast opens the original text of that one message
            if (toast.kind == "edit" && toast.targetId && typeof showEditHistory == "function")
            {
                element.classList.add("incognito-toast-clickable");
                element.addEventListener("click", function() { removeToast(item); showEditHistory(toast.targetId); });
            }
            element.addEventListener("mouseenter", pause);
            element.addEventListener("mouseleave", start);
            element.addEventListener("focusin", pause);
            element.addEventListener("focusout", start);
            container().appendChild(element);

            var dropped = queue.push(item);
            if (dropped) removeToast(dropped);
            start();
        });
    })();
}
