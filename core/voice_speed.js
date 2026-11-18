//
// Voice note playback speed (page world). Patches HTMLMediaElement.prototype.play: audio elements get the
// "voiceNoteRate" option as playbackRate. If WhatsApp (the user, through its own speed button) changes the rate
// afterwards, that choice is respected for that element.
//

var voiceSpeedPlayCount = 0; // audio plays seen by the patch (diagnostics: 0 after a voice note played means the hook is not hit)

function installVoiceSpeed(mediaPrototype, getRate)
{
    var originalPlay = mediaPrototype.play;

    mediaPrototype.play = function()
    {
        try
        {
            var isAudio = (typeof HTMLAudioElement !== "undefined" && this instanceof HTMLAudioElement) || this.tagName === "AUDIO";
            if (isAudio)
            {
                voiceSpeedPlayCount++;
                var rate = getRate();
                if (rate && rate !== 1 && !this.__incognitoRateOverridden)
                {
                    if (!this.__incognitoRateListener)
                    {
                        this.__incognitoRateListener = true;
                        var element = this;
                        element.addEventListener("ratechange", function()
                        {
                            // our own change is ignored; any other value is the user's choice
                            if (element.playbackRate !== element.__incognitoRate) element.__incognitoRateOverridden = true;
                        });
                    }
                    this.__incognitoRate = rate;
                    this.playbackRate = rate;
                }
            }
        }
        catch (e)
        {
            // never get in the way of playback
        }
        return originalPlay.apply(this, arguments);
    };
}

if (typeof HTMLMediaElement !== "undefined")
{
    installVoiceSpeed(HTMLMediaElement.prototype, function() { return (window.WAIncognitoOptions || {}).voiceNoteRate; });
}

if (typeof Diagnostics !== "undefined")
    Diagnostics.register("voice", "hook", "audio-play", function() { return voiceSpeedPlayCount; });
