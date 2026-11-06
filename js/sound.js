/* Small synthesized sounds. Nothing to download. iOS needs a user gesture
   before audio can start, so wake() is called on the first touch. */
let ac = null, on = true;

export const enable = (v) => { on = v; };
export function wake() {
  if (!on) return;
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch {}
}

function tone(freq, dur, vol = 0.06, type = 'sine', when = 0) {
  if (!on || !ac) return;
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

// Pentatonic, so any run of steps sounds pleasant.
const SCALE = [0, 2, 4, 7, 9];
const note = (i) => 392 * 2 ** ((SCALE[i % 5] + 12 * Math.floor(i / 5)) / 12);

export const tick = (frac) => tone(note(Math.floor(frac * 10)), 0.07, 0.035, 'triangle');
export const number = (k) => tone(note(k + 2), 0.18, 0.06, 'sine');
export const back = () => tone(220, 0.05, 0.025, 'triangle');
export function solve() { [0, 2, 4, 7].forEach((i, k) => tone(note(i + 5), 0.35, 0.05, 'sine', k * 0.07)); }
export function unlock() { tone(note(3), 0.5, 0.04, 'sine'); tone(note(8), 0.6, 0.03, 'sine', 0.08); }
