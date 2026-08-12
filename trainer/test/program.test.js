/* End-to-end tests for the 12-week course build-out: the phase-grouped week
   picker, week 4's configured links, rhythm drills, memory mode, setlist runs
   and the end-of-course gig-readiness report. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp, until } = require('./harness.js');
const Course = require('../../shared/course.js');

const SILENT = 987.767;            // above the detector's 420 Hz ceiling
const DESK = { width: 1440, height: 900 };
const SONG_KEY = 'bassTrainer.songs.v1';
const SETS_KEY = 'bassTrainer.sets.v1';

test('the week picker is three phase rows, twelve weeks, and week 9 says 40 minutes', async () => {
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    const pick = await page.evaluate(() => ({
      phases: [...document.querySelectorAll('#tab-practice .wp-phase')].map(p =>
        ({ label: p.querySelector('.wp-label').textContent,
           weeks: [...p.querySelectorAll('[data-wk]')].map(b => b.dataset.wk) })),
      buttons: document.querySelectorAll('#tab-practice [data-wk]').length,
    }));
    assert.equal(pick.buttons, 12, 'twelve week buttons');
    assert.deepEqual(pick.phases.map(p => p.label),
      ['Foundations', 'Repertoire', 'Performance'], 'one labelled row per phase');
    assert.deepEqual(pick.phases.map(p => p.weeks.join(',')),
      ['1,2,3,4', '5,6,7,8', '9,10,11,12']);

    // The Performance phase says its price on the week header, up front.
    await page.click('[data-wk="9"]');
    await page.waitForTimeout(200);
    const wk9 = await page.evaluate(() => document.getElementById('tab-practice').innerText);
    assert.match(wk9, /Performance/, 'week 9 names its phase');
    assert.match(wk9, /up to 40 minutes/i, 'the 40-minute honesty is missing from week 9');
    // /i because the eyebrow style renders in uppercase.
    assert.match(wk9, /The set · \d+ of 10 gig-ready/i,
      'the Performance phase should show the set-status board on the Practice tab');
    // And a Foundations week does not carry the Performance warning.
    await page.click('[data-wk="2"]');
    await page.waitForTimeout(200);
    const wk2 = await page.evaluate(() => document.getElementById('tab-practice').innerText);
    assert.doesNotMatch(wk2, /up to 40 minutes/i, 'week 2 borrowed week 9\'s warning');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('week 4\'s links land configured: the C box drill, and YSMANL highlighted', async () => {
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    await page.click('[data-wk="4"]');
    await page.waitForTimeout(200);

    // The drill link teaches "slide the box to C" — the picker must land there.
    await page.evaluate(() => {
      const it = [...document.querySelectorAll('#tab-practice .pitem')]
        .find(p => /moveable box to C/i.test(p.innerText));
      [...it.querySelectorAll('button')].find(b => /Drill the C box/i.test(b.textContent)).click();
    });
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    await page.click('#startBtn');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 5000 });
    const drill = await page.evaluate(() => ({
      win: document.getElementById('drWinSel').selectedOptions[0].textContent,
      preview: document.getElementById('drPreview').textContent,
    }));
    assert.match(drill.win, /Box · A string, fret 3/, 'the picker window is "' + drill.win + '"');
    assert.match(drill.preview, /C minor pentatonic/i, 'the preview does not name the C box');

    // The song link lands on You Shook Me, highlighted and in view.
    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 3000 });
    await page.evaluate(() => {
      const it = [...document.querySelectorAll('#tab-practice .pitem')]
        .find(p => /whole roadmap/i.test(p.innerText) && /You Shook Me/i.test(p.innerText));
      [...it.querySelectorAll('button')].find(b => /let the app listen/i.test(b.textContent)).click();
    });
    await page.waitForSelector('#sgList .sg-item', { timeout: 5000 });
    await page.waitForTimeout(200);
    const target = await page.evaluate(() => {
      const el = document.querySelector('#sgList .sg-item.is-target');
      return el ? el.innerText : null;
    });
    assert.ok(target, 'no song entry is highlighted');
    assert.match(target, /You Shook Me All Night Long/, 'the wrong song is highlighted');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a rhythm drill runs through the picker and its verdict is about timing', async () => {
  const app = await openApp(SILENT, '/index.html#drill', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 5000 });
    await page.click('#drTypeSeg button[data-k="rhythm"]');
    await page.waitForTimeout(150);
    const picker = await page.evaluate(() => ({
      pat: !document.getElementById('drPatWrap').classList.contains('hidden'),
      bars: !document.getElementById('drBarsWrap').classList.contains('hidden'),
      win: document.getElementById('drWinWrap').classList.contains('hidden'),
      variant: document.getElementById('drVarWrap').classList.contains('hidden'),
      roots: [...document.getElementById('drRootSel').options].map(o => o.textContent[0]).join(''),
      preview: document.getElementById('drPreview').textContent,
    }));
    assert.ok(picker.pat && picker.bars, 'pattern and length controls are not shown');
    assert.ok(picker.win, 'the neck-window control is up for a drill that has no window');
    assert.ok(picker.variant, 'a rhythm drill offers a "middle only" that means nothing');
    assert.equal(picker.roots, 'EADGCB', 'the six taught roots, in taught order');
    assert.match(picker.preview, /the verdict is about the click/i);

    await page.selectOption('#drBarsSel', '4');
    await page.waitForTimeout(120);
    await page.click('#drStart');
    await page.waitForSelector('#drRun:not(.hidden)', { timeout: 3000 });
    assert.match(await page.textContent('#drRunKind'), /Straight eighths · 4 bars/);

    // Play all 32 onsets (fast, so the honest verdict is "off the click").
    const phase = await page.evaluate(async () => {
      if (A.timer) { clearInterval(A.timer); A.timer = null; }
      A.muteUntil = 0;
      for (let guard = 0; guard < 40 && DR.phase === 'running'; guard++) {
        const want = DR.run.expected();
        if (!want) break;
        onStableNote({ midi: want.midi, hz: 100, cents: 0 });
        await new Promise(r => setTimeout(r, 25));
      }
      return DR.phase;
    });
    assert.equal(phase, 'done', 'the rhythm run did not finish');
    const verdict = await page.textContent('#drPanel');
    assert.match(verdict, /Against the click/i,
      'the verdict must be a timing verdict, measured against the click');
    assert.match(verdict, /mastery day/i, 'and say what it did to mastery');
    // It schedules like every other drill: the shelf now holds it.
    assert.match(await page.textContent('#drShelfBody'), /Straight eighths on E · 4 bars/);
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/** Drive a full click-mode play by warping the song clock, pushing one correct
    root per section. The fake mic plays SILENT, so every note here is ours. */
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
    await page.click('#sgTap');
    await page.waitForFunction(() => SG.t0 != null, null, { timeout: 5000 });

    // Mid-run: no roots, no neck, no live judge — count and click only.
    // Shift BOTH clocks past the count-in, or elapsed goes negative and the
    // ticker calls the play finished before it began.
    await page.evaluate(() => {
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
    }));
    assert.equal(road.board, true, 'the neck board is still showing');
    assert.equal(road.judge, true, 'the live judge pill leaks the expected root');
    assert.equal(road.next, true, 'the "Next:" warning is still showing');
    assert.equal(road.root, '?', 'the root display still names the root');
    assert.equal(road.section, 'From memory', 'the section name is half the roadmap');

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

