/* Unit tests for scale mode's rules: which scale a chord asks for, the
   chord progressions that supply the roots, the moveable box the game
   grades you against, and how a run of that box is judged.
   Pure Node — the pixel rendering is exercised by the e2e suite. */
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../../shared/scales.js');

/* ================= which scale does this chord want? =================
   The player is shown a chord and nothing else; knowing the scale IS the
   skill. The mapping is the one the Chords tab already teaches. */

test('minor-family chords ask for the minor pentatonic', () => {
  assert.equal(S.scaleForChord('min'), 'minPent');
  assert.equal(S.scaleForChord('m7'), 'minPent');
});

test('major chords ask for the major pentatonic', () => {
  assert.equal(S.scaleForChord('maj'), 'majPent');
});

test('a power chord takes the minor pentatonic — it names no third', () => {
  // A 5 chord is root and fifth only: it commits to neither quality, and
  // the minor pentatonic is what rock actually plays over it.
  assert.equal(S.scaleForChord('power'), 'minPent');
});

/* ================= the moveable box =================
   One shape, anchored on the root, that slides up the neck. The game
   grades the exact pitches it implies, so this is the spec of what
   "correct" means. */

const FIVE = { names: ['B', 'E', 'A', 'D', 'G'], midi: [23, 28, 33, 38, 43] };

/* ================= the progression =================
   The roots arrive as a looping chord progression in one key, so a
   session feels like a chart rather than a stack of flashcards. */

test('a progression is four chords, all diatonic to its key', () => {
  // In A minor the chords a rock progression is built from are the
  // triads of that key: A C D E F G (no accidentals outside the key).
  const p = S.progression({ keyPc: 9, mode: 'minor' }, () => 0);
  assert.equal(p.chords.length, 4);
  const inKey = [9, 11, 0, 2, 4, 5, 7];          // A B C D E F G
  for (const ch of p.chords) {
    assert.ok(inKey.includes(ch.rootPc),
      `${ch.symbol} is not diatonic to A minor`);
  }
});

test('a progression starts on its key — the ear needs a home', () => {
  const p = S.progression({ keyPc: 4, mode: 'minor' }, () => 0);
  assert.equal(p.chords[0].rootPc, 4, 'the first chord is the key itself');
});

test('every chord carries the scale it asks for and a symbol to show', () => {
  const p = S.progression({ keyPc: 9, mode: 'minor' }, () => 0);
  for (const ch of p.chords) {
    assert.ok(['minPent', 'majPent'].includes(ch.scaleKey));
    assert.equal(ch.scaleKey, S.scaleForChord(ch.quality),
      `${ch.symbol} disagrees with the chord→scale mapping`);
    assert.match(ch.symbol, /^[A-G][♯♭]?(m|m7|5)?$/, `bad symbol: ${ch.symbol}`);
  }
});

/* ================= how the chords are SPELLED =================
   A chord is spelled from its degree IN THE KEY — the letter is decided by
   the degree, the accidental by the pitch. A global sharps table printed
   "Cm G♯ D♯ A♯" for C minor, which is not a chart anyone has ever read.
   These tests assert the exact symbols, not the shape of a symbol. */

test('C minor is spelled Cm A♭ E♭ B♭ — flats, because that is the key', () => {
  const p = S.progression({ keyPc: 0, mode: 'minor', shape: 'i-VI-III-VII' });
  assert.equal(p.key, 'C');
  assert.deepEqual(p.chords.map(c => c.symbol), ['Cm', 'A♭', 'E♭', 'B♭']);
});

test('F major is spelled F B♭ C B♭ — the fourth is a B FLAT, never an A♯', () => {
  const p = S.progression({ keyPc: 5, mode: 'major', shape: 'I-IV-V-IV' });
  assert.equal(p.key, 'F');
  assert.deepEqual(p.chords.map(c => c.symbol), ['F', 'B♭', 'C', 'B♭']);
});

