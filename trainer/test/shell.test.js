/* End-to-end tests for the shell's own behaviour: what happens to the click, the
   URL and a failed input switch when the two halves share one page. These are
   the loose ends the merge left, so they are tested where they live — in the
   shell — rather than inside either half. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp } = require('./harness.js');

/* Above the detector's 420 Hz ceiling: the app listens, but no note is ever
   accepted, so a question stays open for the whole test. */
const SILENT = 987.767;

test('leaving a song stops its click instead of ticking behind a chart', async () => {
  /* The transport is deliberately global — the Scales chart's click keeps
     running while you look something up — but a click the SONG started is the
     song's, and it dies with the song rather than ticking on from nowhere. */
  const app = await openApp(SILENT, '/index.html#songs');
  const { page } = app;
  try {
    await page.click('#startBtn');
    await page.waitForSelector('#secSongs:not(.hidden)', { timeout: 5000 });
    await page.click('#sgList button[data-play="click"]');
    await page.waitForSelector('#sgArm:not(.hidden)', { timeout: 3000 });
    await page.click('#sgTap');
    await page.waitForFunction(() => MET.timer !== null, null, { timeout: 5000 });

    await page.click('#tabbar button[data-tab="scales"]');
    await page.waitForSelector('#tab-scales.on', { timeout: 3000 });
    assert.equal(await page.evaluate(() => MET.timer), null,
      'the click kept ticking with nothing on screen to stop it');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a song is stopped when you leave, rather than running away off-screen', async () => {
  const app = await openApp(SILENT, '/index.html#songs');
  const { page } = app;
  try {
    await page.click('#startBtn');
    await page.waitForSelector('#secSongs:not(.hidden)', { timeout: 5000 });
    await page.click('#sgList button[data-play="click"]');
    await page.waitForSelector('#sgArm:not(.hidden)', { timeout: 3000 });
    await page.click('#sgTap');
    await page.waitForFunction(() => SG.t0 != null, null, { timeout: 5000 });

    await page.click('#tabbar button[data-tab="scales"]');
    await page.waitForSelector('#tab-scales.on', { timeout: 3000 });
    // Its clock is wall-time from the tap, so leaving it running would put the
    // roadmap in a different section from the record by the time you came back.
    assert.equal(await page.evaluate(() => SG.finished), true,
      'the song kept running while a chart was on screen');
    assert.equal(await page.evaluate(() => MET.timer), null, 'the song click kept ticking');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the URL follows the tab, so a reload lands where you were', async () => {
  const app = await openApp(SILENT, '/index.html');
  const { page } = app;
  try {
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
    await page.click('#tabbar button[data-tab="scales"]');
    assert.equal(await page.evaluate(() => location.hash), '#scales');

    await page.reload();
    await page.waitForSelector('#tab-scales.on', { timeout: 4000 });
    assert.equal(await page.evaluate(() =>
      document.querySelector('#tabbar button.on').dataset.tab), 'scales',
      'reloading threw the session back to the game');

    // Back leaves the app rather than walking the tabs one by one.
    const before = await page.evaluate(() => history.length);
    await page.click('#tabbar button[data-tab="chords"]');
    await page.click('#tabbar button[data-tab="tuner"]');
    assert.equal(await page.evaluate(() => history.length), before,
      'each tab switch stacked a history entry');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a failed input switch reports where it can be seen, not into the closed gate', async () => {
  const app = await openApp(SILENT, '/index.html#tuner');
  const { page } = app;
  try {
    await page.click('#startBtn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.isVisible('#gate'), false);

    // Fail only the switch: the first grant has already happened.
    await page.evaluate(() => {
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => (c && c.audio && c.audio.deviceId)
        ? Promise.reject(Object.assign(new Error('nope'), { name: 'NotFoundError' }))
        : orig(c);
    });
    await page.evaluate(() => {
      const sel = document.getElementById('deviceSel');
      sel.insertAdjacentHTML('beforeend', '<option value="ghost">Unplugged interface</option>');
      sel.value = 'ghost';
      sel.dispatchEvent(new Event('change'));
    });

    await page.waitForFunction(() =>
      !document.getElementById('liveErr').classList.contains('hidden'), null, { timeout: 3000 });
    assert.match(await page.textContent('#liveErr'), /Could not open an audio input/);
    assert.equal(await page.isVisible('#liveErr'), true,
      'the failure was reported into an element nobody can see');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the app is titled once per screen, at every width', async () => {
  const app = await openApp(SILENT, '/index.html');
  const { page } = app;
  try {
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
    for (const width of [380, 768, 1000, 1440, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      const shown = await page.evaluate(() =>
        ['header h1', 'nav.tabbar .rail-title']
          .filter(s => { const e = document.querySelector(s);
            return e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 4; }));
      assert.equal(shown.length, 1,
        width + 'px shows the app name ' + shown.length + ' times: ' + shown.join(', '));
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
