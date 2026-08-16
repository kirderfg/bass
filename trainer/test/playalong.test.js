/* End-to-end tests for Songs: playing from memory, the gig-ready bar, and
   running three songs back to back as a set.

   These were written against a twelve-week course that framed them ("week 11:
   build a 3–4 song set"). The course is retired; the songs, the memory rule
   and the set run are not, so the tests came with them. Run with
   `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp, until } = require('./harness.js');

const SILENT = 987.767;            // above the detector's 420 Hz ceiling
const DESK = { width: 1440, height: 900 };
const SONG_KEY = 'bassTrainer.songs.v1';
const SETS_KEY = 'bassTrainer.sets.v1';

/** Drive a whole play-along to its end: plant the section root at each
    section's beat and then jump the clock past the last bar. Real time would
    make one assertion four minutes long. */
async function playWholeSong(page) {
  return page.evaluate(async () => {
    if (A.timer) { clearInterval(A.timer); A.timer = null; }
    A.muteUntil = 0;
    const song = SG.song;
    const beatMs = 60000 / song.bpm;
    SG.startAt = performance.now() - 10;               // count-in over
    for (const sec of BassSongs.timeline(song)) {
      SG.t0 = performance.now() - (sec.startBeat + 0.5) * beatMs;
      onStableNote({ midi: 24 + BassSongs.NAMES.indexOf(sec.root), hz: 100, cents: 0 });
      await new Promise(r => setTimeout(r, 30));
    }
    // Past the end: the 50ms ticker notices and finishes the play.
    SG.t0 = performance.now() - (BassSongs.totalBeats(song) * beatMs + 100);
    await new Promise(r => setTimeout(r, 300));
    return SG.finished;
  });
}

