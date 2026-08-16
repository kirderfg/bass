/* End-to-end tests: a synthesized bass plays into the real browser and we
   assert the app reacts correctly. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openApp, openWithNote, until, openSettings } = require('./harness.js');

// Equal-temperament reference pitches (A4 = 440).
const E1 = 41.203, G2 = 97.999, A1 = 55.000, G3 = 195.998;
// Far above the detector's 420 Hz ceiling: a file that plays, and is never
// heard as an answer — for tests that drive the game with clicks, not notes.
const SILENT = 987.767;

test('the tuner names the note being played and reports it as in tune', async () => {
  const app = await openWithNote(E1);
  try {
    const shown = await until(app.page, () => {
      const t = document.getElementById('tNote').textContent;
      return t && t !== '—' ? t : null;
    });
    assert.match(shown, /^E/, `tuner showed "${shown}" for a 41.2 Hz E`);
    const cents = await app.page.textContent('#tCents');
    assert.match(cents, /in tune/, `expected an in-tune reading, got "${cents}"`);
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the tuner tells a flat string which way to turn the peg', async () => {
  // E1 pulled 35 cents flat — the tuner must say "tune UP", not just "wrong".
  const app = await openWithNote(E1 * Math.pow(2, -35 / 1200));
  try {
    const cents = await until(app.page, () => {
      const t = document.getElementById('tCents').textContent.trim();
      return t && t !== '' && !/^\s*$/.test(t) && t !== ' ' ? t : null;
    });
    assert.match(cents, /tune UP/, `expected "tune UP", got "${cents}"`);
  } finally { await app.close(); }
});

test('playing the requested note scores a point and is remembered against that position', async () => {
  const app = await openWithNote(G2);
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTrainer.gamemem.v1');
      setMode('find');
      // Ask for exactly the note our synthetic bass is playing: G on the E string.
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
      document.getElementById('fQ').innerHTML = 'Play <b>G</b> on the <b>E</b> string';
      tracker.reset();
    });

    const verdict = await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('ok') ? el.textContent : null;
    });
    assert.ok(verdict, 'app never accepted the correct note');

    /* The game keeps two things and no more: which positions you have missed,
       and a rolling last-6 per position for the picker. A find writes the
       second and leaves the first alone. */
    const stats = await app.page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1')).stats);
    assert.deepEqual(stats.noteRecent['E:3'], [1], 'the find should be remembered at E:3');
    assert.equal(stats.heat['E:3'], undefined, 'a clean find must not mark a weak spot');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('playing the wrong note is rejected, and the question stays open', async () => {
  // Was "…and a second miss opens the hint". The hint half retired with the
  // hint system: nothing opens itself mid-question any more. The REJECTION
  // half is the part that was always about the game judging, and it stands —
  // with the miss still landing on the heat map the picker reads.
  const app = await openWithNote(A1); // playing A, but we will ask for G
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTrainer.gamemem.v1');
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });

    const verdict = await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('no') ? el.textContent : null;
    });
    assert.match(verdict, /A/, `expected the app to name what it heard, got "${verdict}"`);
    assert.match(verdict, /G/, 'expected it to restate the note still being looked for');

    // Keep-trying: the question must stay open, not skip on.
    const stillAsking = await app.page.evaluate(() => q && q.name);
    assert.equal(stillAsking, 'G', 'a wrong note must not advance the question');

    // Keep missing: no help may arrive on its own, and no help may be offered
    // in a way that gives the note away. The only thing that can change while
    // the player is wrong is the coaching line, and it may not name the answer.
    await app.page.waitForTimeout(4000);
    const r = await app.page.evaluate(() => ({
      sub: document.getElementById('fSub').textContent,
      asking: q && (q.name + ':' + q.sn + ':' + q.f),
      stats: JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1')).stats,
    }));
    assert.doesNotMatch(r.sub, /fret \d/,
      `the game gave a fret away by itself: "${r.sub}"`);
    assert.doesNotMatch(r.sub, /right here|between fret/,
      `a hint ladder is still running: "${r.sub}"`);
    assert.equal(r.asking, 'G:E:3',
      'the question moved on by itself while the player was still hunting');
    assert.deepEqual(r.stats.noteRecent['E:3'], [0],
      'the miss was not banked against the position the picker reads');
    assert.equal(r.stats.heat['E:3'], 1, 'the miss should show on the fretboard heatmap');
  } finally { await app.close(); }
});

