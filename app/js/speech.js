// Read aloud with the browser's own speech (no files, nothing sent anywhere). Voices come from the operating system.
// Long text is spoken sentence by sentence, because some browsers stop a long utterance after about 15 seconds.
const PREF = 'learnathanze:speech';          // 'on' | 'off'
const RATE = 'learnathanze:speech-rate';     // a number as text
export const RATES = [[0.85, 'Slow'], [1, 'Normal'], [1.2, 'Fast']];

export const canSpeak = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
export const speechOn = () => read(PREF, 'off') === 'on';
export const setSpeechOn = (on) => write(PREF, on ? 'on' : 'off');
export const speechRate = () => { const r = Number(read(RATE, '1')); return RATES.some(([v]) => v === r) ? r : 1; };
export const setSpeechRate = (r) => write(RATE, String(r));

function pickVoice() {
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => /^en[-_]GB/i.test(v.lang) && v.localService) || vs.find((v) => /^en/i.test(v.lang) && v.localService) || vs.find((v) => /^en/i.test(v.lang)) || null;
}

/** Splits text into sentences for speaking: "A. B! C?" -> ["A.", "B!", "C?"]. */
export const sentences = (text) => String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?:;])\s+/).filter(Boolean);

let token = 0;
/** Stops whatever is being read. */
export function stopSpeaking() { token++; if (canSpeak()) speechSynthesis.cancel(); }

/** Speaks the text; onEnd runs when the last sentence is finished (not when it was stopped). */
export function speak(text, { rate = 1, onEnd } = {}) {
  if (!canSpeak()) return;
  stopSpeaking();
  const my = token;
  const parts = sentences(text);
  const voice = pickVoice();
  const next = (i) => {
    if (my !== token) return;
    if (i >= parts.length) { onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(parts[i]);
    u.lang = voice?.lang || 'en-GB'; if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => next(i + 1);
    u.onerror = () => { if (my === token) next(i + 1); };
    speechSynthesis.speak(u);
  };
  next(0);
}