test('E minor keeps its one sharp and spells the rest natural', () => {
  assert.deepEqual(
    S.progression({ keyPc: 4, mode: 'minor', shape: 'i-VII-VI-VII' })
      .chords.map(c => c.symbol), ['Em', 'D', 'C', 'D']);
  assert.deepEqual(
    S.progression({ keyPc: 4, mode: 'minor', shape: 'i-VI-III-VII' })
      .chords.map(c => c.symbol), ['Em', 'C', 'G', 'D']);
  assert.deepEqual(
    S.progression({ keyPc: 4, mode: 'minor', shape: 'i-iv-i-v' })
      .chords.map(c => c.symbol), ['Em', 'Am', 'Em', 'Bm']);
});

test('sharp keys spell sharps: G♯ minor is G♯m E B F♯', () => {
  const p = S.progression({ keyPc: 8, mode: 'minor', shape: 'i-VI-III-VII' });
  assert.equal(p.key, 'G♯');
  assert.deepEqual(p.chords.map(c => c.symbol), ['G♯m', 'E', 'B', 'F♯']);
});

test('D♭ major is a flat key all the way down, including its vi', () => {
  assert.deepEqual(
    S.progression({ keyPc: 1, mode: 'major', shape: 'I-IV-V-IV' })
      .chords.map(c => c.symbol), ['D♭', 'G♭', 'A♭', 'G♭']);
  assert.deepEqual(
    S.progression({ keyPc: 1, mode: 'major', shape: 'I-V-vi-IV' })
      .chords.map(c => c.symbol), ['D♭', 'A♭', 'B♭m', 'G♭']);
});

test('no chord nobody writes: C♭, F♭, E♯ and B♯ respell to their natural', () => {
  // The sixth of E♭ minor is a C♭ by the letter arithmetic and a B on every
  // chart there is — and "play a C♭" is a note a beginner cannot find.
  const p = S.progression({ keyPc: 3, mode: 'minor', shape: 'i-VI-III-VII' });
  assert.deepEqual(p.chords.map(c => c.symbol), ['E♭m', 'B', 'G♭', 'D♭']);
  for (const mode of ['minor', 'major']) {
    for (let keyPc = 0; keyPc < 12; keyPc++) {
      for (const pick of [0, 0.5, 0.99]) {
        for (const ch of S.progression({ keyPc, mode }, () => pick).chords) {
          assert.doesNotMatch(ch.symbol, /^(C♭|F♭|E♯|B♯)/, 'unwritable chord: ' + ch.symbol);
          assert.doesNotMatch(ch.symbol, /[♯♭]{2}/, 'a double accidental: ' + ch.symbol);
        }
      }
    }
  }
});

test('no key outside the pool a musician actually writes in', () => {
  // Twelve pitch classes, twelve usable spellings per mode — no D♯ major
  // (nine sharps), no A♯ major, no theoretical keys at all.
  assert.deepEqual(S.KEYS.major,
    ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);
  assert.deepEqual(S.KEYS.minor,
    ['A', 'B♭', 'B', 'C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯']);
  for (const mode of ['minor', 'major']) {
    for (let keyPc = 0; keyPc < 12; keyPc++) {
      for (const pick of [0, 0.5, 0.99]) {
        for (const power of [false, true]) {
          const p = S.progression({ keyPc, mode, power }, () => pick);
          assert.ok(S.KEYS[mode].includes(p.key),
            `${p.key} ${mode} is not a key anyone writes in`);
        }
      }
    }
  }
});

test('every chord in every key spells its own pitch, once, with one accidental', () => {
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (const mode of ['minor', 'major']) {
    for (let keyPc = 0; keyPc < 12; keyPc++) {
      for (const pick of [0, 0.5, 0.99]) {
        for (const power of [false, true]) {
          const p = S.progression({ keyPc, mode, power }, () => pick);
          for (const ch of p.chords) {
            const m = /^([A-G])([♯♭]?)/.exec(ch.symbol);
            assert.ok(m, `unspellable symbol ${ch.symbol} in ${p.key} ${mode}`);
            const want = ((PC[m[1]] + (m[2] === '♯' ? 1 : m[2] === '♭' ? -1 : 0)) % 12 + 12) % 12;
            assert.equal(want, ch.rootPc,
              `${ch.symbol} in ${p.key} ${mode} does not sound what it spells`);
            assert.equal(ch.root, m[1] + m[2], 'the chord does not carry its spelled root');
          }
          // Four bars, four different letters where the progression has four
          // different degrees — a chart never spells one degree two ways.
          const bySpelling = {};
          for (const ch of p.chords) bySpelling[ch.rootPc] = (bySpelling[ch.rootPc] || new Set()).add(ch.root);
          for (const k in bySpelling) assert.equal(bySpelling[k].size, 1,
            `one pitch spelled two ways in ${p.key} ${mode}`);
        }
      }
    }
  }
});