test('the right note in the wrong octave gets its own explanation', async () => {
  const app = await openWithNote(G3); // G, but an octave above the asked-for G2
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTrainer.gamemem.v1');
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });
    const verdict = await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('no') ? el.textContent : null;
    });
    assert.match(verdict, /octave/i, `expected an octave-specific message, got "${verdict}"`);
  } finally { await app.close(); }
});

test('a consistently flat instrument is called out rather than marked wrong', async () => {
  const app = await openWithNote(E1 * Math.pow(2, -32 / 1200));
  try {
    // The warning belongs on the practice screens. On the Tuner it would be
    // telling the player what the tuner is already showing them.
    await app.page.evaluate(() => setMode('find'));
    const warn = await until(app.page, () => {
      const el = document.getElementById('tuneWarn');
      return !el.classList.contains('hidden') ? el.textContent : null;
    }, null, 8000);
    assert.ok(warn, 'no tuning warning appeared for a 32-cent-flat bass');
    assert.match(warn, /flat/);
  } finally { await app.close(); }
});

test('a still-ringing string does not answer the question that follows it', async () => {
  // The blocker this suite originally missed: the app moved on after a
  // correct answer while the note was still sounding, and judged that
  // ring-out against the next question — inventing misses the player
  // never made, and poisoning the stats the practice checkpoints read.
  //
  // The premise is ONE attack with a long ring, so the WAV attacks once —
  // after 5s of lead silence, clearing the test's own setup — rings for 10s
  // and then stays silent: the loop never re-attacks inside the test.
  const app = await openWithNote(G2, { seconds: 20, leadSeconds: 5, toneSeconds: 10 });
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTrainer.gamemem.v1');
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
    });

    await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('ok') ? el.textContent : null;
    }, null, 12000);

    // The app now picks its own next question while G keeps sounding.
    await new Promise(r => setTimeout(r, 4000));

    const stats = await app.page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1')).stats);
    assert.deepEqual(stats.noteRecent['E:3'], [1],
      `the ring-out was judged again: ${JSON.stringify(stats.noteRecent['E:3'])} for one note`);
    assert.deepEqual(stats.heat, {}, 'no phantom misses on the heatmap');
  } finally { await app.close(); }
});

