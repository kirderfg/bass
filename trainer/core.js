/* Bass Live Trainer — core pitch/note logic.
   Loads in the browser as `BassCore`, and in Node via require() for tests.
   No dependencies, no build step. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Lowest note we care about is the open low B (30.87 Hz); highest is
  // roughly the G string at fret 12 (392 Hz) with headroom.
  const MIN_HZ = 27;
  const MAX_HZ = 420;
  // How periodic the signal must be before we call it a note. A plucked
  // string scores ~0.9+; room noise and finger squeaks score far lower.
  const CLARITY_MIN = 0.5;
  // Below this level the player simply isn't playing.
  const RMS_MIN = 0.008;

  /**
   * Detect the fundamental frequency of `samples`.
   *
   * Uses the normalized square difference function (McLeod Pitch Method).
   * Plain autocorrelation picks the largest peak, which on a bass note with
   * a weak fundamental lands on a sub-harmonic (reporting G2 as ~G0). NSDF
   * normalizes away that bias, then we take the FIRST key maximum that is
   * within `K` of the best one, which resolves the remaining octave errors.
   *
   * @returns {{hz:number, clarity:number}|null} null when there is no clear pitch.
   */
  function detectPitch(samples, sampleRate) {
    const K = 0.9;
    const n = samples.length;
    const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(n / 2));
    const minLag = Math.floor(sampleRate / MAX_HZ);
    if (maxLag <= minLag) return null;

    let rms = 0;
    for (let i = 0; i < n; i++) rms += samples[i] * samples[i];
    rms = Math.sqrt(rms / n);
    if (rms < RMS_MIN) return null;

    // NSDF: n'(t) = 2*r'(t) / m'(t)
    const nsdf = new Float32Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
      let acf = 0, div = 0;
      for (let i = 0; i < n - lag; i++) {
        acf += samples[i] * samples[i + lag];
        div += samples[i] * samples[i] + samples[i + lag] * samples[i + lag];
      }
      nsdf[lag] = div > 0 ? (2 * acf) / div : 0;
    }

    // Key maxima: the highest point of each hump above zero, after the
    // NSDF first dips negative (skips the trivial peak at lag 0).
    let lag = minLag;
    while (lag <= maxLag && nsdf[lag] > 0) lag++;   // wait for first negative
    const keyMaxima = [];
    while (lag <= maxLag) {
      if (nsdf[lag] > 0) {
        let best = lag;
        while (lag <= maxLag && nsdf[lag] > 0) {
          if (nsdf[lag] > nsdf[best]) best = lag;
          lag++;
        }
        keyMaxima.push(best);
      } else lag++;
    }
    if (!keyMaxima.length) return null;

    let highest = 0;
    for (const km of keyMaxima) if (nsdf[km] > highest) highest = nsdf[km];
    if (highest < CLARITY_MIN) return null;

    let chosen = keyMaxima[0];
    for (const km of keyMaxima) {
      if (nsdf[km] >= K * highest) { chosen = km; break; }
    }

    // Parabolic interpolation around the chosen lag for sub-sample accuracy,
    // which is what makes cents-level tuning readings possible.
    const y0 = nsdf[chosen - 1] || 0, y1 = nsdf[chosen], y2 = nsdf[chosen + 1] || 0;
    const denom = 2 * (2 * y1 - y0 - y2);
    const shift = denom !== 0 ? (y2 - y0) / denom : 0;
    const trueLag = chosen + shift;
    if (trueLag <= 0) return null;

    const hz = sampleRate / trueLag;
    if (hz < MIN_HZ || hz > MAX_HZ) return null;
    return { hz, clarity: nsdf[chosen] };
  }

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /** Frequency of a MIDI note number (A4 = 69 = 440 Hz). */
  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /**
   * Map a frequency onto the nearest note.
   * @returns {{midi:number, name:string, octave:number, cents:number}}
   *   `cents` is how far sharp (+) or flat (-) of that note the pitch sits.
   */
  function hzToNote(hz) {
    const exact = 69 + 12 * Math.log2(hz / 440);
    const midi = Math.round(exact);
    return {
      midi,
      name: NAMES[((midi % 12) + 12) % 12],
      octave: Math.floor(midi / 12) - 1,
      cents: (exact - midi) * 100,
    };
  }

  /**
   * Turns a stream of raw pitch readings into discrete answers.
   *
   * A plucked note rings for seconds and wobbles as it decays, so raw
   * readings would fire dozens of "answers" per note. The tracker emits
   * `stable` exactly once, after the same note has been held for
   * `stableMs`, and not again until the note is released.
   *
   * States: idle (nothing playing) → listening (settling) → stable (fires
   * once) → held (still ringing, already counted).
   */
  function createTracker(opts) {
    const stableMs = (opts && opts.stableMs) || 150;
    // Silence must persist this long to count as releasing the string.
    // Detection flickers as a note decays; without this, the tail of one
    // note re-arms the tracker and answers the following question.
    const releaseMs = (opts && opts.releaseMs != null) ? opts.releaseMs : 120;
    let currentMidi = null, since = 0, fired = false, silentSince = null;

    return {
      push(hz, timeMs) {
        if (hz == null) {
          if (silentSince === null) silentSince = timeMs;
          if (timeMs - silentSince >= releaseMs) { currentMidi = null; fired = false; }
          return { state: 'idle', midi: null, cents: 0, hz: null };
        }
        silentSince = null;
        const note = hzToNote(hz);
        if (note.midi !== currentMidi) {
          currentMidi = note.midi; since = timeMs; fired = false;
        }
        const base = { midi: note.midi, cents: note.cents, hz };
        if (fired) return Object.assign({ state: 'held' }, base);
        if (timeMs - since >= stableMs) {
          fired = true;
          return Object.assign({ state: 'stable' }, base);
        }
        return Object.assign({ state: 'listening' }, base);
      },
      /** Clear display state without re-arming: a ringing note stays consumed. */
      reset() { since = 0; },
    };
  }

  /**
   * Reduce the sample rate by an integer `factor`, low-passing first so
   * that high-frequency content cannot alias down into the bass range.
   *
   * Detection cost is O(samples × maxLag), both of which scale with the
   * sample rate — decimating by 4 makes it ~16x cheaper, which is the
   * difference between smooth and unusable on a phone. Two passes of a
   * moving average give enough stopband rejection for our purposes and
   * cost only a couple of adds per sample.
   */
  function downsample(samples, factor) {
    if (factor <= 1) return samples;
    const width = factor * 2;
    const pass = (src) => {
      const out = new Float32Array(src.length);
      let acc = 0;
      for (let i = 0; i < src.length; i++) {
        acc += src[i];
        if (i >= width) acc -= src[i - width];
        out[i] = acc / Math.min(i + 1, width);
      }
      return out;
    };
    const smoothed = pass(pass(samples));
    const out = new Float32Array(Math.floor(samples.length / factor));
    for (let i = 0; i < out.length; i++) out[i] = smoothed[i * factor];
    return out;
  }

  /**
   * Match a pitch to the open string the player is most likely tuning.
   *
   * A chromatic tuner is actively unhelpful on a slack string: 70 cents
   * below E is closer to D#, so it says "D#, tune DOWN" and walks the
   * player further from where they want to be. Snapping to the nearest
   * OPEN STRING of the current tuning keeps the advice pointed at E.
   *
   * @param openMidis MIDI numbers of the open strings, e.g. [23,28,33,38,43]
   * @returns {{midi:number, name:string, cents:number}|null} null when the
   *          pitch is nowhere near an open string (they're fretting, not tuning).
   */
  function nearestOpenString(hz, openMidis) {
    const MAX_CENTS = 250; // beyond ~2 tones they are fretting, not tuning
    let best = null;
    for (const midi of openMidis) {
      const cents = 1200 * Math.log2(hz / midiToHz(midi));
      if (!best || Math.abs(cents) < Math.abs(best.cents)) {
        best = { midi, name: NAMES[((midi % 12) + 12) % 12], cents };
      }
    }
    return best && Math.abs(best.cents) <= MAX_CENTS ? best : null;
  }

  // How far out of tune a note may sit and still count as "found".
  const CENTS_TOLERANCE = 40;

  /**
   * Judge a detected note against the note the question asked for.
   * @returns {'correct'|'out-of-tune'|'wrong-octave'|'wrong'}
   */
  function checkAnswer(detected, targetMidi) {
    if (detected.midi === targetMidi) {
      return Math.abs(detected.cents) <= CENTS_TOLERANCE ? 'correct' : 'out-of-tune';
    }
    const gap = detected.midi - targetMidi;
    if (gap % 12 === 0) return 'wrong-octave';
    return 'wrong';
  }

  /**
   * Decide whether the instrument itself is out of tune, as opposed to the
   * player being sloppy. A flat bass pushes EVERY note the same way, so we
   * look for a large mean offset with little spread.
   */
  function tuningDrift(centsHistory) {
    const MIN_SAMPLES = 5, MEAN_TRIGGER = 20, MAX_SPREAD = 15;
    if (!centsHistory || centsHistory.length < MIN_SAMPLES) {
      return { drifting: false, meanCents: 0 };
    }
    const mean = centsHistory.reduce((a, b) => a + b, 0) / centsHistory.length;
    const spread = Math.sqrt(
      centsHistory.reduce((a, c) => a + (c - mean) * (c - mean), 0) / centsHistory.length
    );
    return {
      drifting: Math.abs(mean) >= MEAN_TRIGGER && spread <= MAX_SPREAD,
      meanCents: mean,
    };
  }

  return {
    detectPitch, hzToNote, midiToHz, createTracker, checkAnswer, tuningDrift, downsample, nearestOpenString,
    NAMES, MIN_HZ, MAX_HZ, CLARITY_MIN, CENTS_TOLERANCE,
  };
});