test('the minor pentatonic box is the shape every bassist learns first', () => {
  // A minor pentatonic anchored on the E string at fret 5 — A C D E G A,
  // spanning four frets. This is the box the old course taught.
  const box = S.boxShape({ scaleKey: 'minPent', si: 1, fret: 5, tuning: FIVE });
  assert.deepEqual(box.map(t => [FIVE.names[t.si], t.fret]),
    [['E', 5], ['E', 8], ['A', 5], ['A', 7], ['D', 5], ['D', 7]]);
  assert.deepEqual(box.map(t => t.degree), ['R', 'b3', '4', '5', 'b7', 'R']);
  assert.deepEqual(box.map(t => t.midi), [33, 36, 38, 40, 43, 45]);
});

test('the major pentatonic box is its own shape, not the minor one moved', () => {
  // C major pentatonic anchored on the E string at fret 8 — C D E G A C.
  const box = S.boxShape({ scaleKey: 'majPent', si: 1, fret: 8, tuning: FIVE });
  assert.deepEqual(box.map(t => [FIVE.names[t.si], t.fret]),
    [['E', 8], ['E', 10], ['A', 7], ['A', 10], ['D', 7], ['D', 10]]);
  assert.deepEqual(box.map(t => t.degree), ['R', '2', '3', '5', '6', 'R']);
  assert.deepEqual(box.map(t => t.midi), [36, 38, 40, 43, 45, 48]);
});

test('the box slides: the same shape from any root keeps its intervals', () => {
  // Learn it once, play it everywhere — that is the whole point of a
  // moveable shape, so the interval pattern must never change.
  const at = (si, fret, scaleKey) =>
    S.boxShape({ scaleKey, si, fret, tuning: FIVE }).map(t => t.midi);
  const intervals = midis => midis.map(m => m - midis[0]);
  for (const scaleKey of ['minPent', 'majPent']) {
    const home = intervals(at(1, 5, scaleKey));
    for (const [si, fret] of [[0, 3], [1, 9], [2, 2], [2, 7]]) {
      assert.deepEqual(intervals(at(si, fret, scaleKey)), home,
        `${scaleKey} changed shape at string ${si} fret ${fret}`);
    }
  }
  // One octave, and the top note is the root again.
  assert.equal(at(1, 5, 'minPent')[5] - at(1, 5, 'minPent')[0], 12);
});

test('the box anchors at the lowest comfortable position for its root', () => {
  // A minor pentatonic: A lives at E-string 5 and B-string 10 — the same
  // pitch. The lower fret is the one a hand goes to.
  const a = S.anchorFor({ rootPc: 9, scaleKey: 'minPent', tuning: FIVE });
  assert.deepEqual([a.si, a.fret], [1, 5]);
  // E minor pentatonic anchors on the B string at fret 5 — exactly the
  // box the old course taught.
  const e = S.anchorFor({ rootPc: 4, scaleKey: 'minPent', tuning: FIVE });
  assert.deepEqual([e.si, e.fret], [0, 5]);
});

