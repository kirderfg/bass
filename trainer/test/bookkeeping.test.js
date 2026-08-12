/* Regression tests for the app's BOOKKEEPING — the counts, labels and pointers
   around the teaching, which is where a second beginner's session found almost
   everything wrong. A wrong number is worse than a missing one: it is trusted.

   Every test here is a defect that shipped. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp } = require('./harness.js');

const SILENT = 987.767;            // above the detector's 420 Hz ceiling
const DESK = { width: 1440, height: 900 };
const DRILL_KEY = 'bassTrainer.drills.v1';

test('every theory card can actually be dismissed', async () => {
  // The ✕ was an inline onclick="dismissCard(...)", which resolves against
  // window — and the function became private when the two apps were merged into
  // one document. All ten buttons threw ReferenceError and did nothing.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    let dismissed = 0;
    for (const tab of ['practice', 'scales', 'chords', 'trainer']) {
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
    assert.ok(dismissed >= 5, 'only ' + dismissed + ' theory cards found to dismiss');
    // Dismissals are remembered, so they do not come back on the next visit.
    // (The hash follows the tab now, so a bare reload lands on the last one.)
    await page.goto(page.url().replace(/#.*$/, '') + '#practice');
    await page.waitForSelector('#tab-practice.on', { timeout: 4000 });
    assert.equal(await page.$('#tab-practice [data-dismiss]'), null,
      'a dismissed card came back after a reload');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('hunting for a note is not counted as getting it wrong', async () => {
  /* Find it exists to make you hunt. Every wrong note played while hunting used
     to bank an answer AND the eventual find banked another, so four questions
     all answered correctly reported "4 correct, 8 asked" and the practice plan
     reported 50% accuracy. One stored answer per question, graded on the first
     attempt — which is what the heat map and the "under 2 seconds" checkpoint
     already assume. */
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => localStorage.removeItem('bassTheoryTrainer.v1'));

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
      JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')).stats);
    assert.equal(st.answered, 4,
      'four questions banked ' + st.answered + ' answers — hunting is being counted');
    assert.equal(st.correct, 0,
      'a question found only after two wrong notes is not a first-attempt correct');

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

