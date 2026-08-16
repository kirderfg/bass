/* End-to-end tests for SCALE MODE — the second game on the Find-it console.
   The rules themselves are unit-tested in scales.test.js; what is tested here
   is the console: that the chord is the whole question (and the scale is never
   named until the answer is given away), that a run advances, parks and
   completes as one question, that the fuse burning out teaches the shape, that
   the mode strip switches and remembers, that the console holds ONE height and
   never scrolls, and that the scale card studies the same box the game grades.

   Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp, until } = require('./harness.js');

const SILENT = 987.767;            // above the detector's 420 Hz ceiling
const DESK = { width: 1280, height: 800 };

/** Open Find-it, past the mic gate, with scale mode on. */
async function openScales(vp) {
  const app = await openApp(SILENT, '/index.html#find', vp || DESK);
  await app.page.click('#startBtn');
  await app.page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
  await app.page.waitForTimeout(300);
  await app.page.evaluate(() =>
    document.querySelector('#gvModes button[data-gm="scales"]').click());
  await app.page.waitForTimeout(250);
  return app;
}
/** Play the next `n` notes the run is waiting for, straight into the judge.
    (The synthetic microphone can hold one pitch; a run needs six.) */
const playRun = (page, n) => page.evaluate((k) => {
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  for (let i = 0; i < k; i++) {
    const t = SC.run.expected();
    if (!t) break;
    onStableNote({ midi: t.midi, hz: hz(t.midi), cents: 0 });
  }
}, n);
/** Play one note that is NOT what the run wants. */
const playWrong = (page) => page.evaluate(() => {
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const want = SC.run.expected().midi;
  onStableNote({ midi: want + 1, hz: hz(want + 1), cents: 0 });
});
const state = (page) => page.evaluate(() => ({
  q: document.getElementById('fQ').textContent.trim(),
  sub: document.getElementById('fSub').textContent.trim(),
  verdict: document.getElementById('fVerdict').textContent.trim(),
  live: document.getElementById('gvLive').textContent.trim(),
  chart: document.getElementById('gvChart').textContent.trim(),
  pips: [...document.querySelectorAll('#gvPips i')].map(i => i.className),
  pipLabel: document.getElementById('gvPips').getAttribute('aria-label'),
  phase: GV.phase,
  symbol: SC.chord.symbol,
  scaleKey: SC.chord.scaleKey,
  landed: SC.run.index(),
  total: SC.targets.length,
  boxShown: !document.getElementById('gvBoxWrap').classList.contains('hidden'),
  chartShown: !document.getElementById('gvChart').classList.contains('hidden'),
  rule: (document.getElementById('gvRule') || {}).textContent,
  pipLive: document.getElementById('gvPipLive').textContent.trim(),
}));
/** Everything the console's promises are made of, in one reflow. */
const PROBE = () => {
  const doc = document.scrollingElement;
  const bot = el => el.getBoundingClientRect().bottom + doc.scrollTop;
  const top = el => el.getBoundingClientRect().top + doc.scrollTop;
  const card = document.querySelector('#secFind .gv-card');
  const navH = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--nav-h')) || 0;
  return {
    cardH: +card.getBoundingClientRect().height.toFixed(1),
    hudTop: top(document.querySelector('#secFind .gv-hud')),
    ctlBot: bot(document.querySelector('#secFind .gv-controls')),
    headBot: document.querySelector('header').getBoundingClientRect().bottom,
    floor: window.innerHeight - navH,
    scrollTop: doc.scrollTop, scrollLeft: doc.scrollLeft,
    docH: doc.scrollHeight, winH: window.innerHeight,
    /* Sideways counts too: the mode strip pans INSIDE itself on a narrow
       phone, and a strip that pushed the page wide instead would be the same
       broken promise in the other axis. */
    overWide: doc.scrollWidth - window.innerWidth,
  };
};
/* Every way a scale can be named on this screen. None of them may appear
   while the question is still open — knowing which scale the chord wants IS
   the question. */
const SCALE_WORDS = /pentatonic|minor scale|major scale|blues|\bminPent\b|\bmajPent\b/i;

