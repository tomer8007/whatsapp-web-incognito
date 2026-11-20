//
// Translations (both worlds). t(key, params) looks the key up in the active language, falls back to English, then to the key.
// The dictionaries live in core/i18n_strings.js (I18N_DICT[code] = {key: text}). `{name}` placeholders are filled from params.
// The page world only sends kinds and params; the isolated world (toasts, popups) translates. A few page-world labels use t() too:
// both worlds read the same `language` option (default "en"; "auto" = the browser language, English when it is not supported).
//

// English first (the default), then the others by language code. Native names.
var I18N_LANGUAGES = [
    { code: "en", name: "English" },
    { code: "ar", name: "العربية", rtl: true },
    { code: "de", name: "Deutsch" },
    { code: "es", name: "Español" },
    { code: "fr", name: "Français" },
    { code: "hi", name: "हिन्दी" },
    { code: "id", name: "Bahasa Indonesia" },
    { code: "ja", name: "日本語" },
    { code: "pt-BR", name: "Português (Brasil)" },
    { code: "ru", name: "Русский" },
    { code: "tr", name: "Türkçe" },
    { code: "zh-CN", name: "简体中文" },
];

var I18N_DEFAULT_LANGUAGE = "en";
var I18N_DICT = (typeof I18N_DICT != "undefined" && I18N_DICT) ? I18N_DICT : {};
var i18nActiveLanguage = I18N_DEFAULT_LANGUAGE;

function i18nSupported(code)
{
    return I18N_LANGUAGES.some(function(language) { return language.code == code; });
}

// preference: "auto" or a language code; browserLanguages: navigator.languages (or [navigator.language]). -> a supported code
function resolveLanguage(preference, browserLanguages)
{
    if (preference && preference != "auto" && i18nSupported(preference)) return preference;

    var candidates = browserLanguages || [];
    for (var i = 0; i < candidates.length; i++)
    {
        var tag = String(candidates[i] || "").replace("_", "-");
        if (!tag) continue;
        if (i18nSupported(tag)) return tag;
        var lower = tag.toLowerCase();
        if (lower == "pt" || lower.indexOf("pt-") == 0) return "pt-BR";
        if (lower == "zh" || lower.indexOf("zh-") == 0) return "zh-CN";
        var base = lower.split("-")[0];
        if (i18nSupported(base)) return base;
    }
    return I18N_DEFAULT_LANGUAGE;
}

function browserLanguageList()
{
    try
    {
        if (typeof navigator != "undefined")
            return navigator.languages && navigator.languages.length ? Array.prototype.slice.call(navigator.languages) : [navigator.language];
    }
    catch (e) {}
    return [];
}

// preference: the `language` option. Returns the active code.
function setLanguage(preference)
{
    i18nActiveLanguage = resolveLanguage(preference, browserLanguageList());
    return i18nActiveLanguage;
}

function getLanguage() { return i18nActiveLanguage; }

// Number in the active language's format (decimal separator, digits). Falls back to a plain toFixed when Intl is missing.
function formatNumber(value, fractionDigits)
{
    try
    {
        return new Intl.NumberFormat(i18nActiveLanguage, { minimumFractionDigits: fractionDigits || 0, maximumFractionDigits: fractionDigits || 0 }).format(value);
    }
    catch (e)
    {
        return Number(value).toFixed(fractionDigits || 0);
    }
}

function isRtlLanguage(code)
{
    var language = I18N_LANGUAGES.find(function(l) { return l.code == (code || i18nActiveLanguage); });
    return !!(language && language.rtl);
}

function t(key, params)
{
    var dict = I18N_DICT[i18nActiveLanguage];
    var text = dict && dict[key] != null ? dict[key] : (I18N_DICT[I18N_DEFAULT_LANGUAGE] || {})[key];
    if (text == null) return key;
    if (params)
    {
        text = text.replace(/\{(\w+)\}/g, function(match, name) { return params[name] != null ? String(params[name]) : match; });
    }
    return text;
}

// Both worlds read the `language` option from the same onOptionsUpdate event the rest of the extension uses.
if (typeof document != "undefined" && document.addEventListener)
{
    document.addEventListener("onOptionsUpdate", function(e)
    {
        try
        {
            var update = JSON.parse(e.detail);
            if (update && "language" in update) setLanguage(update.language);
        }
        catch (exception) {}
    });
}
