/* Unit tests for the Fret Quest game rules: staff geometry, the adaptive
   picker, and the run arithmetic (combo, XP, hearts). Pure Node — the pixel
   rendering is exercised by the e2e suite, the RULES are exercised here. */
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../../shared/game.js');

/* ================= bass-clef staff geometry ================= */

test('the open strings land where a bass method book puts them', () => {
  // Bass guitar is written an octave above where it sounds. On that staff:
  // open E = first ledger line below, open A = bottom space, open D = middle
  // line, open G = top space. These four are the anchors every tutor teaches.
  assert.equal(G.staffSpec(28).pos, -2, 'open E sits on the first ledger line below');
  assert.equal(G.staffSpec(33).pos, 1, 'open A sits in the bottom space');
  assert.equal(G.staffSpec(38).pos, 4, 'open D sits on the middle line');
  assert.equal(G.staffSpec(43).pos, 7, 'open G sits in the top space');
  // Even = line, odd = space; the E must be ON its ledger line.
  assert.deepEqual(G.staffSpec(28).ledgers, [-2], 'open E needs exactly its own ledger line');
});

test('the low B hangs below two ledger lines', () => {
  const b = G.staffSpec(23);
  assert.equal(b.letter, 'B');
  assert.equal(b.pos, -5);
  assert.deepEqual(b.ledgers, [-2, -4], 'ledger lines at written E2 and C2');
});

test('the G string at fret 12 sits on the third ledger line above', () => {
  const g = G.staffSpec(55);
  assert.equal(g.letter, 'G');
  assert.equal(g.pos, 14);
  assert.deepEqual(g.ledgers, [10, 12, 14]);
});

test('sharps keep the natural letter position and carry the accidental', () => {
  // F# on the E string (fret 2, midi 30): same staff position as F, acc '#'.
  const fSharp = G.staffSpec(30);
  const f = G.staffSpec(29);
  assert.equal(fSharp.acc, '#');
  assert.equal(fSharp.pos, f.pos, 'F and F# share a staff position');
  assert.equal(G.staffSpec(28).acc, null, 'naturals carry no accidental');
});

test('every note in the app\'s range is drawable: at most three ledger lines', () => {
  for (let midi = 23; midi <= 55; midi++) {
    const s = G.staffSpec(midi);
    assert.ok(s.ledgers.length <= 3, `midi ${midi} wants ${s.ledgers.length} ledger lines`);
    assert.ok(s.pos >= -5 && s.pos <= 14, `midi ${midi} at position ${s.pos} is off the panel`);
  }
});

/* ================= adaptive picker ================= */

const POOL = [
  { sn: 'E', f: 0 }, { sn: 'E', f: 3 }, { sn: 'A', f: 2 }, { sn: 'A', f: 5 },
];
/** A deterministic "random" stream for exercising the weighted roll. */
function seq(values) { let i = 0; return () => values[i++ % values.length]; }

test('a note that keeps being missed comes back more often than one being nailed', () => {
  const view = key => key === 'E:3'
    ? { tries: 6, recent: [0, 0, 0, 0, 0, 0] }     // always missed
    : { tries: 6, recent: [1, 1, 1, 1, 1, 1] };    // always clean
  const counts = {};
  // Sweep the whole roll space evenly; the weights decide the shares.
  for (let i = 0; i < 1000; i++) {
    const p = G.weightedPick(POOL, view, null, () => i / 1000);
    const k = p.sn + ':' + p.f;
    counts[k] = (counts[k] || 0) + 1;
  }
  assert.ok(counts['E:3'] > counts['E:0'] * 3,
    `missed note drawn ${counts['E:3']}, mastered ${counts['E:0']} — should be a strong bias`);
});

test('three clean answers in a row park a note, but never remove it', () => {
  const parked = G.weightFor({ tries: 3, recent: [1, 1, 1] }, false);
  const fresh = G.weightFor({ tries: 3, recent: [1, 0, 1] }, false);
  assert.ok(parked < fresh, 'a parked note must fade back');
  assert.ok(parked > 0, 'but never to zero — memory decays');
});

