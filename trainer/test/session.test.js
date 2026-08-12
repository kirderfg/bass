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

const DRILL_KEY = 'bassTrainer.drills.v1';
const STATE_KEY = 'bassTheoryTrainer.v1';

test('every labelled note on the study board answers a tap', async () => {
  // The board is captioned "Tap any fret to hear it". Markers are drawn on top of
  // the fret hit rects, and the note circle used to swallow the click — so the
  // named notes, the whole point of the screen, were the silent ones while the
  // unnamed sharps between them played.
  const app = await openApp(SILENT, '/index.html#trainer', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#studyFb .neck-svg', { timeout: 5000 });
    await page.evaluate(() => {
      window.__played = 0;
      const AC = window.AudioContext || window.webkitAudioContext;
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () { window.__played++; return orig.call(this); };
    });
    const dead = await page.evaluate(async () => {
      const svg = document.querySelector('#studyFb .neck-svg');
      const marks = [...svg.querySelectorAll('.neck-marker')];
      const out = [];
      for (const m of marks) {
        m.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise(r => setTimeout(r, 15));
        const r = m.getBoundingClientRect();
        const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!under) continue;                       // scrolled out of reach: not a claim
        const before = window.__played;
        under.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 10));
        if (window.__played === before) out.push(m.dataset.s + '/' + m.dataset.f);
      }
      return { dead: out, total: marks.length };
    });
    assert.ok(dead.total > 0, 'no labelled notes on the board at all');
    assert.deepEqual(dead.dead, [],
      'these labelled frets ate their own tap: ' + dead.dead.join(', '));
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('no screen names an app that no longer exists', async () => {
  // Two apps became one page. Seven places still pointed at "the Theory Trainer"
  // and "the Live Trainer" — names that appear in no menu and on no screen.
  const app = await openApp(SILENT, '/index.html#tuner', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    const found = [];
    for (const tab of ['practice', 'scales', 'chords', 'trainer',
                       'tuner', 'find', 'echo', 'drill', 'songs']) {
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
    // wording per mode rather than the quiz's.
    assert.doesNotMatch(feed, /Answers here/, 'the tuner still claims to take answers');
    assert.match(feed, /Tune up/, 'and it should say what tuning does instead');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('tuning every string ticks "Tune up" off the day\'s practice', async () => {
  // The tuner watched all five strings land in the green and the practice item
  // stayed an empty box. Driven honestly: the mic really hears B E A D G.
  const app = await openApp(FIVE_STRINGS, '/index.html#tuner', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('#tuneDone:not(.hidden)', { timeout: 30000 });

    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 3000 });
    assert.equal(await page.isChecked('input[data-item="w1t"]'), true,
      'five green strings did not tick the tune-up item');
    // Once a day, and never fighting a manual untick.
    await page.uncheck('input[data-item="w1t"]');
    await page.click('#tabbar button[data-tab="tuner"]');
    await page.waitForTimeout(400);
    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 3000 });
    assert.equal(await page.isChecked('input[data-item="w1t"]'), false,
      'unticking it by hand did not stick');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the drill click is on, and whether a run can bank a day is said before it starts', async () => {
  // Mastery needs a run that is clean AND in time; only the day's first run can
  // bank one; "in time" can only be measured against a click. With the click off
  // by default and its checkbox below the fold, a beginner's first-ever run was
  // spent before the rule had been stated anywhere.
  const app = await openApp(SILENT, '/index.html#drill', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.isChecked('#drMet'), true, 'the click ships off again');

    assert.equal(await page.isVisible('#drBankNote'), true);
    assert.match(await page.textContent('#drBankNote'), /can bank a mastery day/);
    const gap = await page.evaluate(() => {
      const s = document.getElementById('drStart').getBoundingClientRect();
      const b = document.getElementById('drBankNote').getBoundingClientRect();
      return Math.round(b.top - s.bottom);
    });
    assert.ok(gap >= 0 && gap < 220, 'the rule is ' + gap + 'px from the button that starts the run');

    // Turned off, it says the opposite — and offers the fix.
    await page.uncheck('#drMet');
    await page.waitForTimeout(150);
    const off = await page.textContent('#drBankNote');
    assert.match(off, /cannot bank a mastery day/);
    await page.click('#drMetOn');
    await page.waitForTimeout(150);
    assert.equal(await page.isChecked('#drMet'), true, '"Turn the click on" did not');
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

test('a due review is an item on the day\'s list, and readable without the mic', async () => {
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    await page.evaluate(([dk, sk]) => {
      localStorage.setItem(dk, JSON.stringify({
        d1: {
          id: 'd1', label: 'E minor pentatonic · Open position · frets 0–5',
          due: '2020-01-01', box: 1, ci: 'blocked', bpm: 60, attempts: [],
          cfg: { tuning: 5, type: 'scale' },
        },
      }));
      // Give it a yesterday, so the orientation line replaces "Day 1 — welcome".
      const st = JSON.parse(localStorage.getItem(sk)) || {};
      st.practice = st.practice || { week: 1, log: {}, checkpoints: {}, dismissed: [] };
      st.practice.log['2020-01-01'] = { items: ['w1a'], week: 1 };
      localStorage.setItem(sk, JSON.stringify(st));
    }, [DRILL_KEY, STATE_KEY]);
    await page.reload();
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });

    // The review was scheduled by the engine and shown only as a number in a
    // tile, so working the list to 5/5 meant skipping the day's actual homework.
    const first = await page.evaluate(() => {
      const p = document.querySelector('#tab-practice .pitem');
      return { id: p.querySelector('[data-item]').dataset.item, text: p.innerText };
    });
    assert.equal(first.id, 'rev', 'the due review is not the first item tonight');
    assert.match(first.text, /due today/i);
    const all = await page.evaluate(() => document.getElementById('tab-practice').innerText);
    assert.match(all, /Tonight: week 1/, 'no line saying what tonight is');
    // "1 drills due now" and "1 days practiced" both shipped.
    assert.doesNotMatch(all, /\b1 drills\b/);
    assert.doesNotMatch(all, /\b1 days\b/);
    assert.doesNotMatch(all, /practiced/, 'practised/practiced spelled both ways');

    // What is due is a fact about your history, not about the microphone.
    await page.click('#tabbar button[data-tab="drill"]');
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    assert.equal(await page.isVisible('#gateExtra'), true,
      'what is due is locked behind the mic gate');
    assert.match(await page.textContent('#gateExtra'), /E minor pentatonic/);
    assert.equal(await page.evaluate(() => window.__gum), 0, 'reading it cost a mic grant');
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
