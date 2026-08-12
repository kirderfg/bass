const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../../shared/drill.js');

// A 5-string bass in BEADG. Open-string MIDI numbers.
const FIVE = { names: ['B', 'E', 'A', 'D', 'G'], midi: [23, 28, 33, 38, 43] };
const E_MIN_PENT = [0, 3, 5, 7, 10];
const E_PC = 4;

/** Positions as [stringName, fret], which is how a bassist reads them. */
function pos(targets) {
  return targets.map(t => [FIVE.names[t.si], t.fret]);
}

test('an ascending scale is generated in the canonical open-position fingering', () => {
  // The standard one-octave open-position E minor pentatonic, as taught:
  // E string open and 3, A string open and 2, D string open and 2.
  const targets = D.sequence({
    tuning: FIVE, intervals: E_MIN_PENT, rootPc: E_PC,
    fromFret: 0, toFret: 5, direction: 'up',
  });
  assert.deepEqual(pos(targets), [['E', 0], ['E', 3], ['A', 0], ['A', 2], ['D', 0], ['D', 2]]);
  assert.deepEqual(targets.map(t => t.degree), ['R', 'b3', '4', '5', 'b7', 'R']);
  // Strictly rising in pitch — a scale that doubles back is a fingering bug.
  for (let i = 1; i < targets.length; i++) {
    assert.ok(targets[i].midi > targets[i - 1].midi, 'pitch must rise');
  }
});

test('descending is its own sequence, not the ascending one read backwards at run time', () => {
  const up = D.sequence({ tuning: FIVE, intervals: E_MIN_PENT, rootPc: E_PC, fromFret: 0, toFret: 5, direction: 'up' });
  const down = D.sequence({ tuning: FIVE, intervals: E_MIN_PENT, rootPc: E_PC, fromFret: 0, toFret: 5, direction: 'down' });
  assert.deepEqual(pos(down), pos(up).slice().reverse());
  for (let i = 1; i < down.length; i++) {
    assert.ok(down[i].midi < down[i - 1].midi, 'pitch must fall');
  }
});

test('an interior window drills the middle of the scale, which is where errors cluster', () => {
  // Serial-position effects: the start and end of a sequence are learned
  // first, the middle last. So the engine must be able to drill just the
  // middle rather than always reaching it mid-rep from the root.
  const up = D.sequence({ tuning: FIVE, intervals: E_MIN_PENT, rootPc: E_PC, fromFret: 0, toFret: 5, direction: 'up' });
  const mid = D.middleWindow(up, 3);
  assert.equal(mid.length, 3);
  assert.deepEqual(pos(mid), [['E', 3], ['A', 0], ['A', 2]]);
  // It must not simply hand back the beginning.
  assert.notDeepEqual(pos(mid), pos(up.slice(0, 3)));
});

test('a scale can be generated from any root in any fret window', () => {
  // G minor pentatonic starting at fret 3 — the moveable box, one octave.
  const g = D.sequence({
    tuning: FIVE, intervals: E_MIN_PENT, rootPc: 7,
    fromFret: 3, toFret: 8, direction: 'up',
  });
  assert.ok(g.length >= 5, 'a pentatonic octave is at least 5 notes');
  assert.equal(g[0].degree, 'R');
  assert.equal(((g[0].midi % 12) + 12) % 12, 7, 'starts on G');
  for (const t of g) {
    assert.ok(t.fret >= 3 && t.fret <= 8, 'every note stays inside the window, got fret ' + t.fret);
  }
});

/* ---------------- the run judge ---------------- */
const FOUR_TARGETS = [
  { si: 1, fret: 0, midi: 28, degree: 'R' },
  { si: 1, fret: 3, midi: 31, degree: 'b3' },
  { si: 2, fret: 0, midi: 33, degree: '4' },
  { si: 2, fret: 2, midi: 35, degree: '5' },
];