test('the question is a chord symbol, and never names the scale', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    for (let i = 0; i < 6; i++) {
      const s = await state(page);
      // The prompt is the symbol itself: "Am7", "A5", "C" — nothing else.
      assert.equal(s.q, s.symbol.replace(/#/g, '♯'),
        'the prompt is not the bare chord symbol: ' + s.q);
      assert.doesNotMatch(s.q, SCALE_WORDS, 'the prompt names the scale');
      assert.doesNotMatch(s.sub, SCALE_WORDS, 'the instruction line names the scale');
      assert.doesNotMatch(s.verdict, SCALE_WORDS, 'the verdict names the scale');
      assert.doesNotMatch(s.chart, SCALE_WORDS, 'the chart names the scale');
      assert.doesNotMatch(s.live, SCALE_WORDS, 'the spoken question names the scale');
      // …and the chord is a chord: a root, an optional accidental, a quality.
      assert.match(s.symbol, /^[A-G][♯♭]?(m|m7|5)?$/, 'bad chord symbol: ' + s.symbol);
      // Next question: play the run out and let it advance.
      await playRun(page, s.total);
      await page.waitForTimeout(1600);
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the chords come from one looping progression, and the key changes when it does', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    // Stage 3 is the first rung that walks a real four-chord loop.
    await page.evaluate(() => {
      const sel = document.getElementById('gvWorld');
      sel.value = '2'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(250);
    const seen = [];
    for (let i = 0; i < 8; i++) {
      seen.push(await page.evaluate(() => ({
        key: SC.prog.keyPc, bar: SC.idx, sym: SC.chord.symbol,
        root: SC.chord.rootPc, scaleKey: SC.chord.scaleKey,
      })));
      const n = await page.evaluate(() => SC.targets.length);
      await playRun(page, n);
      await page.waitForTimeout(1600);
    }
    // Two loops of four bars: bar numbers cycle 1,2,3,4,1,2,3,4…
    assert.deepEqual(seen.map(s => s.bar), [1, 2, 3, 4, 1, 2, 3, 4],
      'the loop does not walk four bars');
    // One key for the whole loop, and a different one for the next.
    assert.equal(new Set(seen.slice(0, 4).map(s => s.key)).size, 1, 'the key changed mid-loop');
    assert.equal(new Set(seen.slice(4).map(s => s.key)).size, 1, 'the key changed mid-loop');
    assert.notEqual(seen[0].key, seen[4].key, 'the same key came round again');
    // The chord decides the scale, every time.
    for (const s of seen) {
      assert.equal(s.scaleKey, /m/.test(s.sym) || /5$/.test(s.sym) ? 'minPent' : 'majPent',
        s.sym + ' asked for ' + s.scaleKey);
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('playing the box in order completes the run and fires the cannon', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    const before = await state(page);
    assert.equal(before.landed, 0);
    assert.equal(before.pips.length, before.total, 'one pip per note of the run');
    assert.match(before.pipLabel, /no notes landed yet/);

    // Note by note: each one fills a pip and says how far in you are.
    for (let i = 1; i <= before.total; i++) {
      await playRun(page, 1);
      await page.waitForTimeout(60);
      const s = await state(page);
      if (i < before.total) {
        assert.equal(s.landed, i, 'the run did not advance on note ' + i);
        assert.equal(s.pips.filter(c => c.includes('on')).length, i,
          'pip ' + i + ' did not fill');
        assert.match(s.verdict, new RegExp('^' + i + ' of ' + before.total),
          'the verdict does not count the notes: ' + s.verdict);
        assert.match(s.pipLabel, new RegExp(i + ' of ' + before.total + ' notes landed'));
      }
    }
    const done = await state(page);
    assert.equal(done.phase, 'zap', 'the cannon did not fire when the run completed');
    assert.match(done.verdict, /FIRE!/, 'a clean run is not celebrated: ' + done.verdict);
    assert.match(done.live, /run complete/i, 'the outcome was not announced');
    assert.doesNotMatch(done.verdict, SCALE_WORDS, 'the completion names the scale');
    // One run is ONE question, and a clean one pays more than a note question.
    const banked = await page.evaluate(() => ({
      xp: GV.xp, zaps: GV.run.state.zaps, combo: GV.run.state.combo,
      asked: document.getElementById('fAsked').textContent,
      clean: document.getElementById('fClean').textContent,
    }));
    assert.equal(banked.zaps, 1, 'a six-note run counted as more than one question');
    assert.equal(banked.asked, '1');
    assert.equal(banked.clean, '1');
    assert.ok(banked.xp >= 30, 'a six-note run paid only ' + banked.xp + ' XP');
    // …and the next chord arrives on its own.
    await page.waitForTimeout(1700);
    const next = await state(page);
    assert.equal(next.landed, 0, 'the next run did not start fresh');
    assert.equal(next.phase, 'fight');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a wrong note parks the run — it retries, it does not restart or advance', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    await playRun(page, 2);
    await page.waitForTimeout(80);
    const before = await state(page);
    assert.equal(before.landed, 2);

    await playWrong(page);
    await page.waitForTimeout(80);
    const after = await state(page);
    assert.equal(after.landed, 2, 'a wrong note moved the run');
    assert.equal(after.phase, 'fight', 'a wrong note ended the question');
    assert.match(after.verdict, /Still on note 3 of/, 'the verdict: ' + after.verdict);
    assert.doesNotMatch(after.verdict, SCALE_WORDS, 'a miss gives the scale away');
    assert.equal(after.pips.filter(c => c.includes('on')).length, 2,
      'a wrong note changed the pips');
    assert.match(after.live, /Wrong note/, 'the miss was not announced');
    // The right note still gets in afterwards, and the run finishes.
    await playRun(page, after.total - 2);
    await page.waitForTimeout(120);
    const done = await state(page);
    assert.equal(done.phase, 'zap', 'the run did not survive the miss');
    assert.doesNotMatch(done.verdict, /FIRE!/, 'a run with a miss claimed a clean run');
    const banked = await page.evaluate(() => ({
      clean: document.getElementById('fClean').textContent,
      found: document.getElementById('fScore').textContent,
      asked: document.getElementById('fAsked').textContent,
    }));
    assert.equal(banked.found, '1', 'the run was not counted as found');
    assert.equal(banked.clean, '0', 'a run with a miss kept its first-try credit');
    assert.equal(banked.asked, '1', 'one chord was counted as more than one question');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a wrong note is told WHAT it was — three sentences, none of them the answer', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    // 1. THE RIGHT LETTER, WRONG OCTAVE. "I found an A. The bell says A5. The
    //    game says my A isn't it" — the one miss a generic line cannot teach.
    await page.evaluate(() => {
      const hz = m => 440 * Math.pow(2, (m - 69) / 12);
      const want = SC.run.expected().midi + 12;
      onStableNote({ midi: want, hz: hz(want), cents: 0 });
    });
    await page.waitForTimeout(80);
    const oct = await state(page);
    assert.equal(oct.landed, 0, 'an octave out was accepted');
    assert.match(oct.verdict, /Right letter, wrong octave/, 'the verdict: ' + oct.verdict);
    assert.match(oct.verdict, /top of the shape, not the bottom/,
      'the verdict does not say which end of the shape it was: ' + oct.verdict);
    assert.doesNotMatch(oct.verdict, SCALE_WORDS, 'the correction gives the scale away');

    // 2. IN THE SHAPE, BUT LATER. Two steps ahead is a different lesson from a
    //    note the shape does not contain, and it used to get the same line.
    await playRun(page, 1);
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      const hz = m => 440 * Math.pow(2, (m - 69) / 12);
      const midi = SC.targets[3].midi;              // note 4, while it wants 2
      onStableNote({ midi, hz: hz(midi), cents: 0 });
    });
    await page.waitForTimeout(80);
    const ahead = await state(page);
    assert.equal(ahead.landed, 1, 'a note from further up the shape was accepted');
    assert.match(ahead.verdict, /is note 4 of this shape — play note 2 first/,
      'the verdict: ' + ahead.verdict);

    // 3. A GENUINE OUTSIDER keeps the plain line.
    await page.evaluate(() => {
      const hz = m => 440 * Math.pow(2, (m - 69) / 12);
      const box = new Set(SC.targets.map(t => t.midi));
      let midi = SC.run.expected().midi + 1;
      while (box.has(midi) || box.has(midi + 12) || box.has(midi - 12)) midi++;
      onStableNote({ midi, hz: hz(midi), cents: 0 });
    });
    await page.waitForTimeout(80);
    const out = await state(page);
    assert.match(out.verdict, /not one of this shape’s six notes/,
      'the verdict: ' + out.verdict);
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('one fuse covers the whole run, and burning out reveals the scale and the box', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    // A timed pace: the fuse is a Gig/Encore idea.
    await page.evaluate(() => {
      document.getElementById('gvSettings').open = true;
      document.querySelector('#gvPaceSeg button[data-p="steady"]').click();
      document.getElementById('gvSettings').open = false;
    });
    await page.waitForTimeout(250);
    // The fuse is paid per note: a six-note run gets far more than one note does.
    const fuse = await page.evaluate(() => ({
      run: gvFuseMs(), notes: SC.targets.length,
      one: BassGame.approachMs(GV.pace, BassGame.levelFor(GV.xp)),
    }));
    /* A FUSE, not a coffee break. Six notes took 30 seconds on Gig — a box a
       player can play in under two — so the per-note term is small now: a
       six-note run gets one note-question's thinking time plus about half a
       second a note, and the eleven-note run at the top of the ladder stays
       under twice a single note's fuse. */
    assert.ok(fuse.run > fuse.one * 0.7,
      'the run fuse (' + fuse.run + 'ms) is shorter than thinking time');
    assert.ok(fuse.run < fuse.one, 'a six-note run still gets ' + fuse.run + 'ms');
    const long = await page.evaluate(() => {
      GV.scaleTier = 4;
      const targets = SC.targets;
      SC.targets = new Array(11).fill(targets[0]);
      const ms = gvFuseMs();
      SC.targets = targets; GV.scaleTier = 0;
      return ms;
    });
    assert.ok(long > fuse.run, 'an eleven-note run gets no more time than a six-note one');
    assert.ok(long < fuse.one * 1.4, 'the top rung\'s fuse is ' + long + 'ms');

    await playRun(page, 2);
    await page.waitForTimeout(80);
    const hearts = () => page.evaluate(() => GV.run.state.hearts);
    const lit = await hearts();
    // Burn it out where it stands (a real 30s fuse would make this a minute).
    await page.evaluate(() => gvBreach());
    await page.waitForTimeout(200);
    const s = await state(page);
    assert.equal(await hearts(), lit - 1, 'a burnt fuse cost no stage light');
    assert.match(s.verdict, /wants .* pentatonic/, 'the reveal: ' + s.verdict);
    assert.match(s.verdict, /start on the [BEADG] string, fret \d+/,
      'the reveal does not say where the box starts: ' + s.verdict);
    assert.match(s.verdict, /Fuse out at 2 of/, 'the reveal does not say how far it got');
    assert.ok(s.boxShown, 'the box was not drawn');
    assert.ok(!s.chartShown, 'the chart is still up under the reveal');
    assert.match(s.live, /wants .* pentatonic/, 'the reveal was not announced');
    const box = await page.evaluate(() => ({
      label: document.getElementById('gvBox').getAttribute('aria-label'),
      ink: (() => {                       // the canvas actually has pixels on it
        const cv = document.getElementById('gvBox');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      })(),
    }));
    assert.ok(box.ink > 2000, 'the box canvas is blank (' + box.ink + ' painted pixels)');
    assert.match(box.label, /pentatonic/, 'the drawing has no description');
    /* ONE VISUAL LANGUAGE. The number in a dot is the FINGER — here and on
       the study card — and the order lives in the caption under the board,
       where an up-and-back run can say "1 → 6, then back" instead of
       numbering six dots while the pips count eleven. */
    assert.match(box.label, /number on each dot is the finger/,
      'the drawing does not say what its numbers mean: ' + box.label);
    assert.match(box.label, /play them low to high, 1 → 6/,
      'the drawing does not say which way to play it: ' + box.label);
    /* …and it asks THE SAME CHORD again, with the shape still on screen: a
       reveal that teaches for three seconds and then poses something else is
       a lesson nobody got to use. The second ask pays nothing. */
    const was = s.symbol;
    await page.waitForTimeout(3600);
    const next = await state(page);
    assert.equal(next.symbol, was, 'the reveal was followed by a different chord');
    assert.ok(next.boxShown && !next.chartShown, 'the shape was taken away for the second ask');
    assert.equal(next.landed, 0);
    const xpBefore = await page.evaluate(() => GV.xp);
    await playRun(page, next.total);
    await page.waitForTimeout(200);
    const done = await state(page);
    assert.match(done.verdict, /played back/, 'the second ask: ' + done.verdict);
    assert.equal(await page.evaluate(() => GV.xp), xpBefore,
      'the second ask of a chord that was given away paid XP');
    // …and the chart is back for the chord after it.
    await page.waitForTimeout(1600);
    const after = await state(page);
    assert.ok(after.chartShown && !after.boxShown, 'the reveal outstayed its second ask');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('Show me names the scale, draws the box, and costs the streak', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    await playRun(page, 1);
    await page.waitForTimeout(1000);       // land one clean run's worth of streak
    await page.evaluate(() => document.getElementById('fSkip').click());
    await page.waitForTimeout(200);
    const s = await state(page);
    assert.match(s.verdict, /wants .* pentatonic/, 'Show me did not name the scale');
    assert.ok(s.boxShown, 'Show me did not draw the box');
    assert.equal(await page.evaluate(() =>
      document.getElementById('fStreak').textContent), '0', 'Show me kept the streak');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the mode strip switches the game, remembers it, and offers what is coming', async () => {
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(300);
    const strip = () => page.evaluate(() => ({
      group: document.getElementById('gvModes').getAttribute('aria-label'),
      live: [...document.querySelectorAll('#gvModes button[data-gm]')].map(b =>
        ({ m: b.dataset.gm, pressed: b.getAttribute('aria-pressed'),
           h: b.getBoundingClientRect().height })),
      soon: [...document.querySelectorAll('#gvModes button[data-soon]')].map(b =>
        ({ txt: b.textContent.trim(), dis: b.getAttribute('aria-disabled') })),
      scales: document.getElementById('secFind').classList.contains('gv-scales'),
      hasQ: !!window.q, hasRun: !!SC.run,
    }));
    const a = await strip();
    assert.ok(a.group, 'the mode strip has no group label');
    assert.deepEqual(a.live.map(b => b.m), ['notes', 'scales']);
    assert.deepEqual(a.live.map(b => b.pressed), ['true', 'false'], 'Notes is not the default');
    for (const b of a.live) assert.ok(b.h >= 38, 'a mode button is ' + b.h + 'px tall');
    // The roadmap: dim, focusable, and it says so in words rather than in grey.
    assert.deepEqual(a.soon.map(s => s.txt.replace(/\s+/g, ' ')),
      ['Chromatic soon', 'Octaves soon', 'Rhythm soon']);
    for (const s of a.soon) assert.equal(s.dis, 'true', s.txt + ' is not marked unavailable');
    assert.ok(a.hasQ && !a.hasRun, 'notes mode has no note question');

    await page.evaluate(() =>
      document.querySelector('#gvModes button[data-gm="scales"]').click());
    await page.waitForTimeout(250);
    const b = await strip();
    assert.deepEqual(b.live.map(x => x.pressed), ['false', 'true'], 'the strip did not switch');
    assert.ok(b.scales, 'the console is not in scale mode');
    assert.ok(b.hasRun && !b.hasQ, 'scale mode did not pose a run');
    // Pressing a dead entry does nothing at all.
    await page.evaluate(() => document.querySelector('#gvModes button[data-soon]').click());
    await page.waitForTimeout(150);
    assert.ok((await strip()).scales, 'a "soon" button changed the mode');
    // …and the choice survives a reload: it is what you play, not a setting.
    await page.reload();
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(300);
    const c = await strip();
    assert.deepEqual(c.live.map(x => x.pressed), ['false', 'true'], 'the mode was forgotten');
    assert.ok(c.scales && c.hasRun, 'the reload came back in the wrong game');
    // Back to Notes, and the note game is exactly itself again.
    await page.evaluate(() =>
      document.querySelector('#gvModes button[data-gm="notes"]').click());
    await page.waitForTimeout(250);
    const d = await strip();
    assert.ok(!d.scales && d.hasQ, 'switching back did not restore the note game');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('scale mode is one fixed height, on screen, and never scrolls the page', async () => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 1366, height: 768 },
                    { width: 1440, height: 900 }, { width: 380, height: 800 }]) {
    const app = await openScales(vp);
    try {
      const { page } = app;
      const at = vp.width + '×' + vp.height + ': ';
      const seen = [];
      const look = async (s) => seen.push({ s, ...await page.evaluate(PROBE) });
      for (const pace of ['chill', 'steady', 'turbo']) {
        await page.evaluate((p) => {
          document.getElementById('gvSettings').open = true;
          document.querySelector(`#gvPaceSeg button[data-p="${p}"]`).click();
          document.getElementById('gvSettings').open = false;
        }, pace);
        await page.waitForTimeout(200);
        await look(pace + '/fresh');
        await playRun(page, 2);                       // mid-run, pips part filled
        await page.waitForTimeout(80);
        await look(pace + '/mid');
        await playWrong(page);                        // the longest miss verdict
        await page.waitForTimeout(80);
        await look(pace + '/wrong');
        await page.evaluate(() => { lastProgressAt = performance.now() - 60000; });
        await page.waitForTimeout(900);               // the stall nudge
        await look(pace + '/nudge');
        await page.evaluate(() => gvBreach());        // the reveal, with the box drawn
        await page.waitForTimeout(200);
        await look(pace + '/reveal');
        await page.evaluate(() => document.getElementById('gvRestart').click());
        await page.waitForTimeout(150);
      }
      // Every rung of the ladder, including the eleven-note run at the top.
      for (const stage of ['1', '3', '4', '0']) {
        await page.evaluate((v) => {
          const sel = document.getElementById('gvWorld');
          sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, stage);
        await page.waitForTimeout(250);
        await look('stage' + stage);
      }
      for (const m of seen) {
        assert.ok(m.hudTop >= m.headBot - 1, at + m.s + ': the HUD is under the header');
        assert.ok(m.ctlBot <= m.floor, at + m.s +
          `: the console runs past the nav — Show me ends at ${m.ctlBot}, screen ends at ${m.floor}`);
      }
      const hs = [...new Set(seen.map(m => m.cardH))];
      assert.ok(Math.max(...hs) - Math.min(...hs) <= 2,
        at + 'the console changes height between states: ' + hs.join(' / '));
      assert.deepEqual(seen.filter(m => m.scrollTop !== seen[0].scrollTop).map(m => m.s), [],
        at + 'the page scrolled by itself during play');
      assert.deepEqual(seen.filter(m => m.overWide > 1 || m.scrollLeft).map(m => m.s), [],
        at + 'the page can be scrolled sideways in scale mode');
      assert.deepEqual(app.errors, [], 'page errors');
    } finally { await app.close(); }
  }
});

test('scale mode never starts a metronome', async () => {
  // Drills click; the game does not — and a run of six notes is exactly the
  // kind of thing that invites one.
  const app = await openScales();
  try {
    const { page } = app;
    await playRun(page, 3);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => !!MET.timer), false, 'something started a click');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the scale card studies the box the game grades, and the whole neck too', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    const card = () => page.evaluate(() => {
      const host = document.getElementById('gvScBoard');
      const dots = [...host.querySelectorAll('.neck-marker')].map(g => ({
        s: +g.dataset.s, f: +g.dataset.f,
        label: (g.querySelector('.neck-dot-label') || {}).textContent,
        finger: (g.querySelector('.neck-finger') || {}).textContent,
      }));
      return {
        open: document.getElementById('gvScaleStudy').open,
        now: document.getElementById('gvScaleNow').textContent,
        note: document.getElementById('gvScNote').textContent,
        chips: [...document.querySelectorAll('#gvScChips span')].map(s => s.textContent),
        title: (host.querySelector('svg title') || {}).textContent,
        dots,
      };
    });
    await page.evaluate(() => {
      const c = document.getElementById('gvScaleStudy');
      c.open = true; c.dispatchEvent(new Event('toggle'));
      // The card follows the chord on screen; this test is about the DRAWING,
      // so it pins the pick to the one the assertions below describe.
      document.querySelector('#gvScRootSeg button[data-sr="9"]').click();
      document.querySelector('#gvScTypeSeg button[data-st="minPent"]').click();
      document.querySelector('#gvScViewSeg button[data-sv="box"]').click();
    });
    await page.waitForTimeout(300);
    const box = await card();
    assert.ok(box.open);
    assert.match(box.now, /minor pentatonic · box/, 'the summary: ' + box.now);
    // The default pick is A minor pentatonic, whose box the game anchors on the
    // E string at fret 5 — six notes, and a FINGER on every one of them.
    assert.equal(box.dots.length, 6, 'the box view is not the six graded notes');
    assert.deepEqual(box.dots.map(d => [d.s, d.f]),
      [[1, 5], [1, 8], [2, 5], [2, 7], [3, 5], [3, 7]], 'the box is in the wrong place');
    assert.deepEqual(box.dots.map(d => d.finger), ['1', '4', '1', '3', '1', '3'],
      'the box view does not show the fingering');
    assert.deepEqual(box.dots.map(d => d.label), ['A', 'C', 'D', 'E', 'G', 'A'],
      'the dots are not named');
    assert.match(box.note, /finger/, 'nothing says the numbers are fingers');
    assert.match(box.title, /finger number on every note/, 'the board has no description');
    assert.deepEqual(box.chips.map(c => c.replace(/\s/g, '')),
      ['AR', 'C♭3', 'D4', 'E5', 'G♭7'],
      'the chips do not spell the scale: ' + box.chips.join(' '));

    // …and the same shape the game just asked for is the shape on this card.
    const graded = await page.evaluate(() => {
      const t = BassScales.boxShape({ scaleKey: 'minPent', si: 1, fret: 5,
        tuning: { names: ['B', 'E', 'A', 'D', 'G'], midi: [23, 28, 33, 38, 43] } });
      return t.map(x => [x.si, x.fret]);
    });
    assert.deepEqual(box.dots.map(d => [d.s, d.f]), graded,
      'the card draws a different box than the game grades');

    // The whole neck: every occurrence, and degrees instead of names.
    await page.evaluate(() => {
      document.querySelector('#gvScViewSeg button[data-sv="neck"]').click();
      document.querySelector('#gvScLabelSeg button[data-sl="degrees"]').click();
    });
    await page.waitForTimeout(300);
    const neck = await card();
    assert.ok(neck.dots.length > 20,
      'the whole neck shows only ' + neck.dots.length + ' notes');
    assert.ok(neck.dots.every(d => d.finger === undefined),
      'the whole-neck view is claiming a fingering');
    assert.deepEqual([...new Set(neck.dots.map(d => d.label))].sort(),
      ['4', '5', 'R', '♭3', '♭7'].sort(),
      'the degrees: ' + [...new Set(neck.dots.map(d => d.label))]);
    assert.match(neck.now, /whole neck · step numbers/, 'the summary: ' + neck.now);
    // A different root and scale, and the card follows.
    await page.evaluate(() => {
      document.querySelector('#gvScViewSeg button[data-sv="box"]').click();
      document.querySelector('#gvScRootSeg button[data-sr="0"]').click();
      document.querySelector('#gvScTypeSeg button[data-st="majPent"]').click();
    });
    await page.waitForTimeout(300);
    const c = await card();
    assert.match(c.now, /^C major pentatonic · box/, 'the summary: ' + c.now);
    assert.deepEqual(c.dots.map(d => d.finger), ['2', '4', '1', '4', '1', '4'],
      'the major box has the minor box\'s fingering');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= the rule the game tests =================
   Chord-only is the design; a mapping that appears nowhere on the screen is
   not. The route from "I don't know" to "I know" may not be a paid button. */

test('the chord→scale rule is on the screen, permanently, in plain words', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    for (let i = 0; i < 3; i++) {
      const s = await state(page);
      assert.ok(s.rule, 'there is no rule line under the chart');
      assert.match(s.rule, /m7?\b/, 'the rule does not mention the m suffix: ' + s.rule);
      assert.match(s.rule, /minor/, 'the rule never says minor: ' + s.rule);
      assert.match(s.rule, /major/, 'the rule never says major: ' + s.rule);
      // …and it is a RULE, not this chord's answer.
      assert.doesNotMatch(s.rule, new RegExp(s.symbol.replace(/[♯♭]/g, '.') + '\\b'),
        'the rule names the chord on screen: ' + s.rule);
      await playRun(page, s.total);
      await page.waitForTimeout(1600);
    }
    // The word "box" in the instruction line is a real door to the free card —
    // the same door the staff prompt opens for the clef guide.
    const link = await page.evaluate(() => {
      const a = document.querySelector('#fSub .gv-boxhelp-link');
      if (!a) return null;
      a.click();
      return { text: a.textContent, open: document.getElementById('gvScaleStudy').open };
    });
    assert.ok(link, 'the instruction line has no link to the scale card');
    assert.equal(link.text, 'box');
    assert.ok(link.open, 'the box link did not open the scale card');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('entering scale mode says what a box IS, once', async () => {
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.evaluate(() =>
      document.querySelector('#gvModes button[data-gm="scales"]').click());
    await page.waitForTimeout(250);
    const said = await page.evaluate(() => ({
      verdict: document.getElementById('fVerdict').textContent,
      sub: document.getElementById('fSub').textContent,
      /* …and it must FIT: the console reserves one height per slot, and a
         definition that is clipped teaches half a definition. */
      clipped: (() => {
        const el = document.querySelector('#secFind .gv-slot-verdict');
        return el.firstElementChild.scrollHeight > el.clientHeight + 1;
      })(),
    }));
    assert.match(said.verdict, /shape you can put your hand on/, said.verdict);
    assert.match(said.verdict, /six notes across three strings, four frets wide/, said.verdict);
    assert.match(said.verdict, /slide it/, said.verdict);
    assert.ok(!said.clipped, 'the definition does not fit the slot it was written into');
    assert.match(said.sub, /Play its box/, 'the instruction line: ' + said.sub);
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= the ladder is per game ================= */

test('a first scale question is stage 1, whatever the Notes stage is', async () => {
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(300);
    // A Notes player at the top of their own ladder.
    await page.evaluate(() => {
      const sel = document.getElementById('gvWorld');
      sel.value = '4'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(250);
    await page.evaluate(() =>
      document.querySelector('#gvModes button[data-gm="scales"]').click());
    await page.waitForTimeout(300);
    const first = await page.evaluate(() => ({
      rung: GV.scaleTier, notesTier: tier, sel: document.getElementById('gvWorld').value,
      total: SC.targets.length, shape: SC.shape,
      strings: [...new Set(SC.targets.map(t => t.si))],
    }));
    assert.equal(first.rung, 0, 'the first ever scale question was on rung ' + (first.rung + 1));
    assert.equal(first.sel, '0', 'the stage control shows the wrong ladder');
    assert.equal(first.total, 6, 'a first scale question is an eleven-note run');
    assert.equal(first.shape, 'up');
    assert.ok(!first.strings.includes(0), 'the first rung uses the low B string');
    // Climbing the scale ladder leaves the Notes/Theory tier where it was…
    await page.evaluate(() => {
      const sel = document.getElementById('gvWorld');
      sel.value = '2'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(250);
    const moved = await page.evaluate(() => ({ rung: GV.scaleTier, notesTier: tier }));
    assert.equal(moved.rung, 2);
    assert.equal(moved.notesTier, 4, 'moving the scale rung moved the Notes stage too');
    // …and going back to Notes finds it exactly as it was left.
    await page.evaluate(() =>
      document.querySelector('#gvModes button[data-gm="notes"]').click());
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.getElementById('gvWorld').value), '4',
      'the Notes stage came back as the scale rung');
    // Both rungs survive a reload, apart.
    await page.reload();
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ rung: GV.scaleTier, notesTier: tier }));
    assert.deepEqual(back, { rung: 2, notesTier: 4 }, 'the two ladders did not survive apart');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= a drill is not a chart =================
   With power chords the game grades the MINOR shape of every root. The one
   loop whose per-root minor pentatonics are all diatonic is i-iv-i-v — and
   even then the screen must not dress the drill up as a key. */

test('the power-chord rungs stop pretending to be a chart', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    for (const stage of ['0', '1']) {
      await page.evaluate((v) => {
        const sel = document.getElementById('gvWorld');
        sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, stage);
      await page.waitForTimeout(250);
      for (let i = 0; i < 4; i++) {
        const s = await state(page);
        const at = 'stage ' + (+stage + 1) + ': ';
        assert.doesNotMatch(s.chart, /i-|I-|VII|vi\b|IV/, at + 'the chart prints roman numerals: ' + s.chart);
        assert.doesNotMatch(s.chart, /\b(minor|major)\b(?![ ]shape)/,
          at + 'the chart names a key mode: ' + s.chart);
        assert.doesNotMatch(s.chart, /vamp/i, at + 'the chart says "vamp": ' + s.chart);
        assert.match(s.symbol, /^[A-G]5$/, at + 'not a power chord: ' + s.symbol);
        // Every graded box is in the key of the loop.
        const ok = await page.evaluate(() => {
          const roots = SC.chords.map(c => c.rootPc);
          const key = SC.prog.keyPc;
          const inKey = new Set([0, 2, 3, 5, 7, 8, 10].map(i => (key + i) % 12));
          return roots.every(r => [0, 3, 5, 7, 10].every(i => inKey.has((r + i) % 12)));
        });
        assert.ok(ok, at + 'a graded box leaves the key the chart is in');
        await playRun(page, s.total);
        await page.waitForTimeout(1600);
      }
    }
    // Stage 1 draws ONE bar with a repeat sign, not four identical ones.
    await page.evaluate(() => {
      const sel = document.getElementById('gvWorld');
      sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(250);
    const bars = await page.evaluate(() =>
      [...document.querySelectorAll('#gvChart .gv-chart-bar')].map(b =>
        ({ txt: b.textContent, repeat: b.classList.contains('repeat') })));
    assert.equal(bars.length, 1, 'the one-chord rung still draws four bars');
    assert.ok(bars[0].repeat, 'the single bar has no repeat sign');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= the fit, on the phones people have ================= */

test('scale mode fits a phone as well as notes mode does', async () => {
  /* Measured on the same page, both modes, so the assertion is PARITY: the
     play area (through Show me) must clear the nav in scale mode wherever it
     does in notes mode, and the session row may not fall below the fold in
     scale mode unless it does in notes mode too. A 414×736 phone used to put
     Show me 13px UNDER the nav; a 360×640 put it 97px under. */
  for (const vp of [{ width: 414, height: 736 }, { width: 360, height: 640 },
                    { width: 390, height: 780 }, { width: 1280, height: 800 }]) {
    const app = await openApp(SILENT, '/index.html#find', vp);
    try {
      const { page } = app;
      const at = vp.width + '×' + vp.height + ': ';
      await page.click('#startBtn');
      await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
      await page.waitForTimeout(400);
      const measure = () => page.evaluate(() => {
        const doc = document.scrollingElement;
        const bot = el => el.getBoundingClientRect().bottom + doc.scrollTop;
        const navH = parseFloat(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-h')) || 0;
        return {
          ctl: bot(document.querySelector('#secFind .gv-controls')),
          sess: bot(document.querySelector('#secFind .stat-row')),
          floor: window.innerHeight - navH,
          card: +document.querySelector('#secFind .gv-card')
            .getBoundingClientRect().height.toFixed(1),
        };
      });
      const notes = await measure();
      await page.evaluate(() =>
        document.querySelector('#gvModes button[data-gm="scales"]').click());
      await page.waitForTimeout(400);
      const scales = await measure();
      assert.ok(scales.ctl <= scales.floor, at +
        'Show me ends at ' + scales.ctl + ', the screen ends at ' + scales.floor);
      if (notes.sess <= notes.floor) {
        assert.ok(scales.sess <= scales.floor, at +
          'the session row is under the nav in scale mode (' + scales.sess +
          ' vs ' + scales.floor + ') but not in notes mode');
      }
      /* Raw height is not the promise — scale mode legitimately carries a
         compartment Notes mode's Names prompt does not have. The promise is
         the FIT above, and that the height never MOVES below. */
      // Mid-run, mid-reveal and mid-verdict must not change any of it.
      const heights = [scales.card];
      await playRun(page, 2);
      await page.waitForTimeout(80);
      heights.push((await measure()).card);
      await playWrong(page);
      await page.waitForTimeout(80);
      heights.push((await measure()).card);
      await page.evaluate(() => gvBreach());
      await page.waitForTimeout(250);
      const rev = await measure();
      heights.push(rev.card);
      assert.ok(rev.ctl <= rev.floor, at + 'the reveal pushes Show me under the nav');
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 2,
        at + 'the console changed height: ' + heights.join(' / '));
      assert.deepEqual(app.errors, [], 'page errors');
    } finally { await app.close(); }
  }
});

/* ================= not playing = not burning ================= */

test('the fuse waits while a study card is open', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    await page.evaluate(() => {
      document.getElementById('gvSettings').open = true;
      document.querySelector('#gvPaceSeg button[data-p="steady"]').click();
      document.getElementById('gvSettings').open = false;
    });
    await page.waitForTimeout(250);
    const left = () => page.evaluate(() => gvFuseMs() - (performance.now() - GV.spawnAt));
    const before = await left();
    await page.evaluate(() => {
      const c = document.getElementById('gvScaleStudy');
      c.open = true; c.dispatchEvent(new Event('toggle'));
    });
    await page.waitForTimeout(1200);
    const held = await left();
    assert.ok(Math.abs(held - before) < 250,
      'the fuse burnt ' + Math.round(before - held) + 'ms while the card was open');
    await page.evaluate(() => {
      const c = document.getElementById('gvScaleStudy');
      c.open = false; c.dispatchEvent(new Event('toggle'));
    });
    await page.waitForTimeout(700);
    const after = await left();
    assert.ok(after < held - 300, 'the fuse never restarted after the card closed');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= the run is spoken, not only drawn ================= */

test('a screen reader hears the run count, terse and throttled', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    assert.equal((await state(page)).pipLive, '', 'the count speaks before a note lands');
    await playRun(page, 1);
    await page.waitForTimeout(80);
    assert.equal((await state(page)).pipLive, '1 of 6', 'the first note was not counted aloud');
    // The last note is always spoken, however fast the run was played.
    await playRun(page, 5);
    await page.waitForTimeout(120);
    assert.equal((await state(page)).pipLive, '6 of 6', 'the last note was swallowed');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= brute force is not a find ================= */

test('hunting a shape one fret at a time does not bank a run', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    // Six misses on a six-note run: found, eventually, by walking the neck.
    await page.evaluate(() => {
      const hz = m => 440 * Math.pow(2, (m - 69) / 12);
      for (let i = 0; i < 6; i++) {
        const midi = SC.run.expected().midi + 1 + i;
        onStableNote({ midi, hz: hz(midi), cents: 0 });
      }
    });
    await page.waitForTimeout(120);
    await playRun(page, 6);
    await page.waitForTimeout(200);
    const s = await state(page);
    assert.match(s.verdict, /does not count as a find/, 'the verdict: ' + s.verdict);
    const tiles = await page.evaluate(() => ({
      found: document.getElementById('fScore').textContent,
      asked: document.getElementById('fAsked').textContent,
      clean: document.getElementById('fClean').textContent,
    }));
    assert.equal(tiles.found, '0', 'a brute-forced run bumped the RUNS tile');
    assert.equal(tiles.clean, '0');
    assert.equal(tiles.asked, '1', 'the question was still asked');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= a four-string bass has no low B ================= */

test('saying the bass has four strings takes the low B out of the draw', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    await page.evaluate(() => {
      document.getElementById('gvSettings').open = true;
      document.querySelector('#gvStringsSeg button[data-str="4"]').click();
      const sel = document.getElementById('gvWorld');
      sel.value = '4'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('gvSettings').open = false;
    });
    await page.waitForTimeout(300);
    for (let i = 0; i < 8; i++) {
      const s = await page.evaluate(() => ({
        strings: [...new Set(SC.targets.map(t => t.si))], total: SC.targets.length,
      }));
      assert.ok(!s.strings.includes(0),
        'the top rung put a shape on the low B for a four-string player');
      await playRun(page, s.total);
      await page.waitForTimeout(1500);
    }
    // …and a five-string player still gets it.
    await page.evaluate(() => {
      document.getElementById('gvSettings').open = true;
      document.querySelector('#gvStringsSeg button[data-str="5"]').click();
      document.getElementById('gvSettings').open = false;
    });
    await page.waitForTimeout(250);
    let sawB = false;
    for (let i = 0; i < 14 && !sawB; i++) {
      const s = await page.evaluate(() => ({
        strings: [...new Set(SC.targets.map(t => t.si))], total: SC.targets.length,
      }));
      if (s.strings.includes(0)) sawB = true;
      await playRun(page, s.total);
      await page.waitForTimeout(1300);
    }
    assert.ok(sawB, 'the low B never came back for a five-string player');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ================= what a half-played run is worth ================= */

test('a burnt fuse pays for the notes that landed, and never steals the next chord', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    await page.evaluate(() => {
      document.getElementById('gvSettings').open = true;
      document.querySelector('#gvPaceSeg button[data-p="steady"]').click();
      document.getElementById('gvSettings').open = false;
    });
    await page.waitForTimeout(250);
    /* SHOW ME LATE IN A FUSE used to hand the next chord ~150ms, which took a
       stage light off a chord the player never touched. The carry has a floor. */
    const carry = await page.evaluate(() => {
      GV.spawnAt = performance.now() - gvFuseMs() + 200;    // 200ms left
      document.getElementById('fSkip').click();
      return { full: gvFuseMs(), carry: GV.carryFuseMs };
    });
    assert.ok(carry.carry >= carry.full * 0.39,
      'the next chord inherited ' + carry.carry + 'ms of a ' + carry.full + 'ms fuse');
    assert.ok(carry.carry <= carry.full, 'Show me refilled the fuse');
    await page.waitForTimeout(3600);
    // Play out the uncredited second ask, so the next chord is a fresh question.
    await playRun(page, await page.evaluate(() => SC.targets.length));
    await page.waitForTimeout(1700);
    // Three of six notes in, then the fuse dies: three notes of work, paid.
    await playRun(page, 3);
    await page.waitForTimeout(80);
    const paid = await page.evaluate(() => {
      const before = GV.xp, zaps = GV.run.state.zaps;
      gvBreach();
      return { before, after: GV.xp, zaps, zapsAfter: GV.run.state.zaps,
               landed: SC.landed, second: SC.second };
    });
    assert.equal(paid.second, false, 'the test breached a second ask');
    assert.equal(paid.landed, 3);
    assert.ok(paid.after > paid.before,
      'three of six notes landed and the run paid nothing');
    assert.equal(paid.zapsAfter, paid.zaps, 'a half-played run claimed a find');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a fumbled box is remembered, and the note map shows where it was', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    await playRun(page, 2);
    await page.waitForTimeout(80);
    await page.evaluate(() => gvBreach());
    await page.waitForTimeout(250);
    const rec = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')).stats || {};
      return { recent: Object.keys(st.scaleRecent || {}), heat: Object.keys(st.scaleHeat || {}) };
    });
    assert.equal(rec.recent.length, 1, 'the box was not booked against its own key');
    assert.match(rec.recent[0], /^sc:(min|maj)Pent:\d+:\d+:\d+$/,
      'the record is not keyed by root, shape AND place: ' + rec.recent[0]);
    assert.equal(rec.heat.length, 6, 'the six positions of the box were not marked');
    // …and the map's weak-spot overlay counts them.
    const note = await page.evaluate(() => {
      const c = document.getElementById('gvMap');
      c.open = true;
      document.querySelector('#gvMapWeakSeg button[data-wk="on"]').click();
      c.dispatchEvent(new Event('toggle'));
      return document.getElementById('gvMapNote').textContent;
    });
    assert.match(note, /positions you have missed — [1-9]/,
      'the map does not show the scale misses: ' + note);
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