test('the anchor stays inside the stage it was given', () => {
  // A stage that only opens the E and A strings must not anchor a shape
  // on the B string, and must not run past its top fret.
  // E on the E string is fret 0 (not moveable) or fret 12 (whose box would
  // reach fret 15, past the stage) — so the shape lands on the A string.
  const a = S.anchorFor({ rootPc: 4, scaleKey: 'minPent', tuning: FIVE,
                          anchorStrings: [1, 2], maxFret: 12 });
  assert.deepEqual([a.si, a.fret], [2, 7], 'E on the A string, fret 7');
  // Nothing fits: say so rather than inventing a shape off the neck.
  assert.equal(S.anchorFor({ rootPc: 4, scaleKey: 'minPent', tuning: FIVE,
                             anchorStrings: [1], maxFret: 5 }), null);
});

test('the WHOLE box clears the open strings, not just its anchor', () => {
  /* The major-pentatonic shape reaches one fret BELOW its anchor, so an
     anchor merely off fret 0 still put two notes on open strings — and the
     study card then printed a FINGER on fret 0 under a caption promising one
     finger per fret. minFret is a floor for every note in the shape. */
  for (const scaleKey of ['minPent', 'majPent']) {
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      const a = S.anchorFor({ rootPc, scaleKey, tuning: FIVE });
      assert.ok(a, `${scaleKey} from root ${rootPc} found no anchor at all`);
      const frets = S.boxShape({ scaleKey, si: a.si, fret: a.fret, tuning: FIVE })
        .map(t => t.fret);
      assert.ok(Math.min.apply(null, frets) >= 1,
        `${scaleKey} from root ${rootPc} sits on an open string: frets ${frets.join(',')}`);
    }
  }
});

test('a stated minFret is a floor for every note of the shape', () => {
  for (const minFret of [1, 3, 5]) {
    for (const scaleKey of ['minPent', 'majPent']) {
      for (let rootPc = 0; rootPc < 12; rootPc++) {
        const a = S.anchorFor({ rootPc, scaleKey, tuning: FIVE, minFret, maxFret: 15 });
        if (!a) continue;
        const frets = S.boxShape({ scaleKey, si: a.si, fret: a.fret, tuning: FIVE })
          .map(t => t.fret);
        assert.ok(Math.min.apply(null, frets) >= minFret,
          `${scaleKey}/${rootPc} reached fret ${Math.min.apply(null, frets)} under minFret ${minFret}`);
      }
    }
  }
});

test('every box the ladder can pose clears fret 0, on every rung', () => {
  // The stage the player actually meets: whatever key, whatever chord,
  // whatever position the rung allows, no note of the shape is an open string.
  for (let i = 0; i < S.STAGES.length; i++) {
    const st = S.STAGES[i];
    for (const mode of st.modes) {
      for (const keyPc of (st.roots || [0,1,2,3,4,5,6,7,8,9,10,11])) {
        for (const pick of [0, 0.5, 0.99]) {
          const p = S.progression({ keyPc, mode, power: st.power }, () => pick);
          for (const ch of p.chords) {
            for (const si of st.strings) {
              const a = S.anchorFor({ rootPc: ch.rootPc, scaleKey: ch.scaleKey,
                tuning: FIVE, anchorStrings: [si], minFret: st.minFret, maxFret: st.maxFret });
              if (!a) continue;
              const frets = S.boxShape({ scaleKey: ch.scaleKey, si: a.si, fret: a.fret,
                tuning: FIVE }).map(t => t.fret);
              assert.ok(Math.min.apply(null, frets) >= 1,
                `stage ${i + 1}: ${ch.symbol} on string ${si} sits on fret ` +
                Math.min.apply(null, frets));
            }
          }
        }
      }
    }
  }
});

/* ================= judging a run =================
   Six notes, in order. A wrong note parks the run on that step and you
   try again — the run survives, the first-try credit does not. */

test('playing the box in order finishes the run', () => {
  const box = S.boxShape({ scaleKey: 'minPent', si: 1, fret: 5, tuning: FIVE });
  const run = S.createScaleRun(box);
  const seen = box.slice(0, 5).map(t => run.push(t.midi).status);
  assert.deepEqual(seen, ['advanced', 'advanced', 'advanced', 'advanced', 'advanced']);
  assert.equal(run.push(box[5].midi).status, 'done');
  assert.equal(run.result().clean, true, 'no wrong note was played');
});

