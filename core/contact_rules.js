//
// Per-contact rules (page world and isolated world; also loaded by tests and by background.js through importScripts).
// Storage (chrome.storage.local["contactRules"]): {normalizedJid: {key: value}}. Missing key = follow the global setting.
// Rules are stored under every known form of the JID (PN and LID), so either form finds them.
//
// Value kinds (CONTACT_RULE_SCHEMA):
//   "blockAllow": "block" | "allow"  (the original two keys, kept as they were: readReceipts, typing)
//   "onOff":      "on" | "off"       (a feature switched on or off for this contact)
//   "choice":     one of `choices`   (a number such as a delay in minutes)
// "online" presence stays global: WhatsApp has no per-contact presence.
//

var CONTACT_RULE_SCHEMA = [
    { key: "readReceipts", kind: "blockAllow", option: "readConfirmationsHook" },
    { key: "typing", kind: "blockAllow", option: "typingUpdatesHook" },
    { key: "showDeviceTypes", kind: "onOff", option: "showDeviceTypes" },
    { key: "autoReceiptOnReplay", kind: "onOff", option: "autoReceiptOnReplay" },
    { key: "showReadWarning", kind: "onOff", option: "showReadWarning" },
    { key: "saveDeletedMsgs", kind: "onOff", option: "saveDeletedMsgs" },
    { key: "markDeleted", kind: "onOff", option: null, globalDefault: true },
    { key: "saveEdits", kind: "onOff", option: "saveEdits" },
    { key: "toastOnDelete", kind: "onOff", option: "toastOnDelete" },
    { key: "toastOnEdit", kind: "onOff", option: "toastOnEdit" },
    { key: "keepDisappearing", kind: "onOff", option: "keepDisappearing" },
    { key: "blurMessages", kind: "onOff", option: "blurMessages" },
    { key: "blurMedia", kind: "onOff", option: "blurMedia" },
    { key: "blurAvatars", kind: "onOff", option: "blurAvatars" },
    { key: "autoSchedule", kind: "choice", choices: [15, 60, 180], option: null },
];

var CONTACT_RULE_FIELDS = CONTACT_RULE_SCHEMA.map(function(entry) { return entry.key; });
var CONTACT_RULE_VALUES = ["default", "block", "allow"]; // kept for older callers

var contactRulesReceived = false; // true once the isolated world has pushed the rules (even an empty set)
var contactRules = {};          // {normalizedJid: {key: value}} (pushed by the isolated world: onContactRulesUpdate)
var lidPnMap = new Map();       // lid <-> phone number JIDs seen on incoming nodes, in both directions

function contactRuleEntry(field)
{
    for (var i = 0; i < CONTACT_RULE_SCHEMA.length; i++) if (CONTACT_RULE_SCHEMA[i].key == field) return CONTACT_RULE_SCHEMA[i];
    return null;
}

// Same normalization as normalizeJID in core/utils.js (this file also runs where utils.js is not loaded)
function normalizeRuleJid(jid)
{
    jid = String(jid);
    if (jid.indexOf("@s.whatsapp.net") > -1) jid = jid.replace("@s.whatsapp.net", "@c.us");
    var suffix = jid.split("@")[1];
    var prefix = jid.split("@")[0].split(":")[0];
    return prefix + "@" + suffix;
}

function validRuleValue(entry, value)
{
    if (!entry) return false;
    if (entry.kind == "blockAllow") return value == "block" || value == "allow";
    if (entry.kind == "onOff") return value == "on" || value == "off";
    return entry.choices.indexOf(value) > -1;
}

// the stored value of `field` for the first candidate that has one, or "default"
function contactRuleValue(rules, jidCandidates, field)
{
    if (!rules) return "default";
    var entry = contactRuleEntry(field);
    for (var i = 0; i < jidCandidates.length; i++)
    {
        var rule = rules[jidCandidates[i]];
        if (rule && validRuleValue(entry, rule[field])) return rule[field];
    }
    return "default";
}

