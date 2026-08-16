/* Bass Trainer — scale mode's rules.
   The player is shown a CHORD and must know which scale it wants, then
   play that scale's moveable box in order. This module owns all of that
   as pure functions so Node can test it: the chord→scale mapping, the
   progressions that supply the roots, the box shape itself, and the
   judging of a run through it.
   Loads in the browser as `BassScales`, and in Node via require().
   No dependencies, no build step — same contract as shared/game.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassScales = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* The chord vocabulary the game asks with. Quality decides the scale;
     `sym` is what the bell wears. A power chord names no third, so it is
     the one ambiguous case — rock plays minor pentatonic over it. */
  const CHORDS = {
    power: { sym: '5',  label: 'power chord' },
    min:   { sym: 'm',  label: 'minor' },
    m7:    { sym: 'm7', label: 'minor 7' },
    maj:   { sym: '',   label: 'major' },
  };

  /**
   * Which scale a chord quality asks for — the mapping the Chords tab
   * already teaches. Anything carrying a minor third, and the third-less
   * power chord, take the minor pentatonic; major chords take the major.
   */
  function scaleForChord(quality) {
    return quality === 'maj' ? 'majPent' : 'minPent';
  }

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = n => ((n % 12) + 12) % 12;

  /* ================= progressions =================
     Roots arrive as a looping chord progression in one key, so the
     session reads like a chart: the chord changes, you move the box.
     Degrees are semitones above the key; quality is what the chord
     actually is in that key, which is what decides the scale. */
  const SHAPES = {
    minor: [
      { name: 'i-VII-VI-VII', steps: [0, 10, 8, 10], qualities: ['min', 'maj', 'maj', 'maj'] },
      { name: 'i-iv-i-v',     steps: [0, 5, 0, 7],   qualities: ['min', 'min', 'min', 'min'] },
      { name: 'i-VI-III-VII', steps: [0, 8, 3, 10],  qualities: ['min', 'maj', 'maj', 'maj'] },
    ],
    major: [
      { name: 'I-IV-V-IV', steps: [0, 5, 7, 5], qualities: ['maj', 'maj', 'maj', 'maj'] },
      { name: 'I-V-vi-IV', steps: [0, 7, 9, 5], qualities: ['maj', 'maj', 'min', 'maj'] },
    ],
  };

  /**
   * A four-chord loop in one key.
   * @param spec {keyPc, mode:'minor'|'major', power:boolean} — `power`
   *        voices every chord as a 5, the way a rock guitarist would.
   * @param rand optional () => [0,1) for choosing the shape.
   * @returns {{key, mode, name, chords:[{rootPc, quality, symbol, scaleKey}]}}
   */
  function progression(spec, rand) {
    const mode = spec && spec.mode === 'major' ? 'major' : 'minor';
    const pool = SHAPES[mode];
    const shape = pool[Math.min(pool.length - 1,
      Math.floor(((rand || Math.random)()) * pool.length))];
    const keyPc = pc((spec && spec.keyPc) | 0);
    const chords = shape.steps.map((step, i) => {
      const quality = spec && spec.power ? 'power' : shape.qualities[i];
      const rootPc = pc(keyPc + step);
      return {
        rootPc, quality,
        symbol: NAMES[rootPc] + CHORDS[quality].sym,
        scaleKey: scaleForChord(quality),
      };
    });
    return { key: NAMES[keyPc], keyPc, mode, name: shape.name, chords };
  }

  /* ================= the moveable box =================
     One octave of the scale under one hand, as offsets from the anchor
     (the root on the lowest string of the shape): [stringsUp, fretsOver].
     Both shapes span four frets, so it is one finger per fret and the
     whole thing slides — learn it once, play it from any root. */
  const BOXES = {
    minPent: { degrees: ['R', 'b3', '4', '5', 'b7', 'R'],
               offsets: [[0, 0], [0, 3], [1, 0], [1, 2], [2, 0], [2, 2]] },
    majPent: { degrees: ['R', '2', '3', '5', '6', 'R'],
               offsets: [[0, 0], [0, 2], [1, -1], [1, 2], [2, -1], [2, 2]] },
  };

  /**
   * Where to put the box for a root: the lowest fret the shape fits at,
   * tie-broken to the lowest string. `minFret` defaults to 1 so the
   * shape is genuinely moveable — an open-string anchor is a different
   * fingering that teaches nothing transferable.
   *
   * @returns {{si, fret}|null} null when the shape cannot fit the stage.
   */
  function anchorFor(spec) {
    const t = spec.tuning, box = BOXES[spec.scaleKey];
    if (!box) return null;
    const maxFret = spec.maxFret == null ? 12 : spec.maxFret;
    const minFret = spec.minFret == null ? 1 : spec.minFret;
    // How far the shape reaches either side of its anchor fret.
    let low = 0, high = 0, reach = 0;
    for (const [up, over] of box.offsets) {
      low = Math.min(low, over); high = Math.max(high, over);
      reach = Math.max(reach, up);
    }
    const anchors = spec.anchorStrings ||
      t.midi.map((_, si) => si).filter(si => si + reach < t.midi.length);
    let best = null;
    for (const si of anchors) {
      if (si + reach >= t.midi.length) continue;
      for (let fret = Math.max(minFret, -low); fret + high <= maxFret; fret++) {
        if (pc(t.midi[si] + fret) !== pc(spec.rootPc)) continue;
        if (!best || fret < best.fret || (fret === best.fret && si < best.si)) {
          best = { si, fret };
        }
        break;              // the next root on this string is an octave up
      }
    }
    return best;
  }

  /**
   * The taught fingering for a scale, anchored at `si`/`fret` (the root
   * on the shape's lowest string).
   * @returns {{si, fret, midi, degree}[]} six targets, ascending in pitch.
   */
  function boxShape(spec) {
    const box = BOXES[spec.scaleKey];
    if (!box) return [];
    const t = spec.tuning;
    return box.offsets.map(([up, over], i) => {
      const si = spec.si + up, fret = spec.fret + over;
      return { si, fret, midi: t.midi[si] + fret, degree: box.degrees[i] };
    });
  }

  /**
   * One run through a box: six notes, in order.
   *
   * Unlike a drill — which halts on the first wrong note and reports
   * afterwards — a scale run PARKS on the step you missed and lets you
   * try again, so one slip does not cost the notes you already landed.
   * What a miss does cost is the run's `clean` flag.
   */
  function createScaleRun(targets) {
    let i = 0, clean = true;
    return {
      /** The note the run is waiting for, or null once it is done. */
      expected() { return i < targets.length ? targets[i] : null; },
      index() { return i; },
      push(midi) {
        if (i >= targets.length) return { status: 'done', index: i };
        if (midi === targets[i].midi) {
          i++;
          return { status: i >= targets.length ? 'done' : 'advanced', index: i };
        }
        clean = false;
        return { status: 'retry', index: i, expected: targets[i].midi, played: midi };
      },
      result() {
        return { clean, done: i >= targets.length, landed: i, total: targets.length };
      },
    };
  }

  return { CHORDS, BOXES, SHAPES, NAMES, scaleForChord, progression, anchorFor, boxShape, createScaleRun };
});