test('a wrong note parks the run on that step — you lose the credit, not the run', () => {
  const box = S.boxShape({ scaleKey: 'minPent', si: 1, fret: 5, tuning: FIVE });
  const run = S.createScaleRun(box);
  run.push(box[0].midi);
  const miss = run.push(box[3].midi);            // skipped ahead — wrong
  assert.equal(miss.status, 'retry');
  assert.equal(run.index(), 1, 'the run waits on the note that was missed');
  assert.equal(run.push(box[1].midi).status, 'advanced', 'and accepts it next try');
  assert.equal(run.result().clean, false, 'but the run is no longer clean');
});

test('the right note in the wrong octave is a miss like any other', () => {
  // The box is a specific fingering; playing it twelve frets away is a
  // different shape, so the run does not accept it.
  const box = S.boxShape({ scaleKey: 'minPent', si: 1, fret: 5, tuning: FIVE });
  const run = S.createScaleRun(box);
  assert.equal(run.push(box[0].midi + 12).status, 'retry');
  assert.equal(run.push(box[0].midi - 12).status, 'retry');
  assert.equal(run.index(), 0, 'still waiting on the first note');
});

test('a box always rises in pitch — the run can be judged as an ascent', () => {
  for (const scaleKey of ['minPent', 'majPent']) {
    for (let si = 0; si <= 2; si++) {
      for (let fret = 1; fret <= 9; fret++) {
        const midis = S.boxShape({ scaleKey, si, fret, tuning: FIVE }).map(t => t.midi);
        for (let i = 1; i < midis.length; i++) {
          assert.ok(midis[i] > midis[i - 1],
            `${scaleKey} at ${si}/${fret} does not rise: ${midis.join(',')}`);
        }
      }
    }
  }
});

/* ================= the fingering =================
   The box is one finger per fret, so the finger a note wants is decided by
   the shape alone — the study card draws these numbers, and they must be the
   same numbers whatever fret the shape has slid to. */

test('the box names a finger per note — one finger per fret, index at the low end', () => {
  // The minor pentatonic box is the index/pinky, index/ring, index/ring shape
  // every bassist is taught; the major pentatonic box starts on the middle
  // finger, because its second note sits a fret BELOW the anchor's string.
  assert.deepEqual(S.boxFingers('minPent'), [1, 4, 1, 3, 1, 3]);
  assert.deepEqual(S.boxFingers('majPent'), [2, 4, 1, 4, 1, 4]);
  assert.deepEqual(S.boxFingers('nope'), []);
});

test('fingers never leave the hand — 1 to 4, and they follow the frets', () => {
  for (const scaleKey of ['minPent', 'majPent']) {
    const fingers = S.boxFingers(scaleKey);
    const box = S.boxShape({ scaleKey, si: 1, fret: 5, tuning: FIVE });
    assert.equal(fingers.length, box.length);
    const lowest = Math.min.apply(null, box.map(t => t.fret));
    box.forEach((t, i) => {
      assert.ok(fingers[i] >= 1 && fingers[i] <= 4, `${scaleKey} wants finger ${fingers[i]}`);
      assert.equal(fingers[i], t.fret - lowest + 1,
        `${scaleKey} note ${i} is not one finger per fret`);
    });
  }
});

/* ================= how long a run is =================
   A run is the box played in an order. Low stages go up only; a later stage
   asks for it descending, and the last one asks for both. */

test('an ascending run is simply the box', () => {
  const spec = { scaleKey: 'minPent', si: 1, fret: 5, tuning: FIVE };
  assert.deepEqual(S.runTargets(Object.assign({ shape: 'up' }, spec)),
                   S.boxShape(spec));
  // No shape named is the same promise as 'up' — a caller that forgets must
  // not get a run that plays backwards.
  assert.deepEqual(S.runTargets(spec), S.boxShape(spec));
});

test('a descending run is the same six notes, top down', () => {
  const spec = { scaleKey: 'minPent', si: 1, fret: 5, tuning: FIVE };
  const down = S.runTargets(Object.assign({ shape: 'down' }, spec));
  assert.equal(down.length, 6);
  assert.deepEqual(down.map(t => t.midi), S.boxShape(spec).map(t => t.midi).reverse());
  for (let i = 1; i < down.length; i++) {
    assert.ok(down[i].midi < down[i - 1].midi, 'a descending run must fall');
  }
});

