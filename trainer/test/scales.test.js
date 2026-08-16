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