test('a note never asked before gets a boost over the long-since-mastered', () => {
  const unseen = G.weightFor(null, false);
  const mastered = G.weightFor({ tries: 9, recent: [1, 1, 1, 1, 1, 1] }, false);
  assert.ok(unseen > mastered);
});

test('the note just asked is strongly avoided but a one-note pool still works', () => {
  const view = () => ({ tries: 1, recent: [1] });
  // Sweep the roll space: the repeat's share of draws must collapse.
  let repeats = 0;
  for (let i = 0; i < 1000; i++) {
    const p = G.weightedPick(POOL, view, 'E:0', () => i / 1000);
    if (p.sn + ':' + p.f === 'E:0') repeats++;
  }
  assert.ok(repeats < 100, `the just-asked note took ${repeats}/1000 draws`);
  assert.ok(repeats > 0, 'avoided, not banned — it must still be possible');
  const only = [{ sn: 'G', f: 5 }];
  assert.deepEqual(G.weightedPick(only, view, 'G:5', seq([0.5])), only[0],
    'a single-note pool must still yield its note');
});

/* ================= run arithmetic ================= */

test('a clean streak builds combo and pays rising XP', () => {
  const run = G.createRun({ pace: 'chill' });
  const first = run.judge('clean');
  const second = run.judge('clean');
  const third = run.judge('clean');
  assert.equal(first.gain, 10);
  assert.equal(second.gain, 12);
  assert.equal(third.gain, 14);
  assert.equal(third.combo, 3);
  assert.equal(run.state.zaps, 3);
});

test('a wrong note breaks the combo; the eventual find pays a little, not nothing', () => {
  const run = G.createRun({ pace: 'chill' });
  run.judge('clean');
  const miss = run.judge('wrong');
  assert.equal(miss.combo, 0, 'combo breaks on a miss');
  const dirty = run.judge('dirty');
  assert.equal(dirty.gain, 4, 'hunting still earns a taste of XP');
  assert.equal(dirty.combo, 0, 'but no combo credit');
});

test('chill pace can never end the run, however badly it goes', () => {
  const run = G.createRun({ pace: 'chill' });
  for (let i = 0; i < 50; i++) run.judge('breach');
  assert.equal(run.state.over, false);
  assert.equal(run.state.hearts, null, 'chill has no hearts to lose');
});

test('in a timed pace only a breach costs a heart, and the third ends the run', () => {
  const run = G.createRun({ pace: 'steady' });
  run.judge('wrong'); run.judge('wrong');
  assert.equal(run.state.hearts, 3, 'wrong notes are the hunt, not the loss');
  run.judge('breach');
  run.judge('breach');
  const last = run.judge('breach');
  assert.equal(last.hearts, 0);
  assert.equal(last.over, true);
  assert.deepEqual(run.judge('clean').ignored, true, 'a finished run judges nothing more');
});

test('levels rise with XP and report the moment they turn over', () => {
  const run = G.createRun({ pace: 'chill', xp: G.XP_PER_LEVEL - 5 });
  const r = run.judge('clean');
  assert.equal(r.leveled, true, 'crossing the boundary must announce itself');
  assert.equal(r.level, 2);
  assert.equal(G.levelTitle(1), 'Fret Rookie');
  assert.equal(G.levelTitle(999), 'Bass Legend', 'titles clamp at the top');
  const prog = G.levelProgress(G.XP_PER_LEVEL + 30);
  assert.equal(prog.into, 30);
});

test('turbo gives less time than steady, speeds up with level, and floors sanely', () => {
  assert.ok(G.approachMs('turbo', 1) < G.approachMs('steady', 1));
  assert.ok(G.approachMs('turbo', 5) < G.approachMs('turbo', 1));
  assert.ok(G.approachMs('turbo', 99) >= 4500, 'never becomes unplayable');
  assert.equal(G.approachMs('chill', 1), null, 'chill has no clock at all');
});

test('mixed prompts flip between staff and names; fixed modes never do', () => {
  assert.equal(G.resolvePrompt('mix', () => 0.2), 'staff');
  assert.equal(G.resolvePrompt('mix', () => 0.8), 'name');
  assert.equal(G.resolvePrompt('name', () => 0.2), 'name');
  assert.equal(G.resolvePrompt('staff', () => 0.8), 'staff');
});