test('up-and-back turns at the top and never plays the turn twice', () => {
  const spec = { scaleKey: 'majPent', si: 1, fret: 8, tuning: FIVE };
  const box = S.boxShape(spec);
  const both = S.runTargets(Object.assign({ shape: 'updown' }, spec));
  assert.equal(both.length, 11, 'six up, five back');
  assert.deepEqual(both.slice(0, 6).map(t => t.midi), box.map(t => t.midi));
  assert.deepEqual(both.slice(6).map(t => t.midi),
                   box.slice(0, 5).map(t => t.midi).reverse());
  assert.notEqual(both[5].midi, both[6].midi, 'the top note is not repeated');
  assert.equal(both[both.length - 1].midi, box[0].midi, 'it comes home to the root');
});

test('a run of any shape is still judged one note at a time', () => {
  // The run judge does not know or care which shape built the list — it is
  // the same park-and-retry either way.
  const targets = S.runTargets({ scaleKey: 'minPent', si: 1, fret: 5,
                                 tuning: FIVE, shape: 'updown' });
  const run = S.createScaleRun(targets);
  for (let i = 0; i < targets.length - 1; i++) assert.equal(run.push(targets[i].midi).status, 'advanced');
  assert.equal(run.push(targets[targets.length - 1].midi).status, 'done');
  assert.equal(run.result().total, 11);
});

/* ================= the stage ladder =================
   Five stages, one table: what the chords are allowed to be, how much neck
   the box may use, and which direction the run goes. The game's whole
   difficulty curve is this table, so it is tested rather than trusted. */

test('the ladder is five stages, and asking past the ends is safe', () => {
  assert.equal(S.STAGES.length, 5);
  assert.equal(S.stage(-3), S.STAGES[0]);
  assert.equal(S.stage(99), S.STAGES[4]);
  assert.equal(S.stage(2), S.STAGES[2]);
});

test('the ladder starts on one shape and one root, then opens up', () => {
  const [one, two, three] = S.STAGES;
  assert.deepEqual(one.scales, ['minPent'], 'stage 1 is the one box');
  assert.equal(one.vamp, true, 'stage 1 stays on the key chord');
  assert.equal(two.vamp, false, 'stage 2 moves the same shape around the loop');
  assert.deepEqual(two.scales, ['minPent'], 'stage 2 is still all minor');
  assert.ok(three.scales.indexOf('majPent') >= 0, 'the major box joins at stage 3');
  // …and once it has joined it never leaves.
  for (const st of S.STAGES.slice(2)) assert.ok(st.scales.indexOf('majPent') >= 0);
});

test('the ladder never takes neck away as it climbs', () => {
  for (let i = 1; i < S.STAGES.length; i++) {
    const prev = S.STAGES[i - 1], st = S.STAGES[i];
    assert.ok(st.maxFret >= prev.maxFret, `stage ${i + 1} lost frets`);
    assert.ok(st.strings.length >= prev.strings.length, `stage ${i + 1} lost strings`);
    for (const si of prev.strings) assert.ok(st.strings.indexOf(si) >= 0);
    for (const m of prev.modes) assert.ok(st.modes.indexOf(m) >= 0);
  }
});

test('the run only turns around once the box is known — and ascending never leaves', () => {
  // Up only at the bottom of the ladder; coming down is its own rung, and it
  // ADDS to going up rather than replacing it for a whole stage; the last rung
  // asks for both in one breath.
  const shapes = S.STAGES.map(st => st.shapes);
  assert.deepEqual(shapes.slice(0, 3), [['up'], ['up'], ['up']]);
  assert.ok(shapes[3].indexOf('down') >= 0, 'stage 4 never brings the box down');
  assert.ok(shapes[3].indexOf('up') >= 0, 'stage 4 deleted ascending for a whole rung');
  assert.ok(shapes[4].indexOf('updown') >= 0, 'stage 5 is not up and back');
  for (const st of S.STAGES) {
    assert.ok(st.shapes.length, st.name + ' has no run shapes');
    for (const s of st.shapes) assert.ok(S.RUN_SHAPES.indexOf(s) >= 0, 'unknown run shape: ' + s);
    // Every rung still names ONE default shape, for anything reading the table.
    assert.equal(st.shape, st.shapes[0]);
  }
});

