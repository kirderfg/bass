/* Regression tests for the third simulated-beginner session's findings: links
   that landed on the right tab but unconfigured, work that vanished from the
   day's list the moment it was done, taps and pills that said nothing or said
   it too long, and copy that used three names for one destination.

   Every test here is a defect that shipped. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp, until, openSettings } = require('./harness.js');

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

test('a preset drill link puts a finished run away and shows the configured picker', async () => {
  // THE BIG ONE from the fourth session: after any drill run, enterDrills
  // re-showed the old verdict — so "Run the rhythm drill" landed on the
  // previous drill's finished E-minor-pentatonic verdict, with the preset
  // having configured the picker perfectly UNDERNEATH it.
  const app = await openApp(SILENT, '/index.html#drill', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 5000 });
    await page.click('#drStart');           // default pick: E minor pentatonic, open position
    await page.waitForSelector('#drRun:not(.hidden)', { timeout: 3000 });
    await page.evaluate(async () => {
      if (A.timer) { clearInterval(A.timer); A.timer = null; }
      A.muteUntil = 0;
      for (let guard = 0; guard < 20 && DR.phase === 'running'; guard++) {
        const want = DR.run.expected();
        if (!want) break;
        onStableNote({ midi: want.midi, hz: 100, cents: 0 });
        await new Promise(r => setTimeout(r, 60));
      }
    });
    assert.equal(await page.evaluate(() => DR.phase), 'done', 'the seed run did not reach a verdict');

    // Preset-LESS return keeps today's behaviour: your verdict is where you left it.
    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 3000 });
    await page.click('#tabbar button[data-tab="drill"]');
    await page.waitForSelector('#secDrill:not(.hidden)', { timeout: 3000 });
    assert.equal(await page.isVisible('#drRun'), true,
      'coming back by the nav should return to the verdict');

    // A preset-carrying plan link must land on the configured PICKER instead.
    await page.click('#tabbar button[data-tab="practice"]');
    await page.waitForSelector('#tab-practice.on .pitem', { timeout: 3000 });
    await page.click('[data-wk="5"]');
    await page.waitForTimeout(200);
    assert.equal(await clickPlanLink(page, /First rhythm drill/, /Run the rhythm drill/), 'ok');
    await page.waitForSelector('#drPick:not(.hidden)', { timeout: 3000 });
    const r = await page.evaluate(() => ({
      runShown: !document.getElementById('drRun').classList.contains('hidden'),
      preview: document.getElementById('drPreview').textContent,
      bpm: document.getElementById('drBpmTxt').textContent,
    }));
    assert.equal(r.runShown, false, 'the previous drill\'s verdict screen is still up');
    assert.match(r.preview, /Straight eighths on E · 8 bars/i, 'the picker is not configured to the preset');
    assert.equal(r.bpm, '92 bpm', 'the preset names 92 bpm and the picker should land there');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('when a due review owns the primary button, the preview names its own drill\'s owner', async () => {
  // "Run today's review · 1 due" was the primary button while the preview
  // paragraph below still described the PICKER's drill — two drills on one
  // card with no labels saying which text belongs to which button.
  const app = await openApp(SILENT, '/index.html#drill', DESK);
  try {
    const { page } = app;
    await page.waitForSelector('#gate:not(.hidden)', { timeout: 4000 });
    await page.evaluate((dk) => {
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
    assert.match(await page.textContent('#drStart'), /review/i, 'the review does not own the primary button');
    assert.match(await page.textContent('#drPreview'), /^Your own pick \(the second button\): /,
      'the preview does not say whose drill it describes');

    // Without a due review there is only one drill on the card — no prefix.
    await page.evaluate((dk) => { localStorage.removeItem(dk); setMode('drill'); }, DRILL_KEY);
    await page.waitForTimeout(150);
    assert.doesNotMatch(await page.textContent('#drPreview'), /Your own pick/,
      'the owner prefix should only appear when a review is primary');
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

/* ------------------------------------------------------------------
   THE CONSOLE. Find-it's card is an instrument panel, not a document:
   at a given viewport it is the SAME HEIGHT in every state of the game,
   it sits between the sticky header and the nav without scrolling, and
   nothing the game does — a new question, a verdict, being shown the
   answer, a settings change — is allowed to move the page. This is the
   defect that shipped: a reveal hint drew a 400px fretboard and the page
   auto-scrolled 152px, so the player lost sight of the stage at the exact
   moment they were being taught something. The hint rungs are gone from
   the state matrix below with the hints themselves; what remains is every
   state the game can still be in.
   ------------------------------------------------------------------ */
