/* Test signal generators — synthetic bass tones for pitch-detection tests.
   These stand in for a real bass: a plucked electric bass has a weak
   fundamental and strong upper harmonics, which is exactly what makes
   naive pitch detection fail. */

/** Pure sine wave — the easy case. */
function sine(hz, sampleRate, seconds = 0.2, amp = 0.5) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * hz * (i / sampleRate));
  return out;
}

/** Harmonic stack with a WEAK fundamental — models a real bass pickup,
    and models what a phone speaker/small monitor reproduces. */
function weakFundamental(hz, sampleRate, seconds = 0.2) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const partials = [
    { mult: 1, amp: 0.25 },
    { mult: 2, amp: 0.60 },
    { mult: 3, amp: 0.35 },
    { mult: 4, amp: 0.20 },
    { mult: 5, amp: 0.10 },
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const p of partials) v += p.amp * Math.sin(2 * Math.PI * hz * p.mult * t);
    out[i] = v / 1.5;
  }
  return out;
}

/** Plucked note: harmonic stack with an exponential decay envelope. */
function pluck(hz, sampleRate, seconds = 0.3) {
  const base = weakFundamental(hz, sampleRate, seconds);
  for (let i = 0; i < base.length; i++) {
    base[i] *= Math.exp(-3 * (i / sampleRate));
  }
  return base;
}

/** Random noise — must never be reported as a pitch. */
function noise(sampleRate, seconds = 0.2, amp = 0.05) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = amp * ((seed / 0x3fffffff) - 1);
  }
  return out;
}

/** Digital silence. */
function silence(sampleRate, seconds = 0.2) {
  return new Float32Array(Math.floor(sampleRate * seconds));
}

module.exports = { sine, weakFundamental, pluck, noise, silence };