test('stage 4 adds one thing and stage 5 adds the other', () => {
  const [, , three, four, five] = S.STAGES;
  // 4 is "the box comes down": the neck, the keys and the positions are
  // exactly stage 3's, so the only new thing is the direction.
  assert.deepEqual(four.strings, three.strings, 'stage 4 moved the neck as well');
  assert.deepEqual(four.modes, three.modes, 'stage 4 changed the keys as well');
  assert.equal(four.positions, three.positions, 'stage 4 moved the box as well');
  // 5 is "more positions, more keys".
  assert.ok(five.strings.length > four.strings.length, 'stage 5 opens no new strings');
  assert.ok(five.modes.length > four.modes.length, 'stage 5 opens no new keys');
  assert.equal(five.positions, 'any');
});

/* ================= the power-chord rungs =================
   A fingering drill is fine; a fingering drill dressed as a chart is not.
   With power chords the game grades the minor pentatonic of EVERY root, so
   the loop has to be the one whose per-root minor pentatonics are all
   diatonic — otherwise the graded answer contradicts the chart on screen. */

test('a power-chord loop is i-iv-i-v, and every box it asks for is in the key', () => {
  for (let keyPc = 0; keyPc < 12; keyPc++) {
    for (const pick of [0, 0.5, 0.99]) {
      const p = S.progression({ keyPc, mode: 'minor', power: true }, () => pick);
      assert.equal(p.name, 'i-iv-i-v', 'a power loop is not the parallel-safe one');
      assert.ok(p.power, 'the progression does not know it is a power loop');
      // The natural minor of the key: every note the chart implies.
      const inKey = new Set([0, 2, 3, 5, 7, 8, 10].map(i => (keyPc + i) % 12));
      for (const ch of p.chords) {
        assert.equal(ch.quality, 'power');
        assert.equal(ch.scaleKey, 'minPent');
        // …and the minor pentatonic the game grades over it.
        for (const i of [0, 3, 5, 7, 10]) {
          const n = (ch.rootPc + i) % 12;
          assert.ok(inKey.has(n),
            `${ch.symbol}'s box leaves the key of ${p.key} minor`);
        }
      }
    }
  }
});

test('the first two rungs draw natural-rooted chords only', () => {
  // Stage 1 used to draw all twelve keys — D♯5 and A♯5 included — which is
  // harder than notes-mode stage 1, where sharps do not exist yet.
  const NAT = new Set([0, 2, 4, 5, 7, 9, 11]);
  for (const st of S.STAGES.slice(0, 2)) {
    assert.ok(st.roots && st.roots.length >= 4, st.name + ' has no root list');
    for (const keyPc of st.roots) {
      for (const pick of [0, 0.5, 0.99]) {
        const p = S.progression({ keyPc, mode: 'minor', power: st.power }, () => pick);
        for (const ch of p.chords) {
          assert.ok(NAT.has(ch.rootPc), `${ch.symbol} is not a natural root`);
          assert.match(ch.symbol, /^[A-G]5$/, 'bad early-rung symbol: ' + ch.symbol);
        }
      }
    }
  }
});

/* ================= what a wrong note actually was =================
   One generic sentence covered the two cases that most need teaching: the
   right note in the wrong octave, and a note that IS in the box but later. */