const CONSOLE_VIEWPORTS = [
  { width: 1280, height: 800 },    // the desktop this is played on
  { width: 1366, height: 768 },    // the tight laptop
  { width: 1366, height: 700 },    // …with a toolbar and a bookmarks bar
  { width: 1440, height: 900 },
  { width: 380, height: 800 },     // and it must not have broken the phone
];

/** Every measurement the console's promises are made of, in ONE reflow. */
const CONSOLE_PROBE = () => {
  const doc = document.scrollingElement;
  const bot = el => el.getBoundingClientRect().bottom + doc.scrollTop;
  const top = el => el.getBoundingClientRect().top + doc.scrollTop;
  const card = document.querySelector('#secFind .gv-card');
  const navH = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--nav-h')) || 0;
  return {
    cardH: +card.getBoundingClientRect().height.toFixed(1),
    cardBot: bot(card),
    hudTop: top(document.querySelector('#secFind .gv-hud')),
    ctlBot: bot(document.querySelector('#secFind .gv-controls')),
    headBot: document.querySelector('header').getBoundingClientRect().bottom,
    floor: window.innerHeight - navH,
    scrollTop: doc.scrollTop,
    docH: doc.scrollHeight, winH: window.innerHeight,
  };
};

test('the game console is one fixed height per prompt mode, and fits the screen', async () => {
  for (const vp of CONSOLE_VIEWPORTS) {
    const app = await openApp(SILENT, '/index.html#find', vp);
    try {
      const { page } = app;
      await page.click('#startBtn');
      await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
      await page.waitForTimeout(400);
      const at = vp.width + '×' + vp.height + ': ';
      const seen = [];
      const look = async (state) => {
        const m = await page.evaluate(CONSOLE_PROBE);
        seen.push({ state, ...m });
        return m;
      };

      /* --- A: within ONE prompt mode, every state the game can be in — pace ×
             {fresh, stall nudge, answer shown, burnt fuse} — is the same height,
             and the whole play area is on screen throughout.
             ACROSS prompt modes it may differ: Names reserves nothing for a
             staff, and switching prompt is a settings change that restarts the
             run, not something that happens while you are playing. --- */
      const scenes = {};
      for (const prompt of ['name', 'staff', 'mix']) {
        await page.evaluate((r) => {
          document.querySelector(`#gvPromptSeg button[data-r="${r}"]`).click();
        }, prompt);
        await page.waitForTimeout(200);
        scenes[prompt] = await page.evaluate(() => document.getElementById('gvScene').style.width);
        for (const pace of ['chill', 'steady']) {
          await page.evaluate((p) => {
            document.querySelector(`#gvPaceSeg button[data-p="${p}"]`).click();
          }, pace);
          await page.waitForTimeout(150);
          await look(`${prompt}/${pace}/fresh`);
          // the stall nudge — the one thing that rewrites the coaching line
          await page.evaluate(() => { lastProgressAt = performance.now() - 60000; });
          await page.waitForTimeout(900);
          await look(`${prompt}/${pace}/nudge`);
          // being shown the answer
          await page.evaluate(() => document.getElementById('fSkip').click());
          await page.waitForTimeout(150);
          await look(`${prompt}/${pace}/shown`);
          // …and the longest verdict of all: a burnt fuse's correction
          await page.evaluate(() => document.getElementById('gvRestart').click());
          await page.waitForTimeout(120);
          await page.evaluate(() => gvBreach());
          await page.waitForTimeout(120);
          await look(`${prompt}/${pace}/verdict`);
        }
      }
      for (const m of seen) {
        assert.ok(m.hudTop >= m.headBot - 1,
          at + m.state + ': the HUD is under the sticky header');
        assert.ok(m.ctlBot <= m.floor,
          at + m.state + ': the console runs past the nav — ' +
          `Show me ends at ${m.ctlBot}, the screen ends at ${m.floor}`);
      }

      /* --- B: nothing the game does moves the page — including switching the
             prompt, which changes the console's own height. --- */
      const moved = seen.filter(m => m.scrollTop !== seen[0].scrollTop);
      assert.deepEqual(moved.map(m => m.state), [],
        at + 'the page scrolled by itself during play');

      /* --- C: one height per prompt mode. --- */
      const byPrompt = {};
      for (const m of seen) (byPrompt[m.state.split('/')[0]] ||= []).push(m.cardH);
      for (const k in byPrompt) {
        const hs = [...new Set(byPrompt[k])];
        assert.ok(Math.max(...hs) - Math.min(...hs) <= 2,
          at + k + ': the console changes height between states: ' + hs.join(' / '));
      }
      /* --- D: and the SHAPE of the contract: Names reserves nothing for a
             staff (so it is shorter), while Mixed reserves it exactly as Sheet
             music does — the prompt flips per question there, so a Mixed
             console that matched Names would jump every other question. --- */
      const h = k => byPrompt[k][0];
      assert.ok(h('name') < h('staff') - 20,
        at + `Names still reserves a staff slot (name ${h('name')} vs staff ${h('staff')})`);
      assert.ok(Math.abs(h('mix') - h('staff')) <= 2,
        at + `Mixed does not reserve the staff slot (mix ${h('mix')} vs staff ${h('staff')})`);
      /* --- E: the stage must not jump when the prompt changes. --- */
      assert.equal(new Set(Object.values(scenes)).size, 1,
        at + 'the scene changed size between prompt modes: ' + JSON.stringify(scenes));

      /* --- B again, for the settings: opening the panel may scroll (the
             player asked for it); CHANGING a setting may not. --- */
      await page.click('#gvSettings > summary');
      await page.waitForSelector('#gvPromptSeg button', { state: 'visible' });
      /* Park the page part-way down the (now long) document rather than at its
         end: switching to Names makes the console ~120px shorter, and a page
         scrolled to the very bottom gets CLAMPED by the browser — which would
         read as the app scrolling when it is the same thing that happens when
         any disclosure closes. From here the app is the only thing that could
         move it. */
      await page.evaluate(() => { document.scrollingElement.scrollTop = 120; });
      await page.waitForTimeout(150);
      const base = await page.evaluate(CONSOLE_PROBE);
      /* Clicked in the page, not through Playwright: Playwright scrolls a
         control into view before clicking it, and the question here is whether
         the APP scrolls — the handler is the same one either way. */
      const change = async (label, fn, arg, sameHeight = true) => {
        const was = await page.evaluate(() => document.scrollingElement.scrollTop);
        await page.evaluate(fn, arg);
        await page.waitForTimeout(180);
        const m = await page.evaluate(CONSOLE_PROBE);
        /* The bar is "the APP did not scroll", not "the number did not move":
           switching to Names makes the console ~120px shorter, and a page
           already scrolled to its end cannot stay scrolled past the new end —
           the browser clamps it, exactly as it does when a <details> closes.
           So the expectation is the clamp, and anything else is the app. */
        const maxScroll = Math.max(0, m.docH - m.winH);
        assert.equal(m.scrollTop, Math.min(was, maxScroll),
          at + 'changing ' + label + ' scrolled the page');
        if (sameHeight) assert.ok(Math.abs(m.cardH - base.cardH) <= 2,
          at + 'changing ' + label + ' changed the console height');
      };
      for (const sel of ['#gvPaceSeg button[data-p="turbo"]',
                         '#gvFretSeg button[data-fr="all"]',
                         '#gvFocusSeg button[data-f="E"]']) {
        await change(sel, s => document.querySelector(s).click(), sel);
      }
      // The prompt is allowed to change the height — but never the scroll.
      for (const r of ['name', 'staff', 'mix', 'name']) {
        await change('the prompt to ' + r,
          v => document.querySelector(`#gvPromptSeg button[data-r="${v}"]`).click(), r, false);
      }
      await change('the stage', () => {
        const sel = document.getElementById('gvWorld');
        sel.value = '4';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, undefined, false);
      assert.deepEqual(app.errors, [], 'page errors');
    } finally { await app.close(); }
  }
});

test('the difficulty panel is closed during play, and says what it is hiding', async () => {
  // 1,196px of settings under the console is what pushed the game off the
  // screen. They are a disclosure now — so the summary has to carry the setup,
  // or the player cannot know what they are playing without opening it.
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.getElementById('gvSettings').open), false,
      'the difficulty panel is open before the player asked for it');
    assert.equal(await page.isVisible('#gvPaceSeg button'), false,
      'the settings controls are in the play flow');
    const now = () => page.textContent('#gvSetupNow');
    assert.match(await now(), /Stage \d+ · Soundcheck · Names · all strings/,
      'the closed panel does not say what is set');
    assert.ok(await page.isVisible('#gvSetupNow'), 'the setup line is not visible');
    await openSettings(page);
    await page.click('#gvPaceSeg button[data-p="steady"]');
    await page.click('#gvPromptSeg button[data-r="staff"]');
    await page.click('#gvFocusSeg button[data-f="A"]');
    assert.match(await now(), /Stage \d+ · Gig · Sheet music · A string only/,
      'the setup line does not follow the settings');
    // The clef card stays collapsed reference material, below the settings.
    assert.equal(await page.evaluate(() => document.getElementById('gvClefHelp').open), false,
      'the staff reference opens itself');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

/* ------------------------------------------------------------------
   THE NOTE MAP. The whole neck, named — a reference card below the
   console, alongside the difficulty panel and the staff guide. It is
   not help: it is shut unless the player opens it, it never opens
   itself, and nothing in the play loop points at it. Opened, it has to
   be the whole instrument (5 strings × 13 frets) and it has to be able
   to spell what it draws three ways, because that is how the game asks.
   ------------------------------------------------------------------ */
test('the note map is a closed reference card that opens onto the whole neck', async () => {
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });

    // Closed by default, and below the console — never inside the play flow.
    assert.equal(await page.evaluate(() => document.getElementById('gvMap').open), false,
      'the note map opens itself');
    assert.equal(await page.isVisible('#gvMapBoard .neck-svg'), false,
      'the map draws a board before it has been opened');
    const order = await page.evaluate(() => {
      const bot = el => el.getBoundingClientRect().bottom;
      return {
        console: bot(document.querySelector('#secFind .gv-card')),
        map: document.getElementById('gvMap').getBoundingClientRect().top,
        summary: document.querySelector('#gvMap > summary').textContent.trim(),
      };
    });
    assert.ok(order.map >= order.console - 1, 'the map is not below the console');
    assert.match(order.summary, /Note map/, 'the map card does not say what it is');

    // Opened: five strings, thirteen frets, every position named.
    await page.click('#gvMap > summary');
    await page.waitForSelector('#gvMapBoard .neck-svg', { state: 'visible', timeout: 3000 });
    const m = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('#gvMapBoard .neck-labels .neck-label')]
        .map(l => l.textContent);
      const frets = [...document.querySelectorAll('#gvMapBoard .neck-fretnum')]
        .map(t => t.textContent);
      const dots = [...document.querySelectorAll('#gvMapBoard .neck-marker')];
      return {
        labels, frets,
        strings: new Set(dots.map(d => d.getAttribute('data-s'))).size,
        names: dots.map(d => d.querySelector('.neck-dot-label').textContent),
        title: document.querySelector('#gvMapBoard .neck-svg title').textContent,
      };
    });
    assert.deepEqual(m.labels.slice().sort(), ['A', 'B', 'D', 'E', 'G'],
      'the map does not name all five strings: ' + JSON.stringify(m.labels));
    assert.deepEqual(m.frets, ['0','1','2','3','4','5','6','7','8','9','10','11','12'],
      'the map does not run fret 0 to 12: ' + JSON.stringify(m.frets));
    assert.equal(m.strings, 5, 'the map draws notes on ' + m.strings + ' strings, not 5');
    // Naturals only is the default: 7 letters per octave, no accidentals drawn.
    assert.deepEqual([...new Set(m.names)].sort(), ['A','B','C','D','E','F','G'],
      'the default map should draw the naturals only: ' + JSON.stringify([...new Set(m.names)]));
    // Open E, fret 0 on the E string, must say E — the map has to be RIGHT.
    const openE = await page.evaluate(() => {
      const g = document.querySelector('#gvMapBoard .neck-marker[data-s="1"][data-f="0"]');
      return g && g.querySelector('.neck-dot-label').textContent;
    });
    assert.equal(openE, 'E', 'the open E is not named E on the map');
    assert.match(m.title, /five strings|frets 0 to 12/,
      'the board carries no description for a screen reader');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the map spells the neck three ways: naturals, sharps and flats', async () => {
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.click('#gvMap > summary');
    await page.waitForSelector('#gvMapBoard .neck-svg', { state: 'visible', timeout: 3000 });

    const read = () => page.evaluate(() => {
      const dots = [...document.querySelectorAll('#gvMapBoard .neck-marker')];
      const at = (s, f) => {
        const g = document.querySelector(`#gvMapBoard .neck-marker[data-s="${s}"][data-f="${f}"]`);
        return g && g.querySelector('.neck-dot-label').textContent;
      };
      return {
        count: dots.length,
        names: [...new Set(dots.map(d => d.querySelector('.neck-dot-label').textContent))],
        // E string fret 1 is F, fret 2 is F♯ / G♭ — one natural, one accidental.
        eF: at(1, 1), eAcc: at(1, 2),
        pressed: [...document.querySelectorAll('#gvMapSpellSeg button')]
          .map(b => b.getAttribute('aria-pressed')),
      };
    });

    const nat = await read();
    assert.equal(nat.eAcc, null, 'naturals-only still draws the accidentals');
    assert.equal(nat.eF, 'F', 'the E string fret 1 is not named F');
    assert.deepEqual(nat.pressed, ['true', 'false', 'false'],
      'the spelling segment does not report which option is on');

    await page.click('#gvMapSpellSeg button[data-sp="sharp"]');
    await page.waitForTimeout(150);
    const sharp = await read();
    assert.ok(sharp.count > nat.count,
      `sharps should add the five accidentals (${nat.count} → ${sharp.count})`);
    assert.equal(sharp.eAcc, 'F♯', 'the sharp spelling is not drawn');
    assert.ok(sharp.names.some(n => /♯/.test(n)), 'no sharp names on the sharp map');
    assert.ok(!sharp.names.some(n => /♭/.test(n)), 'flat names on the sharp map');
    assert.deepEqual(sharp.pressed, ['false', 'true', 'false']);

    await page.click('#gvMapSpellSeg button[data-sp="flat"]');
    await page.waitForTimeout(150);
    const flat = await read();
    assert.equal(flat.count, sharp.count, 'the same positions must be drawn either way');
    assert.equal(flat.eAcc, 'G♭', 'the flat spelling is not drawn');
    assert.ok(flat.names.some(n => /♭/.test(n)), 'no flat names on the flat map');
    assert.ok(!flat.names.some(n => /♯/.test(n)), 'sharp names on the flat map');
    assert.deepEqual(flat.pressed, ['false', 'false', 'true']);
    assert.equal(flat.eF, 'F', 'a natural changed name when the spelling changed');

    // The setting survives a reload — a reference card that forgets is a chore.
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.click('#gvMap > summary');
    await page.waitForSelector('#gvMapBoard .neck-svg', { state: 'visible', timeout: 3000 });
    assert.equal((await read()).eAcc, 'G♭', 'the map forgot its spelling');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the map dims what this stage does not ask, and can light up your own misses', async () => {
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    // Stage 1 is the E and A strings, frets 0–5: everything else is dimmed.
    await page.evaluate(() => {
      localStorage.removeItem('bassTheoryTrainer.v1');
      tier = 0; focus = null; renderTierUI();
      document.getElementById('gvMap').open = true;
    });
    await page.waitForSelector('#gvMapBoard .neck-svg', { state: 'visible', timeout: 3000 });
    const dimmed = await page.evaluate(() => {
      const out = s => {
        const g = document.querySelector(`#gvMapBoard .neck-marker[data-s="${s[0]}"][data-f="${s[1]}"]`);
        return g && g.classList.contains('is-outside');
      };
      return {
        inStage: out([1, 3]),      // E string fret 3 (G) — asked on stage 1
        pastFret: out([1, 8]),     // E string fret 8 (C) — past this stage's ceiling
        otherString: out([4, 5]),  // G string fret 5 (C) — not on this stage at all
        note: document.getElementById('gvMapNote').textContent,
      };
    });
    assert.equal(dimmed.inStage, false, 'a position this stage asks is dimmed');
    assert.equal(dimmed.pastFret, true, 'a fret past this stage is not dimmed');
    assert.equal(dimmed.otherString, true, 'a string this stage never asks is not dimmed');
    assert.match(dimmed.note, /Stage 1/, 'the map does not say what it is dimming against');

    // Whole neck: nothing dimmed.
    await page.click('#gvMapScopeSeg button[data-sc="all"]');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() =>
      !!document.querySelector('#gvMapBoard .neck-marker.is-outside')), false,
      'the whole-neck view still dims positions');

    // Weak spots: the overlay marks positions this player has actually missed.
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('bassTheoryTrainer.v1') || '{}');
      st.stats = Object.assign({ answered: 0, correct: 0, byString: {}, heat: {} }, st.stats);
      st.stats.heat['A:5'] = 3;
      localStorage.setItem('bassTheoryTrainer.v1', JSON.stringify(st));
      document.querySelector('#gvMapWeakSeg button[data-wk="on"]').click();
    });
    await page.waitForTimeout(150);
    const weak = await page.evaluate(() => ({
      missed: !!document.querySelector('#gvMapBoard .neck-marker[data-s="2"][data-f="5"].is-heat'),
      clean: !!document.querySelector('#gvMapBoard .neck-marker[data-s="2"][data-f="3"].is-heat'),
      label: (document.querySelector('#gvMapBoard .neck-marker[data-s="2"][data-f="5"] .neck-dot-label') || {}).textContent,
      note: document.getElementById('gvMapNote').textContent,
    }));
    assert.equal(weak.missed, true, 'a position this player keeps missing is not marked');
    assert.equal(weak.clean, false, 'a position never missed was marked as weak');
    assert.equal(weak.label, 'D', 'a marked weak spot lost its note name');
    assert.match(weak.note, /missed/, 'the map does not explain the red marks');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('lights out hands focus to the restart, and the restart hands it back to a live control', async () => {
  // The console has ONE control in the play area now. Game over disables it and
  // moves focus to "Back on stage"; restarting must hand focus to something
  // that exists and is enabled — it used to be the Hint button, and a focus
  // call on a removed element drops a screen reader at the top of the document.
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await openSettings(page);
    await page.click('#gvPaceSeg button[data-p="steady"]');   // a pace with stage lights
    await page.click('#gvSettings > summary');
    await page.waitForTimeout(200);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => gvBreach());
      await page.waitForTimeout(200);
    }
    await page.waitForSelector('#gvOver:not(.hidden)', { timeout: 3000 });
    await page.waitForTimeout(600);   // the announcement-safe focus delay
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gvRestart',
      'lights out did not put focus on the way back');
    assert.equal(await page.evaluate(() => document.getElementById('fSkip').disabled), true,
      'a dead control is still focusable during lights out');
    await page.evaluate(() => document.getElementById('gvRestart').click());
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      focused: document.activeElement.id,
      disabled: document.getElementById('fSkip').disabled,
    }));
    assert.equal(after.disabled, false, 'the control did not come back with the run');
    assert.equal(after.focused, 'fSkip',
      'restarting stranded focus (on ' + (after.focused || '<body>') + ')');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a string that keeps ringing off gets sent to the Tuner, in the verdict itself', async () => {
  // This guidance used to arrive through the Hint button: ask for a hint while
  // an out-of-tune reading was up and the game said "it is your tuning that is
  // off — open the Tuner tab". With no Hint button, a player whose D string is
  // flat would be told to move their finger forever. So the verdict escalates:
  // the first bad reading keeps both hypotheses open (finger OR string), and a
  // second one on the same question names the string and the Tuner tab.
  const app = await openApp(SILENT, '/index.html#find', DESK);
  try {
    const { page } = app;
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => { A.muteUntil = 0; });
    const first = await page.evaluate(() => {
      onStableNote({ midi: q.midi, hz: 100, cents: 45 });
      return document.getElementById('fVerdict').textContent;
    });
    assert.match(first, /Right note/, 'a 45-cent miss should still be the right note');
    assert.match(first, /45 cents/, 'the first reading does not say how far out it is');
    assert.match(first, /finger placement/,
      'the first reading should blame the finger first: "' + first + '"');
    assert.doesNotMatch(first, /Tuner/,
      'one bad reading is not enough to send someone off to retune: "' + first + '"');

    const second = await page.evaluate(() => {
      onStableNote({ midi: q.midi, hz: 100, cents: 45 });
      return document.getElementById('fVerdict').textContent;
    });
    assert.match(second, /Tuner tab/,
      'a second bad reading must point at the Tuner: "' + second + '"');
    assert.match(second, /string, not your finger/,
      'the escalation must say WHY it changed its mind: "' + second + '"');
    // …and it must still fit the verdict's reserved height — the escalation
    // replaces the line rather than growing it.
    const fits = await page.evaluate(() => {
      const v = document.getElementById('fVerdict');
      return v.scrollHeight <= v.closest('.gv-slot').clientHeight;
    });
    assert.equal(fits, true, 'the escalated verdict overflows its reserved slot');
    // A fresh question forgets the theory: the next note starts from scratch.
    await page.evaluate(() => newQuestion());
    const afterNew = await page.evaluate(() => {
      A.muteUntil = 0;
      onStableNote({ midi: q.midi, hz: 100, cents: 45 });
      return document.getElementById('fVerdict').textContent;
    });
    assert.doesNotMatch(afterNew, /Tuner/,
      'the tuning theory leaked into the next question: "' + afterNew + '"');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