test('a run walks the sequence as the right notes arrive', () => {
  const run = D.createRun(FOUR_TARGETS);
  assert.equal(run.expected().midi, 28, 'starts on the first target');
  assert.equal(run.push(28, 0).status, 'advanced');
  assert.equal(run.expected().midi, 31, 'moved on');
  assert.equal(run.push(31, 500).status, 'advanced');
  assert.equal(run.push(33, 1000).status, 'advanced');
  const last = run.push(35, 1500);
  assert.equal(last.status, 'done');
  assert.equal(run.result().passed, true);
});

test('a wrong note halts the run and says where and what, rather than buzzing on', () => {
  // Stop -> localise -> correct is the loop the evidence supports; playing
  // on through an unresolved error just spends reps.
  const run = D.createRun(FOUR_TARGETS);
  run.push(28, 0);
  const bad = run.push(30, 400);            // F#, not the G that was expected
  assert.equal(bad.status, 'error');
  assert.equal(bad.index, 1, 'the error is located at the second note');
  assert.equal(bad.expected.midi, 31);
  assert.equal(bad.played, 30);
  assert.equal(bad.reason, 'wrong-note');

  // Halted: further playing does not quietly resume or score.
  assert.equal(run.push(31, 800).status, 'halted');
  const r = run.result();
  assert.equal(r.passed, false);
  assert.equal(r.errorIndex, 1);
});

test('the right note in the wrong octave is called out as an octave error', () => {
  const run = D.createRun(FOUR_TARGETS);
  const bad = run.push(40, 0);              // E, but an octave above the target
  assert.equal(bad.status, 'error');
  assert.equal(bad.reason, 'wrong-octave',
    'an octave slip is a different mistake from a wrong note and must be taught differently');
});

test('an error produces a short window around the mistake to drill, not the whole scale again', () => {
  // Progressive-part practice: repair the failing segment, then re-run whole.
  const w = D.errorWindow(FOUR_TARGETS, 2, 3);
  assert.equal(w.length, 3);
  assert.ok(w.some(t => t.midi === 33), 'the window must contain the note that was missed');
  // ...and it must be a contiguous run of the original sequence.
  const idx = FOUR_TARGETS.indexOf(w[0]);
  assert.deepEqual(w, FOUR_TARGETS.slice(idx, idx + 3));
});

test('a completed run reports per-note timing, so timing can be scored later', () => {
  const run = D.createRun(FOUR_TARGETS);
  [28, 31, 33, 35].forEach((m, i) => run.push(m, i * 480));
  const r = run.result();
  assert.equal(r.notes.length, 4);
  assert.deepEqual(r.notes.map(n => n.at), [0, 480, 960, 1440]);
  assert.equal(r.elapsedMs, 1440);
});

/* ---------------- the pedagogy rules ---------------- */

test('contextual interference ramps, and a mature item never stays blocked', () => {
  // Learners prefer blocked practice and over-rate it; random retains better.
  // So a new item starts blocked and is promoted out of it on success.
  assert.equal(D.nextCI('blocked', true), 'serial');
  assert.equal(D.nextCI('serial', true), 'random');
  assert.equal(D.nextCI('random', true), 'random', 'random is the steady state');
  // Failure steps back one rung, it does not reset to the beginning.
  assert.equal(D.nextCI('random', false), 'serial');
  assert.equal(D.nextCI('serial', false), 'blocked');
  assert.equal(D.nextCI('blocked', false), 'blocked');
});

test('tempo advances on two clean reps and steps by a percentage, not a fixed 5 bpm', () => {
  // A fixed +5 is a 8% jump at 60bpm and 4% at 120; the step must scale.
  const clean = { passed: true, timingOk: true };
  const messy = { passed: false, timingOk: false };

  assert.equal(D.tempoGate([clean], 60).advance, false, 'one clean rep is not enough');
  const g = D.tempoGate([clean, clean], 60);
  assert.equal(g.advance, true);
  assert.ok(g.nextBpm > 60 && g.nextBpm <= 67, 'roughly 5-10% of 60, got ' + g.nextBpm);

  const fast = D.tempoGate([clean, clean], 120);
  assert.ok(fast.nextBpm - 120 > g.nextBpm - 60, 'the step scales with the tempo');

  assert.equal(D.tempoGate([clean, messy], 60).advance, false, 'the reps must be consecutive');
  // Correct notes but sloppy time is not a pass: the criterion has two parts.
  assert.equal(D.tempoGate([{ passed: true, timingOk: false },
                            { passed: true, timingOk: false }], 60).advance, false);
});

