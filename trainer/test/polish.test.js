/* Regression tests for the third simulated-beginner session's findings: links
   that landed on the right tab but unconfigured, work that vanished from the
   day's list the moment it was done, taps and pills that said nothing or said
   it too long, and copy that used three names for one destination.

   Every test here is a defect that shipped. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp, until } = require('./harness.js');

const SILENT = 987.767;            // above the detector's 420 Hz ceiling
const DESK = { width: 1440, height: 900 };
const DRILL_KEY = 'bassTrainer.drills.v1';

/** Click the practice-plan link whose label matches, inside the item whose text matches. */
async function clickPlanLink(page, itemRe, labelRe) {
  return page.evaluate(([itemSrc, labelSrc]) => {
    const itemPat = new RegExp(itemSrc, 'i'), labelPat = new RegExp(labelSrc, 'i');
    const it = [...document.querySelectorAll('#tab-practice .pitem')]
      .find(p => itemPat.test(p.innerText));
    if (!it) return 'item not found';
    const b = [...it.querySelectorAll('button, a')].find(b => labelPat.test(b.textContent));
    if (!b) return 'link not found';
    b.click();
    return 'ok';
  }, [itemRe.source, labelRe.source]);
}

test('week 3\'s "check it in Drills" lands with the moveable box pre-picked', async () => {
  // The item teaches the MOVEABLE box anchored at fret 5; the link opened the
  // Drills picker on "Open position · frets 0–5" — a different shape, and the
  // beginner has no way to know the destination is showing the wrong one.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    await page.click('[data-wk="3"]');
    await page.waitForTimeout(200);
    assert.equal(await clickPlanLink(page, /MOVEABLE/, /check it in Drills/), 'ok');
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    await page.click('#startBtn');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 5000 });
    const r = await page.evaluate(() => ({
      win: document.getElementById('drWinSel').selectedOptions[0].textContent,
      preview: document.getElementById('drPreview').textContent,
    }));
    assert.match(r.win, /Box · B string, fret 5/,
      'the picker window is still "' + r.win + '"');
    assert.match(r.preview, /E minor pentatonic · Box · B string, fret 5/i,
      'the preview does not name the box the plan item taught');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('week 3\'s "let the app listen" lands on T.N.T., highlighted and in view', async () => {
  // The item is about T.N.T.; the link landed at the top of the song list, on
  // Back in Black.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    await page.click('[data-wk="3"]');
    await page.waitForTimeout(200);
    // Match on the Music item's own phrasing — "T.N.T." alone also matches the
    // week's tune-up item, which mentions the song by name.
    assert.equal(await clickPlanLink(page, /Loop verse → chorus/, /listen while you play/), 'ok');
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 3000 });
    await page.click('#startBtn');
    await page.waitForSelector('#sgList .sg-item', { timeout: 5000 });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const el = document.querySelector('#sgList .sg-item.is-target');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { text: el.innerText, top: rect.top, bottom: rect.bottom, vh: innerHeight };
    });
    assert.ok(r, 'no song entry is highlighted');
    assert.match(r.text, /T\.N\.T\./, 'the wrong song is highlighted');
    assert.ok(r.bottom > 0 && r.top < r.vh, 'T.N.T. is highlighted but out of view');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('tapping an unmarked study fret names the note, then lets it go', async () => {
  // The default board (names on, naturals only) leaves the accidentals
  // unmarked. Tapping one played a sound and showed NOTHING — the reveal code
  // ran only with names hidden, and skipped accidentals even then.
  const app = await openApp(SILENT, '/index.html#trainer', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#studyFb .neck-svg', { timeout: 5000 });
    await page.evaluate(() =>
      document.querySelector('#studyFb .neck-hit[data-s="1"][data-f="2"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const m = await until(page, () => {
      const g = document.querySelector('#studyFb .neck-marker[data-s="1"][data-f="2"]');
      return g ? { cls: g.getAttribute('class'),
                   label: (g.querySelector('.neck-dot-label') || {}).textContent } : null;
    }, null, 1500);
    assert.ok(m, 'the tap left no mark at all');
    assert.equal(m.label, 'F#', 'the mark does not name the note that was heard');
    // A peek, not a new scale tone: it must not wear the permanent notes' dress.
    assert.doesNotMatch(m.cls, /\bis-tone\b|\bis-ghost\b/,
      'the transient label is styled like a permanent labelled note');
    await page.waitForTimeout(1900);
    assert.equal(await page.evaluate(() =>
      !!document.querySelector('#studyFb .neck-marker[data-s="1"][data-f="2"]')), false,
      'the peek is still on the board after 2 seconds');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a finished review stays on tonight\'s list, ticked and counted', async () => {
  // Running the day's due review made it VANISH from the list: "0/6 today"
  // silently became "0/5", and the one item the app itself scheduled left no
  // trace of having been done.
  const app = await openApp(SILENT, '/index.html#drill', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
    await page.evaluate((dk) => {
      // A real, runnable cfg — the id is what drillId() would mint for it.
      localStorage.setItem(dk, JSON.stringify({
        '5|scale|minPent|E|0-5': {
          id: '5|scale|minPent|E|0-5', label: 'E minor pentatonic · Open position · frets 0–5',
          due: '2020-01-01', box: 1, ci: 'blocked', bpm: 60, attempts: [],
          cfg: { tuning: 5, type: 'scale', scaleKey: 'minPent', rootPc: 4,
                 from: 0, to: 5, winLabel: 'Open position · frets 0–5' },
        },
      }));
    }, DRILL_KEY);
    await page.reload();
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
    await page.click('#startBtn');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 5000 });
    assert.match(await page.textContent('#drStart'), /review/i,
      'the seeded review is not what the primary button runs');
    await page.click('#drStart');
    await page.waitForSelector('#drRun:not(.hidden)', { timeout: 3000 });
    // Play the whole ascending shape by feeding the tracker's verdicts in.
    // The analyser poll is stopped first: the fake mic's out-of-range tone can
    // surface as a stable subharmonic and push a wrong note into the run.
    await page.evaluate(async () => {
      if (A.timer) { clearInterval(A.timer); A.timer = null; }
      A.muteUntil = 0;
      for (let guard = 0; guard < 20 && DR.phase === 'running'; guard++) {
        const want = DR.run.expected();
        if (!want) break;
        onStableNote({ midi: want.midi, hz: 100, cents: 0 });
        await new Promise(r => setTimeout(r, 60));
      }
      return DR.phase;
    });
    assert.equal(await page.evaluate(() => DR.phase), 'done', 'the review run did not finish');

    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 3000 });
    const r = await page.evaluate(() => {
      const p = document.querySelector('#tab-practice .pitem');
      const cb = p.querySelector('input[data-item]');
      return { id: cb.dataset.item, checked: cb.checked, disabled: cb.disabled,
               rowDone: p.classList.contains('done'), text: p.innerText,
               all: document.getElementById('tab-practice').innerText };
    });
    assert.equal(r.id, 'rev', 'the finished review vanished from tonight\'s list');
    assert.equal(r.checked, true, 'the finished review is not ticked');
    assert.equal(r.disabled, true, 'a derived tick must not be untickable state');
    assert.equal(r.rowDone, true, 'the row is not styled done');
    assert.match(r.text, /done today/i);
    assert.match(r.all, /1\/6/, 'the finished review dropped out of "N/M today"');

    // Not writable: clicking the row must not bank 'rev' into the day log,
    // and it must not become untickable.
    await page.evaluate(() => {
      const p = document.querySelector('#tab-practice .pitem');
      const main = p.querySelector('.pmain');
      if (main) main.click();
    });
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('bassTheoryTrainer.v1') || '{}');
      const log = (st.practice && st.practice.log) || {};
      return {
        checked: document.querySelector('#tab-practice input[data-item="rev"]').checked,
        logged: Object.keys(log).some(k => (((log[k] || {}).items) || []).includes('rev')),
      };
    });
    assert.equal(after.checked, true, 'the derived tick could be toggled off');
    assert.equal(after.logged, false, 'the derived tick was written into the day log');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the report pluralizes every count it makes', async () => {
  // UPDATED with the 12-week course: the report card now appears at the END OF
  // THE COURSE (every checkpoint of every week), not at week 3 — the
  // pluralization contract it asserts is unchanged.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    const report = (n) => page.evaluate(([dk, count]) => {
      const all = {};
      for (let i = 0; i < count; i++) {
        all['d' + i] = { id: 'd' + i, label: 'shape ' + i, due: '2999-01-01', box: 1,
          ci: 'blocked', bpm: 60, attempts: [], cfg: { tuning: 5, type: 'scale' } };
      }
      localStorage.setItem(dk, JSON.stringify(all));
      BassCourse.WEEKS.forEach(w => w.checkpoints.forEach(c => S.practice.checkpoints[c.id] = true));
      save(); renderPractice();
      return document.getElementById('reportBox').textContent;
    }, [DRILL_KEY, n]);
    const one = await report(1);
    assert.match(one, /1 shape drilled/, '"1 shapes drilled" shipped');
    assert.doesNotMatch(one, /\b1 shapes\b/);
    // The report is pasted into a chat as the player's own words, so it also
    // must not use the name the app no longer shows anywhere.
    assert.doesNotMatch(one, /note trainer/i, 'the report still says "Note trainer"');
    const two = await report(2);
    assert.match(two, /2 shapes drilled/, 'the plural case broke');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('one name for one destination: the quiz is "Note quiz" everywhere', async () => {
  // The nav said "Note quiz", the page header "Fretboard trainer", plan links
  // "Open note trainer" — three names for one place.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    const offenders = [];
    for (const wk of [1, 2, 3]) {
      await page.click('[data-wk="' + wk + '"]');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.body.innerText);
      if (/note trainer|fretboard trainer/i.test(text)) offenders.push('week ' + wk);
    }
    for (const tab of ['scales', 'chords', 'trainer']) {
      await page.click('#tabbar button[data-tab="' + tab + '"]');
      await page.waitForSelector('#tab-' + tab + '.on', { timeout: 3000 });
      const text = await page.evaluate(() => document.body.innerText);
      if (/note trainer|fretboard trainer/i.test(text)) offenders.push(tab);
    }
    assert.deepEqual(offenders, [], 'old names still on screen: ' + offenders.join(', '));
    assert.equal(await page.textContent('#tab-trainer h2'), 'Note quiz',
      'the quiz tab\'s own header disagrees with the nav');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('every Live section is titled the way the Learn tabs are', async () => {
  // Learn tabs each render an <h2>; the Live sections had none — the visible
  // seam between the two halves of the merged app.
  const app = await openApp(SILENT, '/index.html#tuner', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    const SECTIONS = [['tuner', '#secTuner', 'Tuner'], ['find', '#secFind', 'Find it'],
                      ['echo', '#secEcho', 'Ear training'], ['drill', '#secDrill', 'Drills'],
                      ['songs', '#secSongs', 'Songs']];
    for (const [tab, sec, title] of SECTIONS) {
      await page.click('#tabbar button[data-tab="' + tab + '"]');
      await page.waitForSelector(sec + ':not(.hidden)', { timeout: 3000 });
      const h2 = await page.evaluate((s) => {
        const e = document.querySelector(s + ' h2');
        return e ? { text: e.textContent.trim(), visible: e.getBoundingClientRect().height > 4 } : null;
      }, sec);
      assert.ok(h2, tab + ' has no h2 at all');
      assert.equal(h2.text, title, tab + ' is titled "' + h2.text + '"');
      assert.ok(h2.visible, tab + '\'s h2 is not visible');
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('weeks 2 and 3 start by tuning up, and the tuner still ticks it off', async () => {
  // Week 1 taught that an out-of-tune bass "teaches your ear the wrong thing";
  // weeks 2 and 3 then dropped the tune-up entirely.
  const app = await openApp(SILENT, '/index.html', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 4000 });
    for (const wk of [2, 3]) {
      await page.click('[data-wk="' + wk + '"]');
      await page.waitForTimeout(200);
      const r = await page.evaluate((id) => {
        const cb = document.querySelector('#tab-practice input[data-item="' + id + '"]');
        if (!cb) return null;
        const p = cb.closest('.pitem');
        return { text: p.innerText, tunerLink: !!p.querySelector('[data-live="tuner"]'),
                 header: (document.getElementById('tab-practice').innerText.match(/(\d+) min/) || [])[1],
                 itemSum: [...document.querySelectorAll('#tab-practice .pitem .pcat')]
                   .map(e => +(e.textContent.match(/(\d+) min/) || [])[1]).reduce((a, b) => a + b, 0) };
      }, 'w' + wk + 't');
      assert.ok(r, 'week ' + wk + ' has no tune item (w' + wk + 't)');
      assert.match(r.text, /Tune up/, 'week ' + wk + '\'s tune item does not say so');
      assert.ok(r.tunerLink, 'week ' + wk + '\'s tune item has no tuner link');
      assert.equal(+r.header, r.itemSum,
        'week ' + wk + ': header says ' + r.header + ' min, items sum to ' + r.itemSum);
    }
    // markTuned() must find the new items too — resetting the once-a-day latch
    // between weeks, since it only ever ticks once per day.
    for (const wk of [2, 3]) {
      await page.click('[data-wk="' + wk + '"]');
      await page.waitForTimeout(200);
      const ticked = await page.evaluate((id) => {
        S.practice.tunedMarked = null; save();
        BassTheory.markTuned();
        const cb = document.querySelector('#tab-practice input[data-item="' + id + '"]');
        return cb ? cb.checked : null;
      }, 'w' + wk + 't');
      assert.equal(ticked, true, 'markTuned() did not tick w' + wk + 't');
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('leaving Ear mode takes its "playing the note" pill with it', async () => {
  // Entering Ear auto-plays a note and mutes the mic while it sounds. The mute
  // window survived a tab switch, so the Tuner opened claiming "playing the
  // note — listen…" about a note it never played.
  const app = await openApp(SILENT, '/index.html#echo', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secEcho:not(.hidden)', { timeout: 5000 });
    // Ear's own mute window is real — the pill shows while its note sounds.
    const shown = await until(page, () =>
      document.getElementById('liveTxt').textContent.includes('playing the note') || null,
      null, 3000);
    assert.ok(shown, 'Ear mode never showed its own playback pill');

    await page.click('#tabbar button[data-tab="tuner"]');
    await page.waitForSelector('#secTuner:not(.hidden)', { timeout: 3000 });
    await page.waitForTimeout(250);       // several analyser ticks
    const r = await page.evaluate(() => ({
      txt: document.getElementById('liveTxt').textContent,
      muteLeft: A.muteUntil - performance.now(),
    }));
    assert.doesNotMatch(r.txt, /playing the note/,
      'the Tuner still claims to be playing Ear\'s note');
    assert.ok(r.muteLeft <= 0, 'the mute window survived the tab switch');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
