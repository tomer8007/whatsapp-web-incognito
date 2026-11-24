//
// Text lookup (both worlds). t(key, params) returns the English text of the key (or the key itself when it is unknown).
// The dictionary lives in core/i18n_strings.js (I18N_DICT["en"] = {key: text}). `{name}` placeholders are filled from params.
// The page world only sends kinds and params; the isolated world (toasts, popups) translates. A few page-world labels use t() too.
//

var I18N_DICT = (typeof I18N_DICT != "undefined" && I18N_DICT) ? I18N_DICT : {};

function t(key, params)
{
    var text = (I18N_DICT["en"] || {})[key];
    if (text == null) return key;
    if (params)
    {
        text = text.replace(/\{(\w+)\}/g, function(match, name) { return params[name] != null ? String(params[name]) : match; });
    }
    return text;
}