test('review is scheduled in days, expanding on success and stepping back on failure', () => {
  // Day-scale spacing has the evidence; minute-scale spacing has a direct
  // null result in piano learning, so there is deliberately none here.
  const fresh = D.schedule({ box: 0 }, true, '2026-08-12');
  assert.equal(fresh.box, 1);
  assert.equal(fresh.due, '2026-08-13', 'a new item is re-tested the next day, across a sleep');

  let it = { box: 1 };
  it = D.schedule(it, true, '2026-08-13'); assert.equal(it.due, '2026-08-16');   // +3
  it = D.schedule(it, true, '2026-08-16'); assert.equal(it.due, '2026-08-23');   // +7
  it = D.schedule(it, true, '2026-08-23'); assert.equal(it.due, '2026-09-08');   // +16

  const failed = D.schedule({ box: 4 }, false, '2026-09-08');
  assert.ok(failed.box < 4, 'a miss steps back');
  assert.equal(failed.due, '2026-09-09', 'and comes back tomorrow');
});

test('mastery needs a cold pass on two separate days, not fluency inside one session', () => {
  // In-session fluency is exactly what massed practice inflates, so it does
  // not count. Only a first-attempt-of-the-session pass does.
  const warmedUp = [
    { date: '2026-08-12', cold: false, accuracy: 1, timingOk: true, atTargetTempo: true },
    { date: '2026-08-12', cold: false, accuracy: 1, timingOk: true, atTargetTempo: true },
  ];
  assert.equal(D.masteryOf(warmedUp), 'acquired', 'reps after a warm-up are not mastery');

  const oneCold = [{ date: '2026-08-12', cold: true, accuracy: 1, timingOk: true, atTargetTempo: true }];
  assert.equal(D.masteryOf(oneCold), 'acquired', 'one good day is not enough');

  const twoDays = [
    { date: '2026-08-12', cold: true, accuracy: 0.95, timingOk: true, atTargetTempo: true },
    { date: '2026-08-14', cold: true, accuracy: 1, timingOk: true, atTargetTempo: true },
  ];
  assert.equal(D.masteryOf(twoDays), 'mastered');

  const sameDayTwice = [
    { date: '2026-08-12', cold: true, accuracy: 1, timingOk: true, atTargetTempo: true },
    { date: '2026-08-12', cold: true, accuracy: 1, timingOk: true, atTargetTempo: true },
  ];
  assert.equal(D.masteryOf(sameDayTwice), 'acquired', 'two passes in one day is one day');

  assert.equal(D.masteryOf([]), 'new');
  const belowBar = [
    { date: '2026-08-12', cold: true, accuracy: 0.8, timingOk: true, atTargetTempo: true },
    { date: '2026-08-14', cold: true, accuracy: 0.8, timingOk: true, atTargetTempo: true },
  ];
  // 80% is under the bar, so both reps are failures — nothing was achieved,
  // and the item has not progressed past new.
  assert.equal(D.masteryOf(belowBar), 'new', '80% is under the 90% bar');
});

test('a drill that has only been failed is not reported as acquired', () => {
  // "Acquired" must mean something was achieved. An item with nothing but
  // failed reps behind it is still new, not part-learned.
  const onlyFailures = [
    { date: '2026-08-12', cold: true, accuracy: 0.4, timingOk: false, atTargetTempo: true },
    { date: '2026-08-12', cold: false, accuracy: 0.6, timingOk: false, atTargetTempo: true },
  ];
  assert.equal(D.masteryOf(onlyFailures), 'new');

  // One good cold day IS progress.
  assert.equal(D.masteryOf([
    { date: '2026-08-12', cold: true, accuracy: 1, timingOk: true, atTargetTempo: true },
  ]), 'acquired');

  // So is a clean rep that was not cold — you can do it, just not from cold.
  assert.equal(D.masteryOf([
    { date: '2026-08-12', cold: false, accuracy: 1, timingOk: true, atTargetTempo: true },
  ]), 'acquired');
});
