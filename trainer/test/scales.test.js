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
    assert.match(ch.symbol, /^[A-G][#b]?(m|m7|5)?$/, `bad symbol: ${ch.symbol}`);
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

test('the run only turns around once the box is known', () => {
  // Up only at the bottom of the ladder; descending unlocks later; and the
  // last stage asks for both directions in one run.
  const shapes = S.STAGES.map(st => st.shape);
  assert.deepEqual(shapes.slice(0, 3), ['up', 'up', 'up']);
  assert.ok(S.RUN_SHAPES.indexOf(shapes[3]) > 0, 'stage 4 stops going up only');
  assert.equal(shapes[4], 'updown', 'stage 5 is up and back');
  for (const s of shapes) assert.ok(S.RUN_SHAPES.indexOf(s) >= 0, 'unknown run shape: ' + s);
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
      for (let keyPc = 0; keyPc < 12; keyPc++) {
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
      for (let keyPc = 0; keyPc < 12; keyPc++)
        for (const pick of [0, 0.5, 0.99]){
          const p = S.progression({ keyPc, mode, power: st.power }, () => pick);
          (st.vamp ? p.chords.slice(0, 1) : p.chords).forEach(ch => seen.add(ch.scaleKey));
        }
    assert.deepEqual([...seen].sort(), st.scales.slice().sort(),
      `stage ${i + 1} claims ${st.scales} but asks ${[...seen]}`);
  }
});
