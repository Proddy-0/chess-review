// Synthesised board sounds (WebAudio, no audio files).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem("cr:muted") === "1"; } catch { /* ignore */ }

const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

function knock(t, { freq = 900, gain = 0.5, dur = 0.07 } = {}) {
  const a = ac();
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = 1.4;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

function tone(t, freq, dur = 0.18, gain = 0.12, type = "sine") {
  const a = ac();
  const o = a.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sound = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem("cr:muted", muted ? "1" : "0"); } catch { /* ignore */ }
    return muted;
  },
  /** move: chess.js verbose move; extra: { check, mate, kind } */
  play(move, { check = false, mate = false, kind = null } = {}) {
    if (muted || !move) return;
    try {
      const a = ac();
      if (a.state === "suspended") a.resume();
      const t = a.currentTime + 0.01;
      if (move.flags.includes("k") || move.flags.includes("q")) { knock(t); knock(t + 0.11, { freq: 800 }); }
      else if (move.captured) { knock(t, { freq: 650, gain: 0.8, dur: 0.1 }); knock(t + 0.03, { freq: 1200, gain: 0.3 }); }
      else knock(t);
      if (move.promotion) tone(t + 0.05, 880, 0.25, 0.08, "triangle");
      if (check) tone(t + 0.04, 1320, 0.16, 0.07, "square");
      if (mate) { tone(t + 0.12, 523, 0.5); tone(t + 0.12, 659, 0.5); tone(t + 0.12, 784, 0.6); }
      if (kind === "brilliant" || kind === "great") { tone(t + 0.1, 1047, 0.2, 0.06); tone(t + 0.2, 1568, 0.3, 0.05); }
      if (kind === "blunder") tone(t + 0.1, 196, 0.35, 0.08, "sawtooth");
    } catch { /* audio unavailable */ }
  },
};
