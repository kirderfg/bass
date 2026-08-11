const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../core.js');
const { weakFundamental, sine, pluck, noise, silence } = require('./signals.js');

const RATE = 44100;

/* Expected frequencies come from the standard equal-temperament table
   (A4 = 440 Hz), NOT from the code under test. */
const G2 = 97.999;  // E string, fret 3 — the note the probe mis-detected as 32.67 Hz
const OPEN_STRINGS = [
  { name: 'B0 (low B)', hz: 30.868 },
  { name: 'E1', hz: 41.203 },
  { name: 'A1', hz: 55.000 },
  { name: 'D2', hz: 73.416 },
  { name: 'G2', hz: 97.999 },
];

function centsFrom(actualHz, expectedHz) {
  return Math.abs(1200 * Math.log2(actualHz / expectedHz));
}

test('detects the fundamental of a bass note whose fundamental is quieter than its harmonics', () => {
  const samples = weakFundamental(G2, RATE);
  const result = core.detectPitch(samples, RATE);

  assert.ok(result, 'expected a pitch to be detected');
  // Must be the fundamental — NOT a sub-harmonic (G2/2, G2/3) and not an
  // upper harmonic (G2*2). Within 1 cent ≈ a factor of 1.00058.
  assert.ok(
    Math.abs(1200 * Math.log2(result.hz / G2)) < 1,
    `expected ~${G2} Hz, got ${result.hz.toFixed(2)} Hz`
  );
});

test('detects every open string on a 5-string bass, including the low B', () => {
  for (const s of OPEN_STRINGS) {
    const result = core.detectPitch(pluck(s.hz, RATE, 0.35), RATE);
    assert.ok(result, `no pitch detected for ${s.name}`);
    const off = centsFrom(result.hz, s.hz);
    assert.ok(off < 5, `${s.name}: expected ${s.hz} Hz, got ${result.hz.toFixed(2)} Hz (${off.toFixed(1)} cents off)`);
  }
});

test('reports no pitch for silence or noise', () => {
  assert.equal(core.detectPitch(silence(RATE), RATE), null, 'silence should not produce a pitch');
  assert.equal(core.detectPitch(noise(RATE), RATE), null, 'noise should not produce a pitch');
});

test('resolves a pure sine to within a cent across the bass range', () => {
  for (const hz of [41.203, 55.0, 97.999, 246.942]) {
    const result = core.detectPitch(sine(hz, RATE, 0.25), RATE);
    assert.ok(result, `no pitch for ${hz} Hz`);
    assert.ok(centsFrom(result.hz, hz) < 1, `${hz} Hz: got ${result.hz.toFixed(3)} Hz`);
  }
});

test('maps a frequency to its note name, MIDI number and cents deviation', () => {
  // Reference values from the equal-temperament table, A4 = 440 Hz = MIDI 69.
  const inTune = core.hzToNote(440);
  assert.equal(inTune.name, 'A');
  assert.equal(inTune.midi, 69);
  assert.ok(Math.abs(inTune.cents) < 1, `expected ~0 cents, got ${inTune.cents}`);

  const lowB = core.hzToNote(30.868);
  assert.equal(lowB.name, 'B');
  assert.equal(lowB.midi, 23, 'open low B on a 5-string is MIDI 23');

  // A1 (55 Hz) pushed sharp but still nearer to A than to A#.
  // (Exactly +50 cents is the midpoint between two notes, so it is a
  // meaningless tie-break — we specify the unambiguous side of it.)
  const sharp = core.hzToNote(55 * Math.pow(2, 45 / 1200));
  assert.equal(sharp.midi, 33, 'should still round to A1, not the next semitone');
  assert.ok(Math.abs(sharp.cents - 45) < 1, `expected ~+45 cents, got ${sharp.cents}`);

  // Flat side: E1 (41.203 Hz) pulled 30 cents flat
  const flat = core.hzToNote(41.203 * Math.pow(2, -30 / 1200));
  assert.equal(flat.midi, 28);
  assert.ok(Math.abs(flat.cents + 30) < 1, `expected ~-30 cents, got ${flat.cents}`);
});

