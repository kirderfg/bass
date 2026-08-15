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

test('six clean answers park a note much deeper than three, but never to zero', () => {
  const deep = G.weightFor({ tries: 6, recent: [1, 1, 1, 1, 1, 1] }, false);
  const parked = G.weightFor({ tries: 3, recent: [1, 1, 1] }, false);
  assert.ok(deep < parked, 'six straight cleans must fade further than three');
  assert.ok(deep > 0, 'but the note stays in the pool — memory decays');
});

test('in a fully-parked pool, the one missed note dominates the draws', () => {
  // 65 positions, all long-since mastered, except one missed six straight:
  // that one must be what the session is spent on.
  const pool = [];
  for (let f = 0; f <= 12; f++) for (const sn of ['B', 'E', 'A', 'D', 'G'])
    pool.push({ sn, f });
  const view = key => key === 'A:5'
    ? { tries: 6, recent: [0, 0, 0, 0, 0, 0] }
    : { tries: 9, recent: [1, 1, 1, 1, 1, 1] };
  let hits = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const p = G.weightedPick(pool, view, null, () => i / N);
    if (p.sn + ':' + p.f === 'A:5') hits++;
  }
  assert.ok(hits >= N * 0.25,
    `the missed note took ${hits}/${N} draws — parked notes are not fading enough`);
});

/* ================= review queue ================= */

test('a missed note comes back within 3-8 draws, and never back-to-back', () => {
  const rq = G.createReviewQueue(() => 0.5);        // due = now + 3 + 2
  rq.add('E:3', 10);
  assert.equal(rq.next(11, null), null, 'not due yet');
  assert.equal(rq.next(14, null), null, 'still one short');
  assert.equal(rq.next(15, 'E:3'), null, 'never the question just asked');
  assert.equal(rq.next(15, null), 'E:3', 'due and served');
});

test('a served key is revisited a second time later, then retired', () => {
  const rq = G.createReviewQueue(() => 0);          // first: +3, second: +8
  rq.add('A:2', 0);
  assert.equal(rq.next(3, null), 'A:2', 'first revisit at +3');
  assert.equal(rq.next(4, null), null, 'the second revisit is booked ~8-14 later');
  assert.equal(rq.next(11, null), 'A:2', 'second revisit at +8');
  assert.equal(rq.next(30, null), null, 'two revisits and the key retires');
  assert.equal(rq.size, 0);
});

test('keys absent from the pool are skipped without loss', () => {
  const rq = G.createReviewQueue(() => 0);
  rq.add('B:9', 0);                                 // tier shrank: B left the pool
  rq.add('E:1', 0);
  const inPool = k => k !== 'B:9';
  assert.equal(rq.next(5, null, inPool), 'E:1', 'the in-pool key is served');
  assert.equal(rq.next(6, null, inPool), null, 'the absent key is not forced out');
  assert.equal(rq.next(20, null), 'B:9', 'and it is still there when the pool grows back');
});

test('re-adding a scheduled key keeps its original slot', () => {
  const rq = G.createReviewQueue(() => 0);
  rq.add('E:3', 0);                                 // due at 3
  rq.add('E:3', 100);                               // missed again before served
  assert.equal(rq.next(3, null), 'E:3', 'the first booking stands');
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

test('a difficulty multiplier scales the XP gain but never hearts or combo', () => {
  const flat = G.createRun({ pace: 'steady' });
  const boosted = G.createRun({ pace: 'steady' });
  const a = flat.judge('clean');
  const b = boosted.judge('clean', 1.5);
  assert.ok(b.gain > a.gain, `judge('clean', 1.5) paid ${b.gain} vs ${a.gain} plain`);
  assert.equal(b.gain, Math.round(a.gain * 1.5), 'the gain is the base rounded up by the multiplier');
  assert.equal(b.combo, a.combo, 'combo is game state, not a payout');
  const breach = boosted.judge('breach', 1.5);
  assert.equal(breach.hearts, 2, 'a multiplied breach still costs exactly one stage light');
  assert.equal(boosted.judge('dirty', 1.5).gain, 6, 'dirty pays 4 × 1.5 = 6');
});

test('levels rise with XP and report the moment they turn over', () => {
  // The L1→L2 boundary still sits at 120 XP, curve or no curve.
  const run = G.createRun({ pace: 'chill', xp: G.XP_PER_LEVEL - 5 });
  const r = run.judge('clean');
  assert.equal(r.leveled, true, 'crossing the boundary must announce itself');
  assert.equal(r.level, 2);
  assert.equal(G.levelTitle(1), 'Garage Roadie');
  assert.equal(G.levelTitle(999), 'Thunderstruck', 'titles clamp at the top');
  const prog = G.levelProgress(G.XP_PER_LEVEL + 30);
  assert.equal(prog.into, 30, '30 XP into level 2');
});

test('the level curve rises: each level costs 40 XP more than the last', () => {
  // Level n costs 120 + 40×(n−1): L2 at 120 total, L3 at 280, L4 at 480…
  assert.equal(G.levelFor(0), 1);
  assert.equal(G.levelFor(119), 1);
  assert.equal(G.levelFor(120), 2, 'L2 opens at 120');
  assert.equal(G.levelFor(279), 2);
  assert.equal(G.levelFor(280), 3, 'L3 opens at 280 (120 + 160)');
  assert.equal(G.levelFor(479), 3);
  assert.equal(G.levelFor(480), 4, 'L4 opens at 480 (120 + 160 + 200)');
  assert.equal(G.XP_PER_LEVEL, 120, 'the exported constant is the first span');
});

test('levelProgress reports the CURRENT level\'s span, not a flat rate', () => {
  const l1 = G.levelProgress(60);
  assert.deepEqual({ into: l1.into, span: l1.span }, { into: 60, span: 120 });
  assert.ok(Math.abs(l1.frac - 0.5) < 1e-9, 'halfway through level 1');
  const l2 = G.levelProgress(280 - 1);
  assert.deepEqual({ into: l2.into, span: l2.span }, { into: 159, span: 160 },
    'one XP short of L3 is 159 into a 160 span');
  const l3 = G.levelProgress(280);
  assert.deepEqual({ into: l3.into, span: l3.span }, { into: 0, span: 200 },
    'a fresh L3 starts a 200-XP span');
  assert.equal(G.levelProgress(-5).into, 0, 'negative XP clamps sanely');
});

test('an assisted find (the reveal hint) pays nothing and breaks the combo', () => {
  const run = G.createRun({ pace: 'steady' });
  run.judge('clean'); run.judge('clean');
  const r = run.judge('assisted', 1.5);
  assert.equal(r.gain, 0, 'a shown answer earns no XP, whatever the multiplier');
  assert.equal(r.combo, 0, 'the combo goes — it was not a recall');
  assert.equal(r.hearts, 3, 'but the stage lights are untouched');
  assert.equal(run.state.zaps, 2, 'a shown answer is not a note nailed');
  assert.equal(r.over, false);
  // …and 'dirty' still pays its taste of XP and its zap, unlike 'assisted'.
  const d = run.judge('dirty');
  assert.equal(d.gain, 4);
  assert.equal(run.state.zaps, 3);
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
