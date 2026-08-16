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
    power: { sym: '5',  label: 'five chord' },
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

  /* ================= how a chord is SPELLED =================
     A chord's LETTER comes from its degree in the key (the fourth of F is a
     B of some kind, always), and its ACCIDENTAL from the pitch that letter
     has to reach. Spelling off a global sharps table instead printed
     "Cm G♯ D♯ A♯" for C minor — four right sounds and not one right name.

     The key pool is the keys people actually write in: every pitch class is
     available in both modes, but only under the spelling a chart would use.
     No D♯ major (nine sharps), no A♯ major, no theoretical keys. */
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const KEYS = {
    major: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'],
    minor: ['A', 'B♭', 'B', 'C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯'],
  };
  /** Repeat the accidental sign `n` times: -1 → '♭', +2 → '♯♯', 0 → ''. */
  function signs(n) {
    const s = n < 0 ? '♭' : '♯';
    let out = '';
    for (let i = Math.abs(n); i > 0; i--) out += s;
    return out;
  }
  /** A written key name → {letter index, accidental, pitch class, name}. */
  function parseKey(name) {
    const li = LETTERS.indexOf(name.charAt(0));
    let acc = 0;
    for (const ch of name.slice(1)) {
      if (ch === '♯' || ch === '#') acc++;
      else if (ch === '♭' || ch === 'b') acc--;
    }
    return { letter: li, acc, pc: pc(LETTER_PC[li] + acc), name };
  }
  const KEY_BY_PC = { major: {}, minor: {} };
  for (const mode of ['major', 'minor']) {
    for (const name of KEYS[mode]) {
      const k = parseKey(name);
      KEY_BY_PC[mode][k.pc] = k;
    }
  }
  /**
   * Spell the note `degree` scale steps above `key` (1 = the key itself),
   * sounding at pitch class `targetPc`.
   * @returns {string} e.g. spellDegree(C, 6, 8) → 'A♭'
   */
  /* Four spellings are RIGHT by the letter arithmetic and wrong on a chart:
     nobody writes a C♭ chord over a bass part. The sixth of E♭ minor is a C♭
     by the rule and a B on every chart in the world, and "play a C♭" is a
     note a beginner cannot find. Those four respell to their natural. */
  const AWKWARD = { 'C♭': 'B', 'F♭': 'E', 'E♯': 'F', 'B♯': 'C' };
  function spellDegree(key, degree, targetPc) {
    const li = (key.letter + (degree - 1)) % 7;
    let d = pc(targetPc - LETTER_PC[li]);
    if (d > 6) d -= 12;                    // -5…6: the nearest way to spell it
    if (d < -2 || d > 2) return NAMES[pc(targetPc)].replace('#', '♯');
    const name = LETTERS[li] + signs(d);
    return AWKWARD[name] || name;
  }
  /** The name of a key, spelled the way a chart would write it. */
  function keyName(keyPc, mode) {
    const k = KEY_BY_PC[mode === 'major' ? 'major' : 'minor'][pc(keyPc)];
    return k ? k.name : NAMES[pc(keyPc)].replace('#', '♯');
  }

  /* ================= progressions =================
     Roots arrive as a looping chord progression in one key, so the
     session reads like a chart: the chord changes, you move the box.
     `steps` are semitones above the key, `degrees` are the SCALE steps that
     decide each chord's letter, and `quality` is what the chord actually is
     in that key — which is what decides the scale. */
  /* i-iv-i-v is the one minor loop whose per-root MINOR PENTATONICS are all
     diatonic to the key, which is why it — and only it — is what the
     power-chord rungs play: there, every chord is graded as a minor
     pentatonic, so any other loop would grade an answer the chart denies. */
  const PARALLEL_SAFE = {
    name: 'i-iv-i-v', steps: [0, 5, 0, 7], degrees: [1, 4, 1, 5],
    roman: ['i', 'iv', 'i', 'v'], qualities: ['min', 'min', 'min', 'min'],
  };
  const SHAPES = {
    minor: [
      { name: 'i-VII-VI-VII', steps: [0, 10, 8, 10], degrees: [1, 7, 6, 7],
        roman: ['i', 'VII', 'VI', 'VII'], qualities: ['min', 'maj', 'maj', 'maj'] },
      PARALLEL_SAFE,
      { name: 'i-VI-III-VII', steps: [0, 8, 3, 10], degrees: [1, 6, 3, 7],
        roman: ['i', 'VI', 'III', 'VII'], qualities: ['min', 'maj', 'maj', 'maj'] },
    ],
    major: [
      { name: 'I-IV-V-IV', steps: [0, 5, 7, 5], degrees: [1, 4, 5, 4],
        roman: ['I', 'IV', 'V', 'IV'], qualities: ['maj', 'maj', 'maj', 'maj'] },
      { name: 'I-V-vi-IV', steps: [0, 7, 9, 5], degrees: [1, 5, 6, 4],
        roman: ['I', 'V', 'vi', 'IV'], qualities: ['maj', 'maj', 'min', 'maj'] },
    ],
    power: [PARALLEL_SAFE],
  };

  /**
   * A four-chord loop in one key.
   * @param spec {keyPc, mode:'minor'|'major', power:boolean, shape?:string}
   *        `power` voices every chord as a 5, the way a rock guitarist would
   *        (and forces the one loop whose boxes are all in the key);
   *        `shape` names a loop instead of rolling for one.
   * @param rand optional () => [0,1) for choosing the shape.
   * @returns {{key, keyPc, mode, name, power,
   *            chords:[{rootPc, root, roman, quality, symbol, scaleKey}]}}
   */
  function progression(spec, rand) {
    const mode = spec && spec.mode === 'major' ? 'major' : 'minor';
    const power = !!(spec && spec.power);
    const pool = SHAPES[power ? 'power' : mode];
    const named = spec && spec.shape && pool.filter(s => s.name === spec.shape)[0];
    const shape = named || pool[Math.min(pool.length - 1,
      Math.floor(((rand || Math.random)()) * pool.length))];
    const key = KEY_BY_PC[mode][pc((spec && spec.keyPc) | 0)]
      || parseKey(NAMES[pc((spec && spec.keyPc) | 0)].replace('#', '♯'));
    const chords = shape.steps.map((step, i) => {
      const quality = power ? 'power' : shape.qualities[i];
      const rootPc = pc(key.pc + step);
      const root = spellDegree(key, shape.degrees[i], rootPc);
      return {
        rootPc, root, roman: shape.roman[i], quality,
        symbol: root + CHORDS[quality].sym,
        scaleKey: scaleForChord(quality),
      };
    });
    return { key: key.name, keyPc: key.pc, mode, name: shape.name, power, chords };
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
   * tie-broken to the lowest string. `minFret` defaults to 1 and is a floor
   * for EVERY NOTE OF THE SHAPE, not merely for the anchor — the major
   * pentatonic reaches one fret below its anchor, so an anchor-only floor
   * still parked two of its notes on open strings, which is a different
   * fingering that teaches nothing transferable (and made the study card
   * print a finger number on fret 0 under a caption promising one finger
   * per fret).
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
      for (let fret = Math.max(minFret, minFret - low); fret + high <= maxFret; fret++) {
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
   * The finger each note of a box wants, as a 1–4 number (1 = index).
   *
   * Both boxes span four frets, so the rule is simply one finger per fret,
   * counted from the LOWEST fret the shape touches — which is the anchor for
   * the minor pentatonic and one fret below it for the major (its second
   * string reaches back). Sliding the shape cannot change these numbers;
   * that is what makes them worth memorising.
   */
  function boxFingers(scaleKey) {
    const box = BOXES[scaleKey];
    if (!box) return [];
    let low = 0;
    for (const [, over] of box.offsets) low = Math.min(low, over);
    return box.offsets.map(([, over]) => over - low + 1);
  }

  /* ================= how far a run goes =================
     A run is the box played in an ORDER. Going up is where everyone starts;
     coming down is a separate skill (the hand knows the shape, the ear has
     to lead), and up-and-back is both in one breath. */
  const RUN_SHAPES = ['up', 'down', 'updown'];

  /**
   * The target list for one run: the box, in the order the run asks for it.
   * @param spec {scaleKey, si, fret, tuning, shape:'up'|'down'|'updown'}
   * @returns targets — 6 for 'up'/'down', 11 for 'updown' (the turn at the
   *          top is played once, and the run comes home to the root).
   */
  function runTargets(spec) {
    const box = boxShape(spec);
    if (!box.length) return [];
    const shape = spec && spec.shape;
    if (shape === 'down') return box.slice().reverse();
    if (shape === 'updown') return box.concat(box.slice(0, box.length - 1).reverse());
    return box;
  }

  /**
   * Place every chord of a progression at once.
   * @returns ({si,fret}|null)[] — one per chord, null where the stage cannot
   *          hold that chord's box. The caller uses this to reject a key
   *          BEFORE posing it, so a loop can never strand mid-way.
   */
  function anchorChords(chords, spec) {
    return (chords || []).map(ch => anchorFor(Object.assign({
      rootPc: ch.rootPc, scaleKey: ch.scaleKey,
    }, spec)));
  }

  /* ================= the stage ladder =================
     Five stages, one table — the whole difficulty curve of scale mode:

       1  one box, one root      one chord over and over, minor box only
       2  same shape, four roots the chord moves; the shape never changes
       3  the major box joins    the chords tell the truth, so both boxes
       4  the box comes down     ONE new thing: the run may play top to bottom
       5  more positions, keys   major keys, the low B, the box anywhere it
                                 fits — and up-and-back in one run

     `strings` are ANCHOR strings (indices into the tuning): the shape reaches
     two strings above its anchor, so a five-string can anchor on 0, 1 or 2.
     `roots` (optional) limits which keys the rung may draw: the first two
     rungs stay on natural-rooted chords, so a beginner's first hour is never
     harder than notes-mode stage 1, where sharps do not exist yet.
     `power` voices the loop as 5 chords (every chord minor pentatonic);
     `vamp` stays on the first chord instead of walking the loop;
     `positions:'any'` lets the same root be placed on whichever string can
     host it, rather than always the lowest one;
     `shapes` are the run directions the rung may ask for — a rung ADDS a
     direction rather than replacing the one before it, so "the box comes
     down" never deletes ascending for a whole stage;
     `fuse` is what the rung does to the clock — the ladder gets FASTER as it
     climbs, so the last rungs are the same shapes with less time to find
     them. It only ever shortens (≤1), and never below two thirds. */
  /* A C D E G: the five natural keys whose i, iv and v are all naturals too,
     so a power-chord loop on any of them spells four natural letters. */
  const EARLY_ROOTS = [9, 0, 2, 4, 7];
  const STAGES = [
    { name: 'One shape, one chord',
      blurb: 'One chord, over and over: the same minor shape until it lives in your hand.',
      scales: ['minPent'], power: true, vamp: true, modes: ['minor'], roots: EARLY_ROOTS,
      strings: [1, 2], minFret: 1, maxFret: 10, shapes: ['up'], positions: 'lowest', fuse: 1 },
    { name: 'Same shape, four chords',
      blurb: 'Four chords now. Same shape every time — all you do is move your hand.',
      scales: ['minPent'], power: true, vamp: false, modes: ['minor'], roots: EARLY_ROOTS,
      strings: [1, 2], minFret: 1, maxFret: 10, shapes: ['up'], positions: 'lowest', fuse: 1 },
    { name: 'The major box joins',
      blurb: 'The chords say what they are now, and a plain letter wants the major shape.',
      scales: ['minPent', 'majPent'], power: false, vamp: false, modes: ['minor'],
      strings: [1, 2], minFret: 1, maxFret: 12, shapes: ['up'], positions: 'lowest', fuse: 0.95 },
    { name: 'The box comes down',
      blurb: 'One new thing: some runs come DOWN the shape instead of up. Same chords, same neck.',
      scales: ['minPent', 'majPent'], power: false, vamp: false, modes: ['minor'],
      strings: [1, 2], minFret: 1, maxFret: 12, shapes: ['up', 'down'], positions: 'lowest', fuse: 0.9 },
    { name: 'More positions, more keys',
      blurb: 'Happy keys join, the low B opens up, and the shape may sit anywhere it fits — up, down, or up and back.',
      scales: ['minPent', 'majPent'], power: false, vamp: false, modes: ['minor', 'major'],
      strings: [0, 1, 2], minFret: 1, maxFret: 12, shapes: ['up', 'down', 'updown'],
      positions: 'any', fuse: 0.85 },
  ];
  /* Anything reading the table for ONE direction gets the rung's default. */
  for (const st of STAGES) st.shape = st.shapes[0];
  /** The stage at `i`, clamped — a stored stage from another mode's ladder
      must never index off the end of this one. */
  function stage(i) {
    return STAGES[Math.min(STAGES.length - 1, Math.max(0, i | 0))];
  }
  /** One of the rung's run directions. */
  function runShapeFor(st, rand) {
    const list = (st && st.shapes) || ['up'];
    return list[Math.min(list.length - 1,
      Math.floor(((rand || Math.random)()) * list.length))];
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

  /**
   * WHAT a wrong note actually was, so the verdict can teach instead of
   * repeating one generic sentence. Three answers, and no answer at all when
   * the note played is the note the run wants:
   *   'octave' — the right note, an octave (or two) out. `dir` says which way.
   *              Inside a box that usually means the top of the shape played
   *              for the bottom, which is a different fingering, not a slip.
   *   'inbox'  — a note that IS in this run, but not now. `at` is its note
   *              number in the run (nearest occurrence to where the run is),
   *              `want` is the number the run is waiting for.
   *   'outside'— a note this box does not contain at all.
   *
   * @param spec {targets, index, midi}
   * @returns {{kind, at, want, dir}|null}
   */
  function missKind(spec) {
    const targets = (spec && spec.targets) || [];
    const index = spec ? spec.index | 0 : 0;
    const midi = spec && spec.midi;
    const expected = targets[index];
    if (!expected || midi === expected.midi) return null;
    const want = index + 1;
    if (pc(midi) === pc(expected.midi)) {
      return { kind: 'octave', at: null, want,
               dir: midi > expected.midi ? 'high' : 'low',
               octaves: Math.round(Math.abs(midi - expected.midi) / 12) };
    }
    /* The nearest occurrence to where the run is standing: an up-and-back run
       passes the same position twice, and "note 7" of a position the player
       is two steps early for would be a stranger reading of it than "note 5". */
    let best = -1;
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].midi !== midi) continue;
      if (best < 0 || Math.abs(i - index) < Math.abs(best - index)) best = i;
    }
    if (best >= 0) return { kind: 'inbox', at: best + 1, want, dir: null };
    return { kind: 'outside', at: null, want, dir: null };
  }

  return { CHORDS, BOXES, SHAPES, NAMES, KEYS, STAGES, RUN_SHAPES,
           scaleForChord, progression, keyName, spellDegree,
           anchorFor, anchorChords, boxShape,
           boxFingers, runTargets, stage, runShapeFor, createScaleRun, missKind };
});