test('the gig report appears only when all twelve weeks are ticked, and pluralises', async () => {
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });

    // The old trigger — week 3 alone — must NOT produce a report any more.
    await page.evaluate(() => {
      ['w3cp0', 'w3cp1', 'w3cp2'].forEach(id => S.practice.checkpoints[id] = true);
      save(); renderPractice();
    });
    let text = await page.evaluate(() => document.getElementById('tab-practice').innerText);
    assert.equal(await page.$('#reportBox'), null,
      'three ticked week-3 checkpoints still summon the old report');
    assert.doesNotMatch(text, /3 weeks done/, 'the old card\'s copy is still rendered');

    // Eleven and a half weeks is not the course either.
    await page.evaluate((ids) => {
      ids.forEach(id => S.practice.checkpoints[id] = true);
      save(); renderPractice();
    }, Course.WEEKS.flatMap(w => w.checkpoints.map(c => c.id)).slice(0, -1));
    assert.equal(await page.$('#reportBox'), null, 'the report appeared a checkpoint early');

    // All twelve weeks: the report, with per-song status and the paste block.
    await page.evaluate((ids) => {
      ids.forEach(id => S.practice.checkpoints[id] = true);
      save(); renderPractice();
    }, Course.WEEKS.flatMap(w => w.checkpoints.map(c => c.id)));
    await page.waitForSelector('#reportBox', { timeout: 3000 });
    const report = await page.textContent('#reportBox');
    assert.match(report, /12-week AC\/DC course/, 'the report does not name the course');
    assert.match(report, /0 of 10 gig-ready/, 'per-song status vs the bar is missing');
    assert.match(report, /Thunderstruck \(134 bpm\): new/, 'songs are not listed against the bar');
    assert.match(report, /Weakest three, in order:/, 'the weakest songs are not named');
    assert.match(report, /Set runs banked: none yet/, 'set runs are not reported');
    assert.match(report, /set two/i, 'the paste block does not ask for a set-two program');
    // Pluralisation: 0 practice days must not read "0 day".
    assert.doesNotMatch(report, /\b1 questions\b|\b0 day\b|\b1 runs\b/, 'a count disagrees with its noun');
    // Copy mechanics survive the new card.
    assert.equal(await page.isVisible('#copyReport'), true, 'the copy button is gone');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
