//
// Small self-dismissing toasts (isolated world).
// The page world only dispatches `waIncognitoToast` {kind: "delete"|"edit"|"status-delete", chatName, preview};
// this world decides, from the options, whether to show it.
//

var TOAST_DURATION_MS = 5000;
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
    var titles = {
        "delete": "🗑️ Pesan dihapus",
        "edit": "✏️ Pesan diedit",
        "status-delete": "🗑️ Status dihapus pengirim",
    };
    var title = titles[toast.kind] || "WAIncognito";
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
            if (item.element && item.element.parentNode) item.element.parentNode.removeChild(item.element);
        }

        document.addEventListener("waIncognitoToast", function(e)
        {
            var toast = JSON.parse(e.detail);
            if (!shouldShowToast(toast.kind, toastOptions)) return;

            var text = formatToast(toast, { hidePreview: isAnyBlurEnabled(toastOptions) });
            var element = document.createElement("div");
            element.className = "incognito-toast";
            var title = document.createElement("div");
            title.className = "incognito-toast-title";
            title.textContent = text.title;
            var body = document.createElement("div");
            body.className = "incognito-toast-body";
            body.textContent = text.body;
            element.appendChild(title);
            element.appendChild(body);

            var item = { id: nextId++, element: element };
            element.addEventListener("click", function() { removeToast(item); });
            container().appendChild(element);

            var dropped = queue.push(item);
            if (dropped) removeToast(dropped);
            setTimeout(function() { removeToast(item); }, TOAST_DURATION_MS);
        });
    })();
}
