/* Regression tests for the app's BOOKKEEPING — the counts, labels and pointers
   around the teaching, which is where a second beginner's session found almost
   everything wrong. A wrong number is worse than a missing one: it is trusted.

   Every test here is a defect that shipped. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp } = require('./harness.js');

const SILENT = 987.767;            // above the detector's 420 Hz ceiling
const DESK = { width: 1440, height: 900 };

test('every theory card can actually be dismissed', async () => {
  // The ✕ was an inline onclick="dismissCard(...)", which resolves against
  // window — and the function became private when the two apps were merged into
  // one document. All ten buttons threw ReferenceError and did nothing.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    let dismissed = 0;
    for (const tab of ['scales', 'chords']) {
      await page.click('#tabbar button[data-tab="' + tab + '"]');
      await page.waitForSelector('#tab-' + tab + '.on', { timeout: 3000 });
      // Dismissing removes the card, so take the first one until none are left.
      for (;;) {
        const btn = await page.$('#tab-' + tab + ' [data-dismiss]');
        if (!btn) break;
        const id = await btn.getAttribute('data-dismiss');
        await btn.click();
        await page.waitForTimeout(60);
        assert.equal(await page.$('#tab-' + tab + ' [data-card="' + id + '"]'), null,
          'card "' + id + '" survived its own dismiss button');
        dismissed++;
        if (dismissed > 20) throw new Error('dismiss did not remove cards');
      }
    }
    assert.ok(dismissed >= 4, 'only ' + dismissed + ' theory cards found to dismiss');
    // Dismissals are remembered, so they do not come back on the next visit.
    // (The hash follows the tab now, so a bare reload lands on the last one.)
    await page.goto(page.url().replace(/#.*$/, '') + '#scales');
    await page.waitForSelector('#tab-scales.on', { timeout: 4000 });
    assert.equal(await page.$('#tab-scales [data-dismiss]'), null,
      'a dismissed card came back after a reload');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('hunting for a note is not counted as getting it wrong', async () => {
  /* Find it exists to make you hunt. Every wrong note played while hunting used
     to bank an answer AND the eventual find banked another, so four questions
     all answered correctly read as "4 correct, 8 asked". One stored answer per
     question, graded on the FIRST attempt — which is what the weak-spot map and
     the adaptive picker both assume. */
  const app = await openApp(SILENT, '/index.html#play', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => localStorage.removeItem('bassTrainer.gamemem.v1'));

    // Four questions, each hunted for (two wrong notes) and then found.
    await page.evaluate(async () => {
      const T = window.__T = { hunts: 4 };
      for (let i = 0; i < T.hunts; i++) {
        await new Promise(r => setTimeout(r, 20));
        const want = q.midi;
        A.muteUntil = 0;
        // Two misses, then the right note — the shape of hunting.
        onStableNote({ midi: want + 5, hz: 100, cents: 0 });
        onStableNote({ midi: want - 3, hz: 100, cents: 0 });
        onStableNote({ midi: want, hz: 100, cents: 0 });
        await new Promise(r => setTimeout(r, 1300));  // let it advance
      }
    });
    const st = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1')).stats);
    /* Counted as ENTRIES, not positions: the picker brings a missed note back,
       so four questions can be three positions with one of them asked twice. */
    const banked = Object.values(st.noteRecent).flat();
    assert.equal(banked.length, 4,
      'four questions banked ' + banked.length + ' answers — hunting is being counted');
    assert.deepEqual(banked, [0, 0, 0, 0],
      'a question found only after two wrong notes is not a first-attempt find');
    assert.equal(Object.values(st.heat).reduce((a, b) => a + b, 0), 4,
      'each hunted question should take one mark, not one per wrong note');

    // The session panel keeps the two facts apart instead of blurring them.
    const panel = await page.evaluate(() => ({
      found: document.getElementById('fScore').textContent,
      clean: document.getElementById('fClean').textContent,
      asked: document.getElementById('fAsked').textContent,
    }));
    assert.equal(panel.found, '4', 'four notes were found');
    assert.equal(panel.clean, '0', 'none of them first time');
    assert.equal(panel.asked, '4', 'four questions, not eight attempts');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a song that scored nothing blames the input only if the input was silent', async () => {
  /* A play-through with the level meter solid green the whole way reported "No
     notes were heard… Check the input at the top of the page is your bass" —
     sending the player off to debug a working interface for an evening. */
  const app = await openApp(SILENT, '/index.html#songs', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#sgList .sg-item', { timeout: 5000 });
    await page.click('#sgList button[data-play="click"]');
    await page.waitForSelector('#sgArm:not(.hidden)', { timeout: 3000 });
    await page.click('#sgTap');
    await page.waitForFunction(() => SG.t0 != null, null, { timeout: 6000 });
    // SILENT is above the detector's ceiling, so it is heard as level but never
    // as a note: exactly the case that was being misdiagnosed.
    await page.waitForFunction(() => SG.sawSignal === true, null, { timeout: 6000 });
    await page.click('#sgStop');
    await page.waitForTimeout(300);
    const report = await page.textContent('#sgSummary');
    assert.match(report, /no new notes/i, 'it should say no notes STARTED, which is what happened');
    assert.doesNotMatch(report, /Check the input/,
      'it still blames an input that was audibly working');

    // A play where nothing was scored is not a play.
    const plays = await page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem('bassTrainer.songs.v1') || '{}');
      return Object.keys(all).reduce((a, k) => a + (all[k].plays || 0), 0);
    });
    assert.equal(plays, 0, 'an unscored run was banked as a play');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