test('a tracker reports a note as stable only once it has been held steadily', () => {
  const tracker = core.createTracker({ stableMs: 150 });
  const G2_HZ = 97.999;

  assert.equal(tracker.push(G2_HZ, 0).state, 'listening', 'a note just started is not yet an answer');
  assert.equal(tracker.push(G2_HZ, 100).state, 'listening', 'still inside the settle window');

  const settled = tracker.push(G2_HZ, 160);
  assert.equal(settled.state, 'stable', 'held past the settle window, so it counts');
  assert.equal(settled.midi, 43, 'G2 is MIDI 43');

  assert.equal(tracker.push(G2_HZ, 200).state, 'held',
    'a note that keeps ringing must not fire a second answer');
});

test('a tracker restarts the settle window when the player changes note', () => {
  const tracker = core.createTracker({ stableMs: 150 });
  tracker.push(97.999, 0);
  tracker.push(41.203, 100);            // slipped onto a different note
  assert.equal(tracker.push(97.999, 140).state, 'listening', 'the clock restarts on each new note');
  assert.equal(tracker.push(97.999, 220).state, 'listening', 'still settling since the change at 140');
  assert.equal(tracker.push(97.999, 300).state, 'stable');
});

test('a tracker goes idle when the signal stops, and can then accept the same note again', () => {
  const tracker = core.createTracker({ stableMs: 150 });
  tracker.push(97.999, 0);
  assert.equal(tracker.push(97.999, 200).state, 'stable');
  assert.equal(tracker.push(null, 260).state, 'idle', 'silence clears the tracker');
  tracker.push(97.999, 300);
  assert.equal(tracker.push(97.999, 500).state, 'stable', 'the same note replayed is a new answer');
});

test('judging an answer is strict about the octave, not just the note name', () => {
  const target = 43; // G2 — E string, fret 3

  assert.equal(core.checkAnswer({ midi: 43, cents: 5 }, target), 'correct');
  assert.equal(core.checkAnswer({ midi: 43, cents: -38 }, target), 'correct',
    'slightly out of tune still counts as finding the right note');
  assert.equal(core.checkAnswer({ midi: 43, cents: 45 }, target), 'out-of-tune',
    'beyond tolerance we tell the player to tune rather than marking it wrong');

  assert.equal(core.checkAnswer({ midi: 55, cents: 0 }, target), 'wrong-octave',
    'the same note name an octave up is a distinct, teachable mistake');
  assert.equal(core.checkAnswer({ midi: 31, cents: 0 }, target), 'wrong-octave');
  assert.equal(core.checkAnswer({ midi: 45, cents: 0 }, target), 'wrong');
});

test('detects a consistently detuned instrument, and ignores ordinary scatter', () => {
  const flatBass = core.tuningDrift([-33, -35, -31, -36, -34, -32]);
  assert.equal(flatBass.drifting, true, 'every note landing ~a third of a semitone flat means the bass is flat');
  assert.ok(Math.abs(flatBass.meanCents + 33.5) < 2, `got ${flatBass.meanCents}`);

  assert.equal(core.tuningDrift([2, -3, 5, -1, 0, 4]).drifting, false,
    'a well-tuned bass must not be nagged');
  assert.equal(core.tuningDrift([-40, 38, -35, 42, -30, 39]).drifting, false,
    'wild scatter is shaky fingers or bad detection, not a detuned instrument');
  assert.equal(core.tuningDrift([-35, -33]).drifting, false,
    'two readings is not enough evidence to accuse the instrument');
});

test('a note is still identified correctly after downsampling for cheap analysis', () => {
  // Detection cost grows with sample rate, so the app analyses decimated
  // audio. That must not change the answer.
  const full = pluck(41.203, RATE, 0.4);          // open E
  const decimated = core.downsample(full, 4);
  assert.ok(Math.abs(decimated.length - full.length / 4) <= 1, 'length should shrink by the factor');

  const result = core.detectPitch(decimated, RATE / 4);
  assert.ok(result, 'no pitch detected in decimated audio');
  assert.ok(centsFrom(result.hz, 41.203) < 5,
    `expected 41.203 Hz, got ${result.hz.toFixed(2)} Hz`);
});

test('downsampling removes content above the new Nyquist so it cannot alias into the bass range', () => {
  // 8 kHz decimated by 4 (new rate 11.025 kHz) would fold down to ~3 kHz
  // if it were not filtered out first.
  const hiss = sine(8000, RATE, 0.2, 0.5);
  const decimated = core.downsample(hiss, 4);
  let rms = 0;
  for (let i = 0; i < decimated.length; i++) rms += decimated[i] * decimated[i];
  rms = Math.sqrt(rms / decimated.length);
  assert.ok(rms < 0.05, `high frequency content survived decimation (rms ${rms.toFixed(3)})`);
});