test('a wrong note is classified so the verdict can teach', () => {
  const box = S.boxShape({ scaleKey: 'minPent', si: 1, fret: 5, tuning: FIVE });
  // The top of the box IS the bottom, an octave up.
  const oct = S.missKind({ targets: box, index: 0, midi: box[5].midi });
  assert.equal(oct.kind, 'octave');
  assert.equal(oct.dir, 'high');
  // A note of the box, two steps ahead.
  const ahead = S.missKind({ targets: box, index: 1, midi: box[3].midi });
  assert.equal(ahead.kind, 'inbox');
  assert.equal(ahead.at, 4, 'the played note is note 4 of the run');
  assert.equal(ahead.want, 2, 'the run is waiting on note 2');
  // A note the box has already been through.
  const back = S.missKind({ targets: box, index: 3, midi: box[0].midi });
  assert.equal(back.kind, 'inbox');
  assert.equal(back.at, 1);
  assert.equal(back.want, 4);
  // A genuine outsider.
  assert.equal(S.missKind({ targets: box, index: 0, midi: box[0].midi + 1 }).kind, 'outside');
  // The note it is actually waiting for is not a miss at all.
  assert.equal(S.missKind({ targets: box, index: 0, midi: box[0].midi }), null);
});

test('up-and-back numbers a repeated position by where the run is', () => {
  const targets = S.runTargets({ scaleKey: 'minPent', si: 1, fret: 5,
                                 tuning: FIVE, shape: 'updown' });
  // Note 7 of an up-and-back is the box's fifth note again: playing it while
  // the run waits on note 2 is "in the box", and the nearest reading of it is
  // the one going up.
  const m = S.missKind({ targets, index: 1, midi: targets[4].midi });
  assert.equal(m.kind, 'inbox');
  assert.equal(m.at, 5, 'the nearest occurrence ahead is note 5, not note 7');
});

test('the ladder gets faster as it climbs, and never absurdly so', () => {
  // "Mixed families, FASTER": the last rungs ask for the same shapes with less
  // time on the clock. It may only ever shorten, and never past two thirds —
  // a stage that cannot be finished is not a stage.
  for (let i = 0; i < S.STAGES.length; i++) {
    const f = S.STAGES[i].fuse;
    assert.ok(f > 0.66 && f <= 1, `stage ${i + 1}'s fuse factor is ${f}`);
    if (i) assert.ok(f <= S.STAGES[i - 1].fuse, `stage ${i + 1} gave time back`);
  }
  assert.ok(S.STAGES[4].fuse < S.STAGES[0].fuse, 'the top of the ladder is no faster');
});

test('an anchor is found for every chord of a progression the stage may pose', () => {
  // The game picks a key, then has to place a box for all four chords. A
  // stage whose table cannot host a key it is allowed to choose would strand
  // the player mid-loop, so every stage must fit every key it can be given.
  for (let i = 0; i < S.STAGES.length; i++) {
    const st = S.STAGES[i];
    for (const mode of st.modes) {
      for (const keyPc of (st.roots || [0,1,2,3,4,5,6,7,8,9,10,11])) {
        for (const pick of [0, 0.5, 0.99]) {
          const p = S.progression({ keyPc, mode, power: st.power }, () => pick);
          const anchors = S.anchorChords(p.chords, {
            tuning: FIVE, anchorStrings: st.strings,
            minFret: st.minFret, maxFret: st.maxFret,
          });
          assert.equal(anchors.length, 4);
          anchors.forEach((a, k) => assert.ok(a,
            `stage ${i + 1}: ${p.chords[k].symbol} in ${p.key} ${mode} does not fit`));
        }
      }
    }
  }
});

test('a stage only ever asks for the scales it claims', () => {
  for (let i = 0; i < S.STAGES.length; i++) {
    const st = S.STAGES[i];
    const seen = new Set();
    for (const mode of st.modes)
      for (const keyPc of (st.roots || [0,1,2,3,4,5,6,7,8,9,10,11]))
        for (const pick of [0, 0.5, 0.99]){
          const p = S.progression({ keyPc, mode, power: st.power }, () => pick);
          (st.vamp ? p.chords.slice(0, 1) : p.chords).forEach(ch => seen.add(ch.scaleKey));
        }
    assert.deepEqual([...seen].sort(), st.scales.slice().sort(),
      `stage ${i + 1} claims ${st.scales} but asks ${[...seen]}`);
  }
});
