//
// WAModal (isolated world): the one reusable popup of the extension, styled like WhatsApp Web (styles.css, `.wam-*`).
//
//   WAModal.open({ title, size: "sm"|"md"|"lg"|"xl", maxWidth, closeOnBackdrop, closeOnEsc, onClose, bodyClass })
//       -> { el, dialog, header, body, footer, setTitle(text), close() }
//   WAModal.fire(options)   Promise<{isConfirmed, isDenied, isDismissed, value}>, a small SweetAlert-like dialog:
//       title, text, html, icon (success|error|warning|info|question), input (text|password|checkbox), inputPlaceholder, inputValue,
//       showCancelButton, showDenyButton, confirmButtonText, denyButtonText, cancelButtonText, preConfirm, didOpen(dialog),
//       width, allowOutsideClick, allowEscapeKey, timer, toast (+ position: a small snackbar, no focus, no backdrop)
//   WAModal.showValidationMessage(text)   inside preConfirm
//
// Behaviour: ESC and backdrop click close only the topmost popup, Tab is trapped inside it, focus goes back to the
// element that had it, keystrokes inside a popup never reach WhatsApp's own shortcuts.
//

var WAModal = (function()
{
    var stack = [];
    var counter = 0;
    var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    var SIZES = { sm: 420, md: 560, lg: 720, xl: 900 };

    // index of the element that gets focus after Tab / Shift+Tab, wrapping around. Pure, unit-tested.
    function nextFocusIndex(count, current, backwards)
    {
        if (count <= 0) return -1;
        if (current < 0 || current >= count) return backwards ? count - 1 : 0;
        if (backwards) return current == 0 ? count - 1 : current - 1;
        return current == count - 1 ? 0 : current + 1;
    }

    // SweetAlert-style numeric width -> size name
    function sizeForWidth(width)
    {
        if (!width) return "md";
        if (width <= 480) return "sm";
        if (width <= 640) return "md";
        if (width <= 780) return "lg";
        return "xl";
    }

    function escapeText(text)
    {
        return String(text == null ? "" : text).replace(/[&<>"']/g, function(c)
        {
            return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
        });
    }

    function make(tag, className, text)
    {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = text;
        return el;
    }

    function focusables(dialog)
    {
        return Array.prototype.filter.call(dialog.querySelectorAll(FOCUSABLE), function(el)
        {
            return el.offsetParent !== null || el === document.activeElement;
        });
    }

    function top() { return stack.length ? stack[stack.length - 1] : null; }

    var escapeHandledOnKeyDown = false;

    function onKeyUp(e)
    {
        if (e.key != "Escape") return;
        var handled = escapeHandledOnKeyDown;
        escapeHandledOnKeyDown = false;
        var current = top();
        if (!current || handled) return;
        e.stopPropagation();
        if (current.closeOnEsc) current.close();
    }

    function onKeyDown(e)
    {
        var current = top();
        if (!current) return;

        if (e.key == "Escape")
        {
            escapeHandledOnKeyDown = true;
            e.stopPropagation();
            e.preventDefault();
            if (current.closeOnEsc) current.close();
            return;
        }
        if (e.key == "Tab")
        {
            var items = focusables(current.dialog);
            if (items.length == 0) { e.preventDefault(); return; }
            var index = nextFocusIndex(items.length, items.indexOf(document.activeElement), e.shiftKey);
            e.preventDefault();
            items[index].focus();
        }
    }

    function ensureGlobalListeners()
    {
        if (ensureGlobalListeners.done) return;
        ensureGlobalListeners.done = true;
        window.addEventListener("keydown", onKeyDown, true);
        // WhatsApp swallows Escape on keydown before our listener sees it; the keyup still arrives
        window.addEventListener("keyup", onKeyUp, true);
    }

    function closeIcon()
    {
        return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>';
    }

    function open(options)
    {
        options = options || {};
        ensureGlobalListeners();

        var id = "wam-" + (++counter);
        var previousFocus = document.activeElement;

        var backdrop = make("div", "wam-backdrop");
        backdrop.style.zIndex = String(2000000 + stack.length * 2);
        var dialog = make("div", "wam-dialog wam-size-" + (options.size || "md") + (options.bodyClass ? " " + options.bodyClass : ""));
        dialog.setAttribute("role", options.role || "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", id + "-title");
        dialog.setAttribute("tabindex", "-1");
        dialog.setAttribute("dir", "ltr");
        if (options.maxWidth) dialog.style.maxWidth = "min(" + options.maxWidth + "px, 94vw)";

        var header = make("header", "wam-header");
        var title = make("h2", "wam-title", options.title || "");
        title.id = id + "-title";
        var closeButton = make("button", "wam-close");
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Tutup");
        closeButton.innerHTML = closeIcon();
        header.appendChild(title);
        header.appendChild(closeButton);

        var body = make("div", "wam-body");
        var footer = make("footer", "wam-footer");
        footer.hidden = true;

        dialog.appendChild(header);
        dialog.appendChild(body);
        dialog.appendChild(footer);
        backdrop.appendChild(dialog);

        var handle = { id: id, el: backdrop, dialog: dialog, header: header, body: body, footer: footer, closed: false };
        handle.closeOnEsc = options.closeOnEsc !== false;
        handle.setTitle = function(text) { title.textContent = text; };
        handle.close = function()
        {
            if (handle.closed) return;
            handle.closed = true;
            var index = stack.indexOf(handle);
            if (index > -1) stack.splice(index, 1);
            backdrop.remove();
            if (previousFocus && previousFocus.focus && document.contains(previousFocus))
            {
                try { previousFocus.focus(); } catch (e) {}
            }
            if (options.onClose) options.onClose();
        };

        closeButton.addEventListener("click", function() { handle.close(); });

        // closes only when the press AND the release happen on the backdrop (so text selection drags do not close it)
        var pressedOnBackdrop = false;
        backdrop.addEventListener("mousedown", function(e) { pressedOnBackdrop = e.target === backdrop; });
        backdrop.addEventListener("click", function(e)
        {
            if (e.target === backdrop && pressedOnBackdrop && options.closeOnBackdrop !== false) handle.close();
            pressedOnBackdrop = false;
        });

        // WhatsApp has global shortcuts: keep typing inside the popup to ourselves
        ["keydown", "keyup", "keypress"].forEach(function(type)
        {
            backdrop.addEventListener(type, function(e)
            {
                if (e.key == "Escape" || (type == "keydown" && e.key == "Tab")) return; // handled by the capture listeners
                e.stopPropagation();
            });
        });

        stack.push(handle);
        document.body.appendChild(backdrop);
        return handle;
    }

    // the first focusable thing in the body, else the dialog itself
    function focusInitial(handle, preferred)
    {
        var target = preferred || focusables(handle.body)[0] || focusables(handle.dialog)[0] || handle.dialog;
        try { target.focus(); } catch (e) {}
    }

    var ICONS = { success: "✓", error: "✕", warning: "!", info: "i", question: "?" };

    function showSnack(options)
    {
        var container = document.getElementById("wam-snacks");
        if (!container)
        {
            container = make("div", "wam-snacks");
            container.id = "wam-snacks";
            container.setAttribute("role", "status");
            container.setAttribute("aria-live", "polite");
            document.body.appendChild(container);
        }
        var snack = make("div", "wam-snack");
        if (options.icon) snack.appendChild(make("span", "wam-icon wam-icon-" + options.icon, ICONS[options.icon] || ""));
        snack.appendChild(make("span", "wam-snack-text", options.title || options.text || ""));
        container.appendChild(snack);
        var timer = options.timer || 4000;
        setTimeout(function() { snack.remove(); }, timer);
        return Promise.resolve({ isConfirmed: false, isDenied: false, isDismissed: true });
    }

    var activeFire = null;

    function fire(options)
    {
        options = options || {};
        if (options.toast) return showSnack(options);

        return new Promise(function(resolve)
        {
            var settled = false;
            var result = null;
            var timerHandle = null;
            var inputElement = null;
            var validation = null;

            var handle = open({
                title: options.title || "",
                size: options.size || sizeForWidth(options.width),
                closeOnBackdrop: options.allowOutsideClick !== false,
                closeOnEsc: options.allowEscapeKey !== false,
                onClose: function()
                {
                    clearTimeout(timerHandle);
                    if (activeFire === handle) activeFire = null;
                    if (!settled)
                    {
                        settled = true;
                        resolve({ isConfirmed: false, isDenied: false, isDismissed: true, value: undefined });
                    }
                },
            });
            activeFire = handle;
            handle.validation = null;

            var content = make("div", "wam-fire");
            if (options.icon)
            {
                content.appendChild(make("span", "wam-icon wam-icon-" + options.icon + " wam-icon-lg", ICONS[options.icon] || ""));
            }
            var textBox = make("div", "wam-fire-text");
            if (options.text) textBox.appendChild(make("p", "wam-p", options.text));
            if (options.html)
            {
                var htmlBox = make("div", "wam-html");
                htmlBox.innerHTML = options.html;
                textBox.appendChild(htmlBox);
            }
            content.appendChild(textBox);
            handle.body.appendChild(content);

            if (options.input)
            {
                if (options.input == "checkbox")
                {
                    var label = make("label", "wam-check-row");
                    inputElement = make("input", "wam-checkbox");
                    inputElement.type = "checkbox";
                    inputElement.checked = !!Number(options.inputValue);
                    label.appendChild(inputElement);
                    label.appendChild(make("span", "", options.inputPlaceholder || ""));
                    handle.body.appendChild(label);
                }
                else
                {
                    inputElement = make("input", "wam-input");
                    inputElement.type = options.input;
                    inputElement.placeholder = options.inputPlaceholder || "";
                    if (options.inputValue != null) inputElement.value = options.inputValue;
                    inputElement.setAttribute("aria-label", options.inputPlaceholder || options.title || "Isian");
                    handle.body.appendChild(inputElement);
                }
            }

            validation = make("div", "wam-validation");
            validation.setAttribute("role", "alert");
            validation.hidden = true;
            handle.body.appendChild(validation);
            handle.validation = validation;

            function finish(value)
            {
                if (settled) return;
                settled = true;
                result = value;
                handle.close();
                resolve(value);
            }

            function currentValue()
            {
                if (!inputElement) return undefined;
                if (options.input == "checkbox") return inputElement.checked ? 1 : 0;
                return inputElement.value;
            }

            async function confirm()
            {
                var value = currentValue();
                if (options.preConfirm)
                {
                    validation.hidden = true;
                    try { value = await options.preConfirm(value); }
                    catch (e) { value = false; }
                    if (value === false) return;
                }
                finish({ isConfirmed: true, isDenied: false, isDismissed: false, value: value });
            }

            var buttons = [];
            if (options.showCancelButton)
            {
                var cancel = make("button", "wam-btn wam-btn-secondary", options.cancelButtonText || "Batal");
                cancel.type = "button";
                cancel.addEventListener("click", function() { finish({ isConfirmed: false, isDenied: false, isDismissed: true, value: undefined }); });
                buttons.push(cancel);
            }
            if (options.showDenyButton)
            {
                var deny = make("button", "wam-btn wam-btn-danger", options.denyButtonText || "Tidak");
                deny.type = "button";
                deny.addEventListener("click", function() { finish({ isConfirmed: false, isDenied: true, isDismissed: false, value: undefined }); });
                buttons.push(deny);
            }
            var confirmButton = null;
            if (options.showConfirmButton !== false)
            {
                confirmButton = make("button", "wam-btn wam-btn-primary", options.confirmButtonText || "OK");
                confirmButton.type = "button";
                confirmButton.addEventListener("click", confirm);
                buttons.push(confirmButton);
            }
            if (buttons.length)
            {
                handle.footer.hidden = false;
                buttons.forEach(function(button) { handle.footer.appendChild(button); });
            }

            if (inputElement && options.input != "checkbox")
            {
                inputElement.addEventListener("keydown", function(e) { if (e.key == "Enter") { e.preventDefault(); confirm(); } });
            }

            if (options.didOpen) { try { options.didOpen(handle.dialog); } catch (e) { console.error(e); } }
            focusInitial(handle, inputElement || confirmButton);

            if (options.timer) timerHandle = setTimeout(function() { finish({ isConfirmed: false, isDenied: false, isDismissed: true, value: undefined }); }, options.timer);
        });
    }

    function showValidationMessage(text)
    {
        var current = activeFire || top();
        if (!current || !current.validation) return;
        current.validation.textContent = text;
        current.validation.hidden = false;
    }

    return {
        open: open,
        fire: fire,
        showValidationMessage: showValidationMessage,
        closeAll: function() { while (stack.length) stack[stack.length - 1].close(); },
        isOpen: function() { return stack.length > 0; },
        escapeText: escapeText,
        make: make,
        nextFocusIndex: nextFocusIndex,
        sizeForWidth: sizeForWidth,
        focusInitial: focusInitial,
        SIZES: SIZES,
    };
})();
