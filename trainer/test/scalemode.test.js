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
      assert.match(s.symbol, /^[A-G]#?(m|m7|5)?$/, 'bad chord symbol: ' + s.symbol);
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

test('the right note in the wrong octave is a plain miss', async () => {
  const app = await openScales();
  try {
    const { page } = app;
    await page.evaluate(() => {
      const hz = m => 440 * Math.pow(2, (m - 69) / 12);
      const want = SC.run.expected().midi + 12;
      onStableNote({ midi: want, hz: hz(want), cents: 0 });
    });
    await page.waitForTimeout(80);
    const s = await state(page);
    assert.equal(s.landed, 0, 'an octave out was accepted');
    assert.match(s.verdict, /not the next note of this box/,
      'the octave got a verdict of its own: ' + s.verdict);
    assert.doesNotMatch(s.verdict, /octave/i, 'the octave got special treatment');
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
    assert.ok(fuse.run > fuse.one * 1.8,
      'the run fuse (' + fuse.run + 'ms) is barely longer than one note\'s (' + fuse.one + 'ms)');
    assert.ok(fuse.run < fuse.one * 4, 'the run fuse is absurdly long: ' + fuse.run);

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
    assert.match(s.verdict, /box starts on the [BEADG] string, fret \d+/,
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
    assert.match(box.label, /numbered 1 to 6 in the order to play them/,
      'the drawing does not say what its numbers mean: ' + box.label);
    // And it moves on by itself, with the chart back up for the next chord.
    await page.waitForTimeout(3600);
    const next = await state(page);
    assert.ok(next.chartShown && !next.boxShown, 'the reveal outstayed its question');
    assert.equal(next.landed, 0);
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
    assert.match(neck.now, /whole neck · degrees/, 'the summary: ' + neck.now);
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