// -> true if the action must be blocked ("blockAllow" fields)
function resolveRule(rules, jidCandidates, field, globalBlocked)
{
    var value = contactRuleValue(rules, jidCandidates, field);
    if (value == "block") return true;
    if (value == "allow") return false;
    return !!globalBlocked;
}

// -> boolean for "onOff" fields: the contact's choice, else the global value
function resolveToggle(rules, jidCandidates, field, globalValue)
{
    var value = contactRuleValue(rules, jidCandidates, field);
    if (value == "on") return true;
    if (value == "off") return false;
    return !!globalValue;
}

// -> the contact's choice, else the global value ("choice" fields)
function resolveChoice(rules, jidCandidates, field, globalValue)
{
    var value = contactRuleValue(rules, jidCandidates, field);
    return value == "default" ? globalValue : value;
}

// How many rules does a contact have (any form of its JID)?
function countContactRules(rules, jids)
{
    var seen = {};
    (jids || []).forEach(function(jid)
    {
        var rule = rules && rules[jid];
        if (!rule) return;
        Object.keys(rule).forEach(function(key) { if (validRuleValue(contactRuleEntry(key), rule[key])) seen[key] = true; });
    });
    return Object.keys(seen).length;
}

// normalized pn + lid forms of a JID: the pairs seen so far, then WhatsApp's own mapping when available (page world)
function jidCandidates(jid, lidPnMapToUse)
{
    if (!jid) return [];
    var normalized = normalizeRuleJid(jid);
    var candidates = [normalized];
    function add(other) { if (other && candidates.indexOf(normalizeRuleJid(other)) == -1) candidates.push(normalizeRuleJid(other)); }

    if (lidPnMapToUse) add(lidPnMapToUse.get(normalized));
    if (typeof liveLidCounterparts == "function")
    {
        try { liveLidCounterparts(normalized).forEach(add); } catch (e) { /* mapping unavailable */ }
    }
    return candidates;
}

function rememberLidPair(map, jidA, jidB)
{
    if (!jidA || !jidB) return;
    var a = normalizeRuleJid(jidA);
    var b = normalizeRuleJid(jidB);
    if (a == b) return;
    map.set(a, b);
    map.set(b, a);
}

// New rules object with one field changed. "default" drops the field, and a contact left with no rule is dropped.
function applyContactRule(rules, jid, field, value)
{
    var next = JSON.parse(JSON.stringify(rules || {}));
    var entry = contactRuleEntry(field);
    if (!jid || !entry) return next;
    if (value !== "default" && !validRuleValue(entry, value)) return next;

    var rule = next[jid] || {};
    if (value === "default") delete rule[field];
    else rule[field] = value;

    if (Object.keys(rule).length == 0) delete next[jid];
    else next[jid] = rule;
    return next;
}

// New rules object without any rule for these JIDs ("reset to global")
function clearContactRules(rules, jids)
{
    var next = JSON.parse(JSON.stringify(rules || {}));
    (jids || []).forEach(function(jid) { delete next[jid]; });
    return next;
}

// The options with this contact's overrides applied to the toggles that the engine reads from WAIncognitoOptions.
function contactOptionsFor(jid, options, rules, lidMap)
{
    var result = Object.assign({}, options);
    if (!jid) return result;
    var candidates = jidCandidates(jid, lidMap);
    CONTACT_RULE_SCHEMA.forEach(function(entry)
    {
        if (entry.kind != "onOff" || !entry.option) return;
        result[entry.option] = resolveToggle(rules, candidates, entry.key, options[entry.option]);
    });
    return result;
}

if (typeof document !== "undefined" && document.addEventListener)
{
    document.addEventListener("onContactRulesUpdate", function(e)
    {
        try { contactRules = JSON.parse(e.detail) || {}; }
        catch (exception) { console.warn("WAIncognito: ignoring invalid contact rules"); }
        contactRulesReceived = true;
    });
}