test('memory mode hides the roadmap, says so in the verdict, and banks a memory day', async () => {
  const app = await openApp(SILENT, '/index.html#songs', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#sgList .sg-item', { timeout: 5000 });
    await page.click('#sgList button[data-song="bib"][data-play="click"]');
    await page.waitForSelector('#sgArm:not(.hidden)', { timeout: 3000 });

    // The toggle is offered at arm time, for click plays.
    assert.equal(await page.isVisible('#sgMemSeg'), true, 'no memory toggle on a click play');
    await page.click('#sgMemSeg button[data-m="memory"]');
    await page.waitForTimeout(100);
    assert.match(await page.textContent('#sgMemNote'), /memory day/i);
    // The explainer must not promise "the bar position" ambiguously: what you
    // get is your bar number across the WHOLE song, never within a section.
    assert.match(await page.textContent('#sgMemNote'), /whole song/i,
      'the explainer should say the bar count runs across the whole song');
    await page.click('#sgTap');
    await page.waitForFunction(() => SG.t0 != null, null, { timeout: 5000 });

    // Mid-run: no roots, no neck, no live judge — count and click only.
    // Shift BOTH clocks past the count-in, or elapsed goes negative and the
    // ticker calls the play finished before it began.
    //
    // The analyser goes first, and that is not tidiness. SILENT is 987.767 Hz
    // to sit above the detector's 420 Hz ceiling, but the tracker occasionally
    // locks onto its quarter (246.9 Hz — B3) and reports a note. During the
    // count-in songPush drops it; once these two lines put the clock PAST the
    // count-in, that phantom B lands in the intro as a wrong note and a 100%
    // play scores 83%. That is the whole story of this test's flakiness.
    await page.evaluate(() => {
      if (A.timer) { clearInterval(A.timer); A.timer = null; }
      const shift = SG.startAt - (performance.now() - 10);
      SG.startAt -= shift; SG.t0 -= shift;
    });
    await page.waitForTimeout(150);
    const road = await page.evaluate(() => ({
      board: document.getElementById('sgBoard').classList.contains('hidden'),
      judge: document.getElementById('sgJudgeRow').classList.contains('hidden'),
      next: document.getElementById('sgNext').classList.contains('hidden'),
      root: document.getElementById('sgRoot').textContent,
      section: document.getElementById('sgSection').textContent,
      bar: document.getElementById('sgBar').textContent,
      progHidden: document.getElementById('sgProg').classList.contains('hidden'),
    }));
    assert.equal(road.board, true, 'the neck board is still showing');
    assert.equal(road.judge, true, 'the live judge pill leaks the expected root');
    assert.equal(road.next, true, 'the "Next:" warning is still showing');
    assert.equal(road.root, '?', 'the root display still names the root');
    assert.equal(road.section, 'From memory', 'the section name is half the roadmap');
    // Bar-within-section resets AT each section change — from memory only the
    // ABSOLUTE position may show. Back in Black is 24 bars (4+8+2+2+8).
    assert.match(road.bar, /^bar 1 of 24\b/,
      'memory mode leaks section boundaries: the bar line reads "' + road.bar + '"');
    assert.equal(road.progHidden, true,
      'the "section N of M" counter tells the player exactly when sections turn over');

    assert.equal(await playWholeSong(page), true, 'the play never finished');
    const summary = await page.textContent('#sgSummary');
    assert.match(summary, /from memory/i, 'the verdict does not say it was from memory');
    assert.match(summary, /banks a memory day/i, 'a 100% full memory play must bank a day');
    const rec = await page.evaluate((k) =>
      JSON.parse(localStorage.getItem(k)).bib, SONG_KEY);
    assert.equal((rec.memoryDays || []).length, 1, 'no memory day in the store');
    assert.ok(rec.bestAccuracy > 0, 'a memory play is still a graded full play');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a second memory day makes a song gig-ready, and the pills say so', async () => {
  const app = await openApp(SILENT, '/index.html#songs', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#sgList .sg-item', { timeout: 5000 });
    // One memory day already banked, on an earlier date.
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({
        bib: { id: 'bib', plays: 4, bestAccuracy: 0.95, bestFull: true,
               memoryBest: 0.92, memoryDays: ['2020-01-01'] },
      }));
    }, SONG_KEY);
    await page.click('#tabbar button[data-tab="tuner"]');
    await page.click('#tabbar button[data-tab="songs"]');
    await page.waitForSelector('#sgList .sg-item', { timeout: 3000 });
    assert.match(await page.textContent('#sgList'), /learning · memory day 1 of 2/,
      'one banked day should read as learning, day 1 of 2');

    await page.click('#sgList button[data-song="bib"][data-play="click"]');
    await page.waitForSelector('#sgArm:not(.hidden)', { timeout: 3000 });
    await page.click('#sgMemSeg button[data-m="memory"]');
    await page.click('#sgTap');
    await page.waitForFunction(() => SG.t0 != null, null, { timeout: 5000 });
    assert.equal(await playWholeSong(page), true, 'the play never finished');

    assert.match(await page.textContent('#sgSummary'), /gig-ready/i,
      'the verdict should announce the second day made it gig-ready');
    // Back on the list, where the pills live.
    await page.click('#sgBack');
    await page.waitForSelector('#sgList .sg-item', { timeout: 3000 });
    const after = await page.evaluate(() => ({
      list: document.getElementById('sgList').innerText,
      board: document.getElementById('sgSetStatus').innerText,
    }));
    assert.match(after.list, /gig-ready/, 'the song pill did not advance');
    assert.match(after.board, /The set · 1 of 10 gig-ready/i, 'the set board did not advance');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the set board shows each song\'s best memory-run %, and nothing for no run', async () => {
  // The board named the songs to work on — "lowest scores, fewest memory days"
  // — without showing a score. A song with no memory run shows NOTHING: 0%
  // would read as a terrible run rather than no run.
  const app = await openApp(SILENT, '/index.html#songs', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#sgList .sg-item', { timeout: 5000 });
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({
        bib: { id: 'bib', plays: 4, bestAccuracy: 0.95, bestFull: true,
               memoryBest: 0.87, memoryDays: ['2020-01-01'] },
        hth: { id: 'hth', plays: 2, bestAccuracy: 0.8, bestFull: true },
      }));
    }, SONG_KEY);
    await page.click('#tabbar button[data-tab="tuner"]');
    await page.click('#tabbar button[data-tab="songs"]');
    await page.waitForSelector('#sgList .sg-item', { timeout: 3000 });
    const pills = await page.evaluate(() =>
      [...document.querySelectorAll('#sgSetStatus .pill')].map(p => p.textContent));
    const bib = pills.find(p => /Back in Black/.test(p));
    const hth = pills.find(p => /Highway to Hell/.test(p));
    assert.match(bib || '', /87%/, 'Back in Black\'s best memory % is missing from the set board');
    assert.doesNotMatch(hth || '', /%/, 'a song with no memory run must show nothing, not a %');

    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a 3-song setlist run gives one combined verdict and banks into the sets store', async () => {
  const app = await openApp(SILENT, '/index.html#songs', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#stPickRow button', { timeout: 5000 });

    // Fewer than three songs must not start a set.
    await page.click('#stPickRow button[data-st="bib"]');
    await page.click('#stPickRow button[data-st="hth"]');
    assert.equal(await page.evaluate(() => document.getElementById('stStart').disabled), true,
      'two songs armed the start button');
    await page.click('#stPickRow button[data-st="tnt"]');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.getElementById('stStart').disabled), false);
    assert.match(await page.textContent('#stPickNote'), /Back in Black → Highway to Hell → T\.N\.T\./,
      'set order should follow the book, easiest first');

    await page.click('#stStart');
    await page.waitForSelector('#stRun:not(.hidden)', { timeout: 3000 });
    // Play one correct root early in each song (a made entry), warping the clock.
    const finished = await page.evaluate(async () => {
      if (A.timer) { clearInterval(A.timer); A.timer = null; }
      A.muteUntil = 0;
      for (const seg of ST.run.segments()) {
        const beatMs = 60000 / seg.song.bpm;
        ST.t0 = performance.now() - (seg.startMs + 1.5 * beatMs);
        onStableNote({ midi: 24 + BassSongs.NAMES.indexOf(seg.song.sections[0].root), hz: 100, cents: 0 });
        await new Promise(r => setTimeout(r, 30));
      }
      ST.t0 = performance.now() - (ST.run.totalMs() + 100);
      await new Promise(r => setTimeout(r, 300));
      return ST.finished;
    });
    assert.equal(finished, true, 'the set never finished');

    const summary = await page.textContent('#stSummary');
    assert.match(summary, /On the root .*100%.* overall/, 'no combined verdict');
    assert.match(summary, /Back in Black/, 'per-song rows missing');
    assert.match(summary, /Every entry made/, 'the transition note is missing');

    const banked = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SETS_KEY);
    assert.equal(banked.runs.length, 1, 'the set run was not banked');
    assert.deepEqual(banked.runs[0].songs, ['bib', 'hth', 'tnt']);
    assert.equal(banked.runs[0].overall, 1);
    assert.deepEqual(banked.runs[0].entriesMissed, []);
    // And nothing leaked into the songs store, whose values app-theory
    // iterates as songs.
    const songStore = await page.evaluate((k) =>
      JSON.parse(localStorage.getItem(k) || '{}'), SONG_KEY);
    for (const key in songStore) {
      assert.ok(songStore[key].id === key, 'a non-song key leaked into the songs store: ' + key);
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
