/* End-to-end tests for the promises the merge makes: one page, one nav, one
   microphone session that is armed late and never re-asked for. Run with
   `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp, until } = require('./harness.js');

/* A tone well above the bass range (B5). The pitch detector's ceiling is
   420 Hz, so tests that need the app merely LISTENING, without a note ever
   being accepted, can leave this playing. */
const SILENT = 987.767;

test('reading a chart never asks for the microphone', async () => {
  // The front door is the game now, and the game gates — but the two charts
  // are pure reference and must stay reachable with the mic switched off.
  const app = await openApp(SILENT, '/index.html#scales');
  try {
    await app.page.waitForSelector('#scaleFb .neck-svg', { timeout: 4000 });
    assert.equal(await app.gum(), 0, 'a chart asked for a microphone');

    // Work the chart: run the click, then cross to the other one.
    await app.page.click('#metStart');
    await app.page.waitForSelector('#metrobar.on', { timeout: 3000 });
    await app.page.click('#mbStop');
    await app.page.click('#tabbar button[data-tab="chords"]');
    await app.page.waitForSelector('#tab-chords.on', { timeout: 3000 });

    assert.equal(await app.gum(), 0, 'a Learn tab asked for a microphone');
    // Nor is an AudioContext left polling anything.
    assert.equal(await app.page.evaluate(() => A.timer), null, 'the analyser loop is running');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('entering a Live mode arms the microphone with one click, and starts that mode', async () => {
  const app = await openApp(SILENT, '/index.html#songs');
  try {
    await app.page.click('#tabbar button[data-tab="songs"]');
    // The gate is inline in the mode you asked for, and says so.
    await app.page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    assert.equal(await app.page.textContent('#gateMode'), 'Songs');
    assert.match(await app.page.textContent('#startBtn'), /follow the song/,
      'the gate button should offer the thing that was asked for, not just "Start"');
    assert.equal(await app.gum(), 0, 'gated, but the mic was taken anyway');

    await app.page.click('#startBtn');
    await app.page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    await app.page.waitForTimeout(50);
    assert.equal(await app.gum(), 1, 'one click should be one getUserMedia call');
    assert.equal(await app.page.isVisible('#gate'), false, 'the gate is still up after arming');
    assert.equal(await app.page.isVisible('#secSongs'), true,
      'arming landed somewhere other than the mode that was asked for');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('moving between two Live modes does not gate again', async () => {
  const app = await openApp(SILENT, '/index.html#play');
  try {
    await app.page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    await app.page.click('#startBtn');
    await app.page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });

    for (const [dest, sec] of [['tuner', '#secTuner'], ['songs', '#secSongs'], ['play', '#secFind']]) {
      await app.page.click(`#tabbar button[data-tab="${dest}"]`);
      await app.page.waitForSelector(`${sec}:not(.hidden)`, { timeout: 3000 });
      assert.equal(await app.page.isVisible('#gate'), false, `${dest} put the gate back up`);
    }
    assert.equal(await app.gum(), 1, 'the mic was requested more than once');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('every address the app has ever answered to still lands somewhere real', async () => {
  /* Four destinations were retired when the app was refocused on the game, and
     their hashes are written into bookmarks and into the old trainer/ page's
     redirect. None of them may open a blank screen: they all forward to the
     front door, which is where the exercises they named actually went. */
  const cases = [
    ['/index.html#practice', 'play'], ['/index.html#trainer', 'play'],
    ['/index.html#echo', 'play'],     ['/index.html#drill', 'play'],
    ['/index.html#find', 'play'],     ['/trainer/index.html#drill', 'play'],
    ['/trainer/index.html#songs', 'songs'],
  ];
  for (const [url, dest] of cases) {
    const app = await openApp(SILENT, url);
    try {
      await app.page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
      const navOn = await app.page.evaluate(() => {
        const b = document.querySelector('#tabbar button.on');
        return b && b.dataset.tab;
      });
      assert.equal(navOn, dest, `${url} left the nav pointing at ${navOn}`);
      assert.match(app.page.url(), new RegExp('/index\\.html#' + dest + '$'),
        `${url} did not end up on the one page at #${dest}`);
      assert.deepEqual(app.errors, [], 'page errors');
    } finally { await app.close(); }
  }
});

test('the two halves keep their own stores, so neither can clobber the other', async () => {
  /* They shared bassTheoryTrainer.v1 while a Note quiz read the same numbers
     the game banks. They do not any more — the game's memory is its own key —
     and a Learn tab's save() must not be able to touch it. */
  const app = await openApp(97.999, '/index.html#play');   // a synthetic G2
  const { page } = app;
  try {
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => {
      localStorage.removeItem('bassTrainer.gamemem.v1');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });
    await until(page, () => document.getElementById('fVerdict').className.includes('ok') || null);
    assert.deepEqual(await page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1')).stats.noteRecent['E:3']), [1],
      'the Live half never banked the answer');

    // Now make the Learn half write, and check the game's memory is untouched.
    await page.click('#tabbar button[data-tab="chords"]');
    await page.waitForSelector('#tab-chords.on', { timeout: 3000 });
    await page.evaluate(() => { S.chords.root = 'A'; save(); });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      game: JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1')),
      charts: JSON.parse(localStorage.getItem('bassTrainer.charts.v1')),
    }));
    assert.deepEqual(after.game.stats.noteRecent['E:3'], [1],
      'the Learn half overwrote the Live answer');
    assert.equal(after.charts.chords.root, 'A', 'the Learn half did not write its own change');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the app is 5-string only: no tuning control, no 4-string copy anywhere', async () => {
  // The 4-string mode is gone, and with it the header toggle and every piece
  // of copy that existed to explain the other neck. The tuner simply names the
  // one tuning there is.
  const app = await openApp(SILENT, '/index.html#tuner');
  const { page } = app;
  try {
    await page.click('#startBtn');
    await page.waitForSelector('#secTuner:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.evaluate(() =>
      document.querySelectorAll('[data-t]').length), 0,
      'a tuning control is still on the page');
    assert.equal(await page.textContent('#tStrings'), 'B E A D G',
      'the tuner should list the five strings, low B first');

    // All five destinations, and not a word about 4-string on any of them.
    const tabs = [['scales', '#tab-scales.on'], ['chords', '#tab-chords.on'],
                  ['tuner', '#secTuner:not(.hidden)'], ['play', '#secFind:not(.hidden)'],
                  ['songs', '#secSongs:not(.hidden)']];
    for (const [dest, sel] of tabs) {
      await page.click(`#tabbar button[data-tab="${dest}"]`);
      await page.waitForSelector(sel, { timeout: 3000 });
      const text = await page.evaluate(() => document.body.innerText);
      assert.doesNotMatch(text, /4-str/i, dest + ' still mentions a 4-string mode');
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a game in progress survives a trip to a Learn tab and back', async () => {
  const app = await openApp(SILENT, '/index.html#play');
  try {
    await app.page.click('#startBtn');
    await app.page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });

    const before = await app.page.evaluate(() => ({
      q: document.getElementById('fQ').textContent,
      xp: GV.xp,
    }));
    assert.ok(before.q && before.q.trim(), 'no question was actually posed');

    // Off to a chart. The analyser stops; the stream does not.
    await app.page.click('#tabbar button[data-tab="scales"]');
    await app.page.waitForSelector('#tab-scales.on', { timeout: 3000 });
    assert.equal(await app.page.evaluate(() => A.timer), null,
      'the analyser kept polling behind a chart');
    assert.ok(await app.page.evaluate(() => !!(A.stream && A.analyser)),
      'the stream was thrown away, so coming back will re-prompt');

    // And back. No gate, same question, still the same run.
    await app.page.click('#tabbar button[data-tab="play"]');
    await app.page.waitForSelector('#secFind:not(.hidden)', { timeout: 3000 });
    assert.equal(await app.page.isVisible('#gate'), false, 'coming back re-gated');
    assert.equal(await app.page.textContent('#fQ'), before.q,
      'came back to a different question');
    assert.equal(await app.page.evaluate(() => GV.xp), before.xp,
      'the round trip cost or paid XP');
    assert.ok(await app.page.evaluate(() => A.timer !== null), 'the analyser did not restart');
    assert.equal(await app.gum(), 1, 'the round trip cost another microphone request');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the retired screens\' records are cleared out once, and only once', async () => {
  /* Four screens went away with their stores unreachable — nothing in the app
     renders a week log, a quiz accuracy or a drill\'s review date any more, so
     leaving them in localStorage would be leaving dead weight somewhere the
     player cannot see to clear. It runs ONCE: a player who legitimately builds
     new records must not have them wiped on every load. */
  const app = await openApp(SILENT, '/index.html');
  const { page } = app;
  try {
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
    const after = await page.evaluate(() => ({
      old: localStorage.getItem('bassTheoryTrainer.v1'),
      drills: localStorage.getItem('bassTrainer.drills.v1'),
      flag: localStorage.getItem('bassTrainer.retired.v1'),
    }));
    assert.equal(after.old, null, 'the retired store survived the clean-out');
    assert.equal(after.drills, null, 'the drill records survived the clean-out');
    assert.equal(after.flag, '1', 'the clean-out did not record that it had run');

    // Songs and the game keep their own stores, and are never touched.
    await page.evaluate(() => {
      localStorage.setItem('bassTrainer.songs.v1', '{"bib":{"id":"bib","plays":3}}');
      localStorage.setItem('bassTheoryTrainer.v1', '{"planted":true}');
    });
    await page.reload();
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
    const second = await page.evaluate(() => ({
      songs: localStorage.getItem('bassTrainer.songs.v1'),
      planted: localStorage.getItem('bassTheoryTrainer.v1'),
    }));
    assert.match(second.songs, /"plays":3/, 'the clean-out ate the song records');
    assert.match(second.planted || '', /planted/,
      'the clean-out ran a second time — it is not keyed by its own flag');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
