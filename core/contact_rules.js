//
// Per-contact privacy rules (page world; also loaded by tests and by background.js through importScripts).
// A rule value is "default" | "block" | "allow" for each field: "readReceipts" and "typing".
// The "online" presence stays global: WhatsApp has no per-contact presence.
//

var CONTACT_RULE_FIELDS = ["readReceipts", "typing"];
var CONTACT_RULE_VALUES = ["default", "block", "allow"];

var contactRules = {};          // {normalizedJid: {readReceipts, typing}} (pushed by the isolated world: onContactRulesUpdate)
var lidPnMap = new Map();       // lid <-> phone number JIDs seen on incoming nodes, in both directions

// "block" | "allow" | "default": the first candidate that has an explicit rule for `field` decides
function contactRuleValue(rules, jidCandidates, field)
{
    if (!rules) return "default";
    for (var i = 0; i < jidCandidates.length; i++)
    {
        var rule = rules[jidCandidates[i]];
        if (rule && (rule[field] == "block" || rule[field] == "allow")) return rule[field];
    }
    return "default";
}

// -> true if the action must be blocked
function resolveRule(rules, jidCandidates, field, globalBlocked)
{
    var value = contactRuleValue(rules, jidCandidates, field);
    if (value == "block") return true;
    if (value == "allow") return false;
    return !!globalBlocked;
}

// normalized pn + lid forms of a JID, using the lid <-> pn pairs seen so far
function jidCandidates(jid, lidPnMapToUse)
{
    if (!jid) return [];
    var normalized = normalizeJID(String(jid));
    var candidates = [normalized];
    var counterpart = lidPnMapToUse ? lidPnMapToUse.get(normalized) : null;
    if (counterpart && candidates.indexOf(counterpart) == -1) candidates.push(counterpart);
    return candidates;
}

function rememberLidPair(map, jidA, jidB)
{
    if (!jidA || !jidB) return;
    var a = normalizeJID(String(jidA));
    var b = normalizeJID(String(jidB));
    if (a == b) return;
    map.set(a, b);
    map.set(b, a);
}

// New rules object with one field changed. Default values are dropped, and so are contacts left with no rule.
function applyContactRule(rules, jid, field, value)
{
    var next = JSON.parse(JSON.stringify(rules || {}));
    if (!jid || CONTACT_RULE_FIELDS.indexOf(field) == -1 || CONTACT_RULE_VALUES.indexOf(value) == -1) return next;

    var rule = next[jid] || {};
    if (value == "default") delete rule[field];
    else rule[field] = value;

    if (Object.keys(rule).length == 0) delete next[jid];
    else next[jid] = rule;
    return next;
}

if (typeof document !== "undefined" && document.addEventListener)
{
    document.addEventListener("onContactRulesUpdate", function(e)
    {
        try { contactRules = JSON.parse(e.detail) || {}; }
        catch (exception) { console.warn("WAIncognito: ignoring invalid contact rules"); }
    });
}
