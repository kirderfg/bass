/* Regression tests for defects found by driving the app through a whole
   beginner's session — tune up, learn a note, do the day's practice, play a
   sequence, come back tomorrow, set a song up, check for progress.

   Each of these shipped. They are here because none of them was reachable from a
   unit test: they are about what one screen promises and another delivers.
   Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp } = require('./harness.js');

/* Above the detector's 420 Hz ceiling: the app listens and accepts nothing. */
const SILENT = 987.767;
const DESK = { width: 1440, height: 900 };
/** Open B E A D G, so the tuner can actually finish. */
const FIVE_STRINGS = [30.87, 41.20, 55.00, 73.42, 98.00];

test('no screen names an app that no longer exists', async () => {
  // Two apps became one page. Seven places still pointed at "the Theory Trainer"
  // and "the Live Trainer" — names that appear in no menu and on no screen.
  const app = await openApp(SILENT, '/index.html#tuner', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    const found = [];
    for (const tab of ['scales', 'chords', 'tuner', 'play', 'songs']) {
      await page.click('#tabbar button[data-tab="' + tab + '"]');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.body.innerText);
      for (const stale of ['Theory Trainer', 'Live Trainer', 'Bass Theory'])
        if (text.includes(stale)) found.push(tab + ' → "' + stale + '"');
    }
    assert.deepEqual(found, [], 'stale app names on screen: ' + found.join(', '));
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the tuner describes tuning, not answering questions', async () => {
  const app = await openApp(SILENT, '/index.html#tuner', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    const feed = await page.textContent('#feedNote');
    // "Answers here feed the same progress stats…" was shown on a screen where
    // you turn pegs. It lives in the always-visible card, so it needs its own
    // wording per mode rather than the game's.
    assert.doesNotMatch(feed, /note you find|answers/i, 'the tuner still claims to take answers');
    assert.match(feed, /turn pegs/, 'and it should say what tuning does instead');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('tuning every string says the job is done, and offers the game', async () => {
  /* Five ✓ chips and no statement that tuning was finished. It used to tick an
     item off a twelve-week practice plan; that plan is retired, so the end of
     the job says so itself and hands you on to the thing you tuned up for.
     Driven honestly: the mic really hears B E A D G. */
  const app = await openApp(FIVE_STRINGS, '/index.html#tuner', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('#tuneDone:not(.hidden)', { timeout: 30000 });
    assert.match(await page.textContent('#tuneDone'), /tuning done/);

    await page.click('#tuneDone [data-tab-link="play"]');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 3000 });
    assert.equal(await page.evaluate(() => location.hash), '#play',
      '"go and play" did not go anywhere');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the song mode that needs nothing else is the primary one', async () => {
  // "Play with the record" was the orange button on all five songs — the mode
  // that wants a tab player with the bass track muted. The click mode needs
  // nothing, and is the only one that can grade you.
  const app = await openApp(SILENT, '/index.html#songs', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#sgList .sg-item', { timeout: 5000 });
    const primaries = await page.evaluate(() =>
      [...document.querySelectorAll('#sgList .btn.primary')].map(b => b.dataset.play));
    assert.ok(primaries.length >= 5, 'every song should offer a primary action');
    assert.deepEqual([...new Set(primaries)], ['click'],
      'the primary button should be the app-click mode on every song');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a board narrower than its card gets its words beside it, not a third of an empty screen', async () => {
  const app = await openApp(SILENT, '/index.html#scales', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-scales.on', { timeout: 4000 });
    await page.click('#scView button[data-k="open"]');
    await page.waitForSelector('.board-split', { timeout: 3000 });
    const wide = await page.evaluate(() => {
      const s = document.querySelector('.board-split');
      const b = s.querySelector('.bs-board').getBoundingClientRect();
      const a = s.querySelector('.bs-aside').getBoundingClientRect();
      return { beside: a.left >= b.right - 2, used: a.right - b.left,
               card: s.closest('.card').getBoundingClientRect().width };
    });
    assert.ok(wide.beside, 'the words are still stacked under the board at 1440px');
    assert.ok(wide.used > wide.card * 0.85,
      'the row uses ' + Math.round(wide.used) + ' of ' + Math.round(wide.card) + 'px');

    // The wide views fill the card on their own and must be left alone.
    for (const v of ['box', 'neck']) {
      await page.click('#scView button[data-k="' + v + '"]');
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => !!document.querySelector('.board-split')), false,
        v + ' view was squeezed into a column');
    }

    // And a phone is unchanged: one column, no sideways scroll.
    await page.setViewportSize({ width: 380, height: 800 });
    await page.click('#scView button[data-k="open"]');
    await page.waitForSelector('.board-split', { timeout: 3000 });
    const narrow = await page.evaluate(() => {
      const s = document.querySelector('.board-split');
      const b = s.querySelector('.bs-board').getBoundingClientRect();
      const a = s.querySelector('.bs-aside').getBoundingClientRect();
      return { stacked: a.top >= b.bottom - 2,
               overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    assert.ok(narrow.stacked, 'the split did not collapse on a phone');
    assert.equal(narrow.overflow, false, 'the page scrolls sideways at 380px');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
