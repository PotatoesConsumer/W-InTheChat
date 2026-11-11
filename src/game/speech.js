/**
 * speech.js
 *
 * The optional voice input's browser side: Chrome's Web Speech API
 * (`webkitSpeechRecognition`). Off until the player turns it on and agrees to the
 * prompt in main.js: Chrome may send the audio to Google's servers to turn it into
 * text (the proposal asks us to say so). This app never records, stores or sends the
 * audio itself; only the recognized text reaches the page, and from there chat.
 */

/** Whether this browser has speech recognition (Chrome and Edge do; Firefox doesn't). */
export function speechSupported() {
  return Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
}

/** The recognizer's languages the player can pick. */
export const SPEECH_LANGUAGES = Object.freeze([
  { code: "en-US", label: "EN" },
  { code: "th-TH", label: "TH" },
]);

/**
 * Starts listening until stop(). Recognition ends by itself after a silence or a
 * minute; it is restarted until stopped.
 * @param {object} opts
 * @param {string} opts.lang - BCP 47 code, e.g. "en-US".
 * @param {(text: string) => void} opts.onInterim - The phrase so far, still changing.
 * @param {(text: string) => void} opts.onFinal - A finished phrase.
 * @param {(error: Error) => void} opts.onError - Mic blocked or recognition unavailable;
 *   listening has stopped.
 * @returns {{stop(): void}}
 */
export function startSpeech({ lang, onInterim, onFinal, onError }) {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) throw new Error("This browser has no speech recognition. Use Chrome.");
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let stopped = false;
  let restartTimer = null;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) onFinal(text);
      else interim += text;
    }
    onInterim(interim);
  };
  recognition.onerror = (event) => {
    // A silence or a dropped phrase is normal; it restarts on "end".
    if (event.error === "no-speech" || event.error === "aborted") return;
    stopped = true;
    const why = {
      "not-allowed": "The microphone is blocked. Allow it in the address bar and try again.",
      "service-not-allowed": "Speech recognition isn't allowed in this browser.",
      "audio-capture": "No microphone was found.",
      network: "Speech recognition needs the internet (Chrome sends audio to Google).",
    };
    onError(new Error(why[event.error] ?? `Speech recognition failed: ${event.error}`));
  };
  recognition.onend = () => {
    if (stopped) return;
    restartTimer = setTimeout(() => {
      try {
        recognition.start();
      } catch {
        // Already started again.
      }
    }, 250);
  };

  recognition.start();
  return {
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      recognition.onresult = null;
      recognition.abort();
    },
  };
}
