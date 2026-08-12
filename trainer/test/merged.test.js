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

test('opening the app and using the practice plan never asks for the microphone', async () => {
  const app = await openApp(SILENT, '/index.html');
  try {
    await app.page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    assert.equal(await app.gum(), 0, 'the front door asked for a microphone');

    // Work the plan: check an item off, run the metronome, follow a deep link.
    await app.page.click('input[data-item="w1a"]');
    await app.page.click('[data-met]');
    await app.page.waitForSelector('#metrobar.on', { timeout: 3000 });
    await app.page.click('#mbStop');
    await app.page.click('#tabbar button[data-tab="scales"]');
    await app.page.waitForSelector('#scaleFb .neck-svg', { timeout: 3000 });
    await app.page.click('#tabbar button[data-tab="trainer"]');
    await app.page.waitForSelector('#tab-trainer.on', { timeout: 3000 });

    assert.equal(await app.gum(), 0, 'a Learn tab asked for a microphone');
    // Nor is an AudioContext left polling anything.
    assert.equal(await app.page.evaluate(() => A.timer), null, 'the analyser loop is running');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('entering a Live mode arms the microphone with one click, and starts that mode', async () => {
  const app = await openApp(SILENT, '/index.html');
  try {
    await app.page.click('#tabbar button[data-tab="drill"]');
    // The gate is inline in the mode you asked for, and says so.
    await app.page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    assert.equal(await app.page.textContent('#gateMode'), 'Drills');
    assert.match(await app.page.textContent('#startBtn'), /run the drill/,
      'the gate button should offer the thing that was asked for, not just "Start"');
    assert.equal(await app.gum(), 0, 'gated, but the mic was taken anyway');

    await app.page.click('#startBtn');
    await app.page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    await app.page.waitForTimeout(50);
    assert.equal(await app.gum(), 1, 'one click should be one getUserMedia call');
    assert.equal(await app.page.isVisible('#gate'), false, 'the gate is still up after arming');
    assert.equal(await app.page.isVisible('#secDrill'), true,
      'arming landed somewhere other than the mode that was asked for');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('moving between two Live modes does not gate again', async () => {
  const app = await openApp(SILENT, '/index.html#find');
  try {
    await app.page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    await app.page.click('#startBtn');
    await app.page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });

    for (const [dest, sec] of [['echo', '#secEcho'], ['tuner', '#secTuner'], ['songs', '#secSongs']]) {
      await app.page.click(`#tabbar button[data-tab="${dest}"]`);
      await app.page.waitForSelector(`${sec}:not(.hidden)`, { timeout: 3000 });
      assert.equal(await app.page.isVisible('#gate'), false, `${dest} put the gate back up`);
    }
    assert.equal(await app.gum(), 1, 'the mic was requested more than once');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('both old URLs for a drill still land on Drills', async () => {
  // index.html#drill is the new address; trainer/index.html#drill is the one
  // that is already written into links, and it must carry its hash across.
  for (const url of ['/index.html#drill', '/trainer/index.html#drill']) {
    const app = await openApp(SILENT, url);
    try {
      await app.page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
      assert.equal(await app.page.textContent('#gateMode'), 'Drills', `${url} did not open Drills`);
      const navOn = await app.page.evaluate(() => {
        const b = document.querySelector('#tabbar button.on');
        return b && b.dataset.tab;
      });
      assert.equal(navOn, 'drill', `${url} left the nav pointing at ${navOn}`);
      assert.match(app.page.url(), /\/index\.html#drill$/, `${url} did not end up on the one page`);
      assert.deepEqual(app.errors, [], 'page errors');
    } finally { await app.close(); }
  }
});

test('an answer banked in a Live mode is not clobbered by the Learn half', async () => {
  // Both halves read and write bassTheoryTrainer.v1. When they were two pages
  // each loaded a fresh copy; in one document the Learn half's copy goes stale
  // the moment a Live mode banks an answer, and its next save() would write
  // that stale copy straight back over the top.
  const app = await openApp(97.999, '/index.html#find');   // a synthetic G2
  const { page } = app;
  try {
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => {
      localStorage.removeItem('bassTheoryTrainer.v1');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      hintLevel = 0; wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });
    await until(page, () => document.getElementById('fVerdict').className.includes('ok') || null);
    assert.equal(await page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')).stats.correct), 1,
      'the Live half never banked the answer');

    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on', { timeout: 3000 });
    assert.equal(await page.evaluate(() => S.stats.correct), 1,
      'the Learn half is still showing its stale copy of the store');

    // Now make the Learn half write, and check the Live answer is still there.
    await page.click('input[data-item="w1a"]');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')));
    assert.equal(after.stats.correct, 1, 'the Learn half overwrote the Live answer');
    assert.ok(after.practice.log && Object.keys(after.practice.log).length,
      'the Learn half did not write its own change');
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

    // All nine destinations, and not a word about 4-string on any of them.
    const tabs = [['practice', '#tab-practice.on'], ['scales', '#tab-scales.on'],
                  ['chords', '#tab-chords.on'], ['trainer', '#tab-trainer.on'],
                  ['tuner', '#secTuner:not(.hidden)'], ['find', '#secFind:not(.hidden)'],
                  ['echo', '#secEcho:not(.hidden)'], ['drill', '#secDrill:not(.hidden)'],
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

test('a drill in progress survives a trip to a Learn tab and back', async () => {
  const app = await openApp(SILENT, '/index.html#drill');
  try {
    await app.page.click('#startBtn');
    await app.page.waitForSelector('#secDrill:not(.hidden)', { timeout: 5000 });
    await app.page.click('#drStart');
    await app.page.waitForSelector('#drRun:not(.hidden)', { timeout: 3000 });

    const before = await app.page.evaluate(() => ({
      title: document.getElementById('drRunTitle').textContent,
      prog: document.getElementById('drProg').textContent,
    }));
    assert.ok(before.title && before.title !== '—', 'no drill actually started');

    // Off to the practice plan. The analyser stops; the stream does not.
    await app.page.click('#tabbar button[data-tab="practice"]');
    await app.page.waitForSelector('#tab-practice.on', { timeout: 3000 });
    assert.equal(await app.page.evaluate(() => A.timer), null,
      'the analyser kept polling behind the practice plan');
    assert.ok(await app.page.evaluate(() => !!(A.stream && A.analyser)),
      'the stream was thrown away, so coming back will re-prompt');

    // And back. No gate, same run, still on the same drill.
    await app.page.click('#tabbar button[data-tab="drill"]');
    await app.page.waitForSelector('#secDrill:not(.hidden)', { timeout: 3000 });
    assert.equal(await app.page.isVisible('#gate'), false, 'coming back re-gated');
    assert.equal(await app.page.isVisible('#drRun'), true, 'the run was lost');
    assert.equal(await app.page.textContent('#drRunTitle'), before.title,
      'came back to a different drill');
    assert.equal(await app.page.textContent('#drProg'), before.prog,
      'the run restarted instead of resuming');
    assert.ok(await app.page.evaluate(() => A.timer !== null), 'the analyser did not restart');
    assert.equal(await app.gum(), 1, 'the round trip cost another microphone request');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