test('the speed the week-1 checkpoint asks about is actually shown', async () => {
  // The checkpoint said to check '"avg answer" in trainer stats'. Those words
  // appeared nowhere in the app, and the figure was hidden until five answers.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    const cps = await page.evaluate(() => document.getElementById('tab-practice').innerText);
    assert.doesNotMatch(cps, /avg answer/, 'the checkpoint still points at a stat that does not exist');
    assert.doesNotMatch(cps, /"Your stats"/, 'and at a panel by the wrong name');
    const named = (cps.match(/seconds per answer/i) || [])[0];
    assert.ok(named, 'the checkpoint should name the figure the app really shows');

    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')) || {};
      st.stats = Object.assign({ answered: 0, correct: 0, byString: {}, heat: {} }, st.stats);
      st.stats.answered = 3; st.stats.correct = 3; st.stats.speed = [1.4, 1.6, 1.5];
      localStorage.setItem('bassTheoryTrainer.v1', JSON.stringify(st));
    });
    await page.click('#tabbar button[data-tab="trainer"]');
    await page.waitForSelector('#tab-trainer.on', { timeout: 3000 });
    const stats = await page.evaluate(() => document.getElementById('statsWrap').innerText);
    assert.match(stats, /seconds per answer/i, 'three answers should be enough to show a figure');
    assert.match(stats, /1\.5s/, 'the average of 1.4, 1.6 and 1.5 should be shown');
    assert.match(stats, /under 2s/, 'and held against what the checkpoint asks for');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('switching neck does not leave the plan promising a review Drills cannot run', async () => {
  /* A drill is a fingering, so the Drills tab only shows the ones for the neck
     you are on — but the practice plan counted both. On 4-str it said "1 drill
     due now" and put that review first on the night's list, and pressing it
     landed on a Drills tab with nothing due. */
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    await page.evaluate((dk) => {
      localStorage.setItem(dk, JSON.stringify({
        d5: {
          id: 'd5', label: 'E minor pentatonic · Open position · frets 0–5',
          due: '2020-01-01', box: 1, ci: 'blocked', bpm: 60, attempts: [],
          cfg: { tuning: 5, type: 'scale' },
        },
      }));
    }, DRILL_KEY);
    await page.reload();
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    assert.equal(await page.evaluate(() =>
      document.querySelector('#tab-practice .pitem [data-item]').dataset.item), 'rev',
      'the 5-string drill should be due on the 5-string neck');

    // Now the other neck. The 5-string drill is not runnable here.
    await page.click('#tuneToggle button[data-t="4"]');
    await page.waitForTimeout(300);
    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 3000 });
    const text = await page.evaluate(() => document.getElementById('tab-practice').innerText);
    assert.equal(await page.evaluate(() =>
      document.querySelector('#tab-practice .pitem [data-item]').dataset.item !== 'rev'), true,
      'the plan still puts an unrunnable review first on the list');
    assert.doesNotMatch(text, /1 drill due now/, 'the plan still claims a drill is due');
    // And it says where they went, rather than looking like a deletion.
    assert.match(text, /belong.? to the 5-string neck/,
      'the drills simply vanished with no explanation');
    assert.doesNotMatch(text, /Nothing recorded yet in any of the three places/,
      '"nothing recorded" is untrue when a drill exists on the other neck');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the quiz that marks a fret does not offer to play it for you', async () => {
  // "Name the note" marks a fret and asks what it is, above a caption reading
  // "Tap any fret to hear it" — an invitation to cheat the quiz being taken.
  const app = await openApp(SILENT, '/index.html#trainer', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-trainer.on', { timeout: 4000 });
    await page.click('#tModeSeg button[data-k="name"]').catch(async () => {
      await page.click('[data-k="name"]');
    });
    await page.waitForSelector('#quizFb .neck-svg', { timeout: 3000 });
    const quiz = await page.evaluate(() => ({
      caption: document.getElementById('tab-trainer').innerText,
      taps: document.querySelectorAll('#quizFb .neck-hit').length,
    }));
    assert.equal(quiz.taps, 0, 'the board still has tap targets that would play the answer');
    assert.doesNotMatch(quiz.caption, /Tap any fret to hear it/,
      'and still invites the player to use them');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the minutes on the practice card agree with the items on it', async () => {
  // A hard-coded "Daily shape" line said 10' technique beside an 8-minute
  // technique item, always summed to 30 against a header reading 35 or 40, and
  // mentioned neither the tune-up, the review nor the bonus.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    for (const week of [1, 2, 3]) {
      await page.click('[data-wk="' + week + '"]');
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const sec = document.getElementById('tab-practice');
        const header = (sec.innerText.match(/(\d+) min/) || [])[1];
        const line = (sec.innerText.match(/Tonight: ([^\n]*?)\. Check things off/) || [])[1] || '';
        const mins = [...line.matchAll(/(\d+)'/g)].map(m => +m[1]);
        const items = [...sec.querySelectorAll('.pitem .pcat')]
          .map(e => +(e.textContent.match(/(\d+) min/) || [])[1]);
        return { header: +header, line, lineSum: mins.reduce((a, b) => a + b, 0),
                 itemSum: items.reduce((a, b) => a + b, 0), n: mins.length, items: items.length };
      });
      assert.equal(r.n, r.items, 'week ' + week + ': the shape line lists ' + r.n +
        ' blocks for ' + r.items + ' items');
      assert.equal(r.lineSum, r.itemSum, 'week ' + week + ': the shape line sums to ' +
        r.lineSum + ' but the items sum to ' + r.itemSum);
      assert.equal(r.header, r.itemSum, 'week ' + week + ': the header says ' + r.header +
        ' min for ' + r.itemSum + ' minutes of items');
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the drill board draws the frets its own heading names', async () => {
  // A drill headed "Open position · frets 0–5" drew its box over frets 0–3 —
  // the frets the shape happens to touch — so the picture and the heading
  // disagreed about what the drill was. And it drew all twelve frets for six
  // notes, leaving three quarters of the board empty on a desktop.
  const app = await openApp(SILENT, '/index.html#drill', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 5000 });
    await page.click('#drStart');
    await page.waitForSelector('#drRun:not(.hidden)', { timeout: 3000 });
    const r = await page.evaluate(() => {
      const svg = document.querySelector('#drBoard .neck-svg');
      // No tap handler on this board, so the printed fret numbers are the record
      // of what was drawn.
      const cols = [...svg.querySelectorAll('.neck-fretnum')]
        .map(e => parseInt(e.textContent, 10)).filter(n => !isNaN(n));
      const card = svg.closest('.card').getBoundingClientRect().width;
      return { title: document.getElementById('drRunTitle').textContent,
               from: Math.min.apply(null, cols), to: Math.max.apply(null, cols),
               board: svg.getBoundingClientRect().width, card };
    });
    const m = r.title.match(/frets (\d+)–(\d+)/);
    assert.ok(m, 'the default drill should name a fret range: "' + r.title + '"');
    assert.ok(r.from <= +m[1] && r.to >= +m[2],
      'heading says frets ' + m[1] + '–' + m[2] + ' but the board draws ' + r.from + '–' + r.to);
    assert.ok(r.to <= +m[2] + 3,
      'the board runs to fret ' + r.to + ' for a drill that ends at ' + m[2]);
    assert.ok(r.board > r.card * 0.7,
      'the board is ' + Math.round(r.board) + 'px inside a ' + Math.round(r.card) + 'px card');
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