test('a note already sounding when Find-it opens dies unjudged', async () => {
  // The entry ambush: two reviewers lost question 1 to a note that was still
  // ringing as the screen arrived. A tone that attacks once and rings
  // throughout entry must NEVER be judged — no verdict, no banked stats;
  // the first judged reading of a session must be a fresh attack.
  const app = await openApp(G2, '/index.html#find', undefined,
    { seconds: 25, toneSeconds: 25 });
  try {
    const { page } = app;
    await page.evaluate(() => localStorage.removeItem('bassTrainer.gamemem.v1'));
    await page.click('#startBtn');
    await page.waitForSelector('#secFind:not(.hidden)', { timeout: 5000 });
    // Well past the 600ms entry grace: the pre-entry ring is dead, not parked.
    await new Promise(r => setTimeout(r, 1500));
    const r = await page.evaluate(() => ({
      verdict: document.getElementById('fVerdict').textContent.trim(),
      cls: document.getElementById('fVerdict').className,
      stats: (JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1') || '{}').stats) || null,
      asked: document.getElementById('fAsked').textContent,
    }));
    assert.equal(r.verdict.replace(/ /g, ''), '',
      `the pre-entry note was judged: "${r.verdict}"`);
    assert.equal(r.cls, 'verdict', 'a verdict class was painted');
    assert.ok(!r.stats || !Object.keys(r.stats.noteRecent || {}).length,
      'the pre-entry note banked an answer: ' + JSON.stringify(r.stats));
    assert.equal(r.asked, '0', 'the session panel counted a question nobody answered');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('the tuner names the string being tuned even when it is badly slack', async () => {
  // 70 cents flat: chromatically nearer D#, but the player is tuning E.
  const app = await openWithNote(E1 * Math.pow(2, -70 / 1200));
  try {
    const note = await until(app.page, () => {
      const t = document.getElementById('tNote').textContent;
      return t && t !== '—' ? t : null;
    });
    assert.match(note, /^E/, `expected the E string, got "${note}"`);
    const cents = await app.page.textContent('#tCents');
    assert.match(cents, /flat — tune UP/, `expected "tune UP", got "${cents}"`);
  } finally { await app.close(); }
});

test('the tuner does not contradict itself on a badly slack string', async () => {
  // Regression: the big readout used the open-string reference while the
  // drift banner used chromatic cents, so a 70-cent-flat E said "tune UP"
  // and "30 cents sharp" in the same viewport.
  const app = await openWithNote(E1 * Math.pow(2, -70 / 1200));
  try {
    const cents = await until(app.page, () => {
      const t = document.getElementById('tCents').textContent.trim();
      return /tune/.test(t) ? t : null;
    });
    assert.match(cents, /flat — tune UP/);

    const banner = await until(app.page, () => {
      const el = document.getElementById('tuneWarn');
      return !el.classList.contains('hidden') ? el.textContent : null;
    }, null, 9000);
    if (banner) {
      assert.ok(!/sharp/.test(banner),
        `banner contradicts the readout: "${banner}"`);
      assert.match(banner, /flat/);
    }
  } finally { await app.close(); }
});

test('Show me names the note where the player is already looking, and nothing moves', async () => {
  // Replaces "a reveal hint lands on screen, legible, without the page moving".
  // The reveal rung is gone; Show me is the only door to the answer now, so it
  // inherits the whole promise: the answer arrives IN the console the player is
  // looking at, it says the note, the string and the fret in words (the only
  // form a non-visual player can use), and it costs the page no movement — no
  // scroll, no change of console height, no shift of the stage.
  const app = await openWithNote(SILENT);
  try {
    await app.page.evaluate(() => {
      setMode('find');
      tier = 4; focus = null; renderTierUI();
      q = { si: 2, f: 11, midi: 66, sn: 'A', name: 'F#' };
      wrongThisQ = 0; qStart = performance.now();
    });
    await app.page.waitForTimeout(200);
    const before = await app.page.evaluate(() => ({
      scrollTop: document.scrollingElement.scrollTop,
      card: Math.round(document.querySelector('.gv-card').getBoundingClientRect().height),
      screen: Math.round(document.querySelector('.gv-screen').getBoundingClientRect().top),
    }));

    await app.page.click('#fSkip');
    await app.page.waitForTimeout(300);

    const r = await app.page.evaluate(() => {
      const v = document.getElementById('fVerdict');
      const b = v.getBoundingClientRect();
      const navH = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--nav-h')) || 0;
      const head = document.querySelector('header').getBoundingClientRect().bottom;
      return {
        verdict: v.textContent,
        label: document.getElementById('fSkip').textContent,
        onScreen: b.top >= head - 1 && b.bottom <= innerHeight - navH + 1,
        fontPx: parseFloat(getComputedStyle(v).fontSize),
        scrollTop: document.scrollingElement.scrollTop,
        card: Math.round(document.querySelector('.gv-card').getBoundingClientRect().height),
        screen: Math.round(document.querySelector('.gv-screen').getBoundingClientRect().top),
      };
    });

    assert.match(r.label, /Show me/,
      'the only door to the answer must say what it does');
    assert.match(r.verdict, /F♯/, 'the answer does not name the note');
    assert.match(r.verdict, /A string/, 'the answer does not name the string');
    assert.match(r.verdict, /fret 11/, 'the answer does not name the fret');
    assert.equal(r.onScreen, true, 'the answer landed off screen (or under the header/nav)');
    assert.ok(r.fontPx >= 15, `the answer is set at ${r.fontPx}px — unreadable at arm's length`);
    assert.equal(r.scrollTop, before.scrollTop, 'the page scrolled when the answer appeared');
    assert.equal(r.card, before.card, 'the console changed height when the answer appeared');
    assert.equal(r.screen, before.screen, 'the stage moved when the answer appeared');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('no hint machinery survives in the play area', async () => {
  // The hint system is out of real-time play, completely: no button, no board
  // host, no ladder state, no setting, and no coaching line that offers one.
  const app = await openWithNote(SILENT);
  try {
    const r = await app.page.evaluate(() => {
      setMode('find');
      document.getElementById('gvSettings').open = true;
      return {
        hintBtn: !!document.getElementById('fHint'),
        board: !!document.getElementById('fBoard'),
        hintSeg: !!document.getElementById('gvHintSeg'),
        showHint: typeof window.showHint,
        hintLevel: typeof window.hintLevel,
        controls: [...document.querySelectorAll('#secFind .gv-controls button')]
          .map(b => b.textContent.trim()),
        sub: document.getElementById('fSub').textContent,
      };
    });
    assert.equal(r.hintBtn, false, 'the Hint button is still in the DOM');
    assert.equal(r.board, false, 'the hint board host is still in the DOM');
    assert.equal(r.hintSeg, false, 'the Hints setting is still in the difficulty panel');
    assert.equal(r.showHint, 'undefined', 'showHint is still reachable');
    assert.equal(r.hintLevel, 'undefined', 'the hint-ladder state is still exported');
    assert.deepEqual(r.controls, ['Show me →'],
      'the play area should offer exactly one control: ' + JSON.stringify(r.controls));
    assert.doesNotMatch(r.sub, /[Hh]int/, 'the coaching line still points at a hint');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('a wrong answer paints one committed banner — the UI does not flicker', async () => {
  // The regression the game overhaul exists for: the old screen streamed
  // "hearing A…" and re-painted verdicts as the note rang, so playing felt
  // like the UI was flickering. A judged note now paints ONE banner and the
  // banner holds while the same note keeps sounding.
  const app = await openWithNote(A1); // playing A at a question that wants G
  try {
    await app.page.evaluate(() => {
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });
    await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('no') ? el.textContent : null;
    });
    const samples = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await app.page.evaluate(() =>
        document.getElementById('fVerdict').textContent));
      await new Promise(r => setTimeout(r, 140));
    }
    assert.equal(new Set(samples).size, 1,
      'the verdict repainted while one wrong note rang: ' + JSON.stringify(samples));
    const heard = await app.page.textContent('#fHeard');
    assert.doesNotMatch(heard, /hearing /, 'the raw "hearing…" stream is back');
    assert.ok(await app.page.evaluate(() => !!document.getElementById('gvScene')),
      'the game scene canvas is missing');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('sheet-music mode poses the question on a bass-clef staff, and Show me names it', async () => {
  const app = await openWithNote(A1); // a wrong note, so the question stays put
  try {
    const { page } = app;
    await page.evaluate(() => {
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });
    await openSettings(page);   // the difficulty panel is closed during play
    await page.click('#gvPromptSeg button[data-r="staff"]');
    await page.waitForSelector('#gvStaffWrap:not(.hidden)', { timeout: 3000 });
    // The prompt is a difficulty axis: switching it starts a NEW run and a
    // fresh question, so the name to hide/reveal is the app's own pick.
    const name = await page.evaluate(() => q.name);
    assert.ok(name, 'no question was posed after switching to reading mode');
    const posed = await page.textContent('#fQ');
    assert.match(posed, /Play this note on the/, 'the reading question should not name the note');
    // The question names the STRING, never the note.
    assert.equal(await page.evaluate(() => !!document.querySelector('#fQ .gv-note')), false,
      'the note name leaked into a reading question');
    // The staff canvas must actually carry ink — lines, clef and a note head.
    const inked = await page.evaluate(() => {
      const cv = document.getElementById('gvStaff');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    assert.ok(inked > 300, 'the staff canvas is blank (' + inked + ' inked pixels)');
    /* Reading mode lost its name-rung escape hatch with the hint ladder, and
       that rung was also the non-visual player's only route to the answer.
       Show me has to carry that weight: it must SAY the note, the string, the
       fret and where the note sits on the page — in the aria-live verdict, not
       only in ink on a canvas. */
    const sn = await page.evaluate(() => q.sn);
    await page.click('#fSkip');
    await page.waitForTimeout(250);
    const shown = await page.textContent('#fVerdict');
    assert.ok(new RegExp(name.replace('#', '[#♯♭]').replace(/^([A-G])$/, '$1')).test(shown)
      || /[A-G][♯♭]?/.test(shown),
      'Show me must name the note (' + name + '): "' + shown + '"');
    assert.match(shown, new RegExp(sn + ' string'), 'Show me must name the string');
    assert.match(shown, /fret \d/, 'Show me must name the fret');
    assert.match(shown, /written (on|in|just|above|below)/,
      'in reading mode Show me must also read the position off the page: "' + shown + '"');
    assert.equal(await page.evaluate(() =>
      document.getElementById('fVerdict').getAttribute('aria-live')), 'polite',
      'the answer is not announced to a screen reader');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('every corner of the range draws unclipped on the question staff', async () => {
  // Regression: the staff canvas was 124px tall, and the written G4 (G string,
  // fret 12 — staff position 14) drew its note head above the canvas: a
  // reading question whose note was literally not on the page.
  const app = await openWithNote(987.767);   // silent to the detector
  try {
    const { page } = app;
    await page.evaluate(() => setMode('find'));
    for (const midi of [23, 28, 43, 55]) {   // low B, open E, open G, high G
      const r = await page.evaluate((m) => {
        const cv = document.getElementById('gvStaff');
        drawStaff(cv, m, {});
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let amber = 0, edge = 0;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (d[i + 3] > 0 && d[i] > 225 && d[i + 1] > 150 && d[i + 1] < 190
              && d[i + 2] > 40 && d[i + 2] < 80) {
            amber++;
            if (y < 2 || y >= cv.height - 2) edge++;
          }
        }
        return { amber, edge };
      }, midi);
      assert.ok(r.amber > 40, `midi ${midi}: only ${r.amber} note-head pixels — the head is clipped`);
      assert.equal(r.edge, 0, `midi ${midi}: note ink touches the canvas edge — it is being cut off`);
    }
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('being shown the answer banks a soft miss, not a find — and books it to come back', async () => {
  // Replaces "a correct answer shown by the reveal hint is a failed recall,
  // not a clean find". The reveal is gone, but the exploit it guarded is not:
  // Show me is now the one way to be handed an answer, and it must not pay.
  // Its bookkeeping is deliberately its OWN shape — softer than a wrong note,
  // harder than a find:
  //   · the position takes heat and a recent-miss (the picker must bring it back)
  //   · the session counts a question asked, no find, no first-try, streak gone
  //   · the note is booked into the review queue
  const app = await openWithNote(SILENT);
  try {
    const { page } = app;
    await page.evaluate(() => {
      localStorage.removeItem('bassTrainer.gamemem.v1');
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      wrongThisQ = 0; qStart = performance.now();
    });
    const before = await page.evaluate(() => ({
      score: document.getElementById('fScore').textContent,
    }));
    await page.click('#fSkip');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      verdict: document.getElementById('fVerdict').textContent,
      stats: JSON.parse(localStorage.getItem('bassTrainer.gamemem.v1')).stats,
      score: document.getElementById('fScore').textContent,
      clean: document.getElementById('fClean').textContent,
      streak: document.getElementById('fStreak').textContent,
      asked: document.getElementById('fAsked').textContent,
      xp: GV.run.state.xp, zaps: GV.run.state.zaps, combo: GV.run.state.combo,
    }));
    assert.match(r.verdict, /G/, 'a shown answer must name the note');
    assert.equal(r.stats.heat['E:3'], 1, 'the position took no heat — the picker will not bring it back');
    assert.deepEqual(r.stats.noteRecent['E:3'], [0], 'the rolling record does not show the miss');
    assert.equal(r.score, before.score, 'a shown answer counted as a note found');
    assert.equal(r.clean, '0', 'a shown answer counted as a first-try find');
    assert.equal(r.streak, '0', 'the session streak survived being shown the answer');
    assert.equal(r.asked, '1', 'the question was not counted as asked');
    assert.equal(r.xp, 0, 'a shown answer paid XP');
    assert.equal(r.zaps, 0, 'a shown answer counted as a note nailed');
    assert.equal(r.combo, 0, 'a shown answer kept the combo');
    // …and the note is booked to come back: the next few questions must serve
    // it again, which is the whole point of showing it.
    const comesBack = await until(page, () => {
      for (let i = 0; i < 12; i++) {
        if (q && q.sn === 'E' && q.f === 3) return true;
        newQuestion();
      }
      return false;
    }, null, 4000);
    assert.ok(comesBack, 'the note you were shown never came back');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});
