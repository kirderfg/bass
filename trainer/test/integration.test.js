/* End-to-end tests: a synthesized bass plays into the real browser and we
   assert the app reacts correctly. Run with `npm run test:e2e`. */
const { test } = require('node:test');
const assert = require('node:assert');
const { openWithNote, until } = require('./harness.js');

// Equal-temperament reference pitches (A4 = 440).
const E1 = 41.203, G2 = 97.999, A1 = 55.000, G3 = 195.998;

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

test('playing the requested note scores a point and records it for the practice checkpoints', async () => {
  const app = await openWithNote(G2);
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTheoryTrainer.v1');
      setMode('find');
      // Ask for exactly the note our synthetic bass is playing: G on the E string.
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      hintLevel = 0; wrongThisQ = 0; qStart = performance.now();
      document.getElementById('fQ').innerHTML = 'Play <b>G</b> on the <b>E</b> string';
      tracker.reset();
    });

    const verdict = await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('ok') ? el.textContent : null;
    });
    assert.ok(verdict, 'app never accepted the correct note');

    const stats = await app.page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')).stats);
    assert.equal(stats.correct, 1, 'one correct answer should be banked');
    assert.equal(stats.byString.E.c, 1, 'credited to the E string');
    assert.ok(Array.isArray(stats.byString.E.recent) && stats.byString.E.recent[0] === 1,
      'written in the rolling last-20 format the Theory Trainer reads');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('playing the wrong note is rejected, and a second miss opens the hint', async () => {
  const app = await openWithNote(A1); // playing A, but we will ask for G
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTheoryTrainer.v1');
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      hintLevel = 0; wrongThisQ = 0; qStart = performance.now();
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

    // A repeated miss should surface help without being asked.
    const hinted = await until(app.page, () => {
      const sub = document.getElementById('fSub').textContent;
      return /between fret|right here/.test(sub) ? sub : null;
    }, null, 8000);
    assert.ok(hinted, 'no hint appeared after repeated misses');

    const stats = await app.page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')).stats);
    assert.equal(stats.correct, 0);
    assert.equal(stats.heat['E:3'], 1, 'the miss should show on the fretboard heatmap');
  } finally { await app.close(); }
});

test('the right note in the wrong octave gets its own explanation', async () => {
  const app = await openWithNote(G3); // G, but an octave above the asked-for G2
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTheoryTrainer.v1');
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      hintLevel = 0; wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });
    const verdict = await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('no') ? el.textContent : null;
    });
    assert.match(verdict, /octave/i, `expected an octave-specific message, got "${verdict}"`);
  } finally { await app.close(); }
});

test('echo mode accepts the right pitch class played in any octave', async () => {
  const app = await openWithNote(G2);
  try {
    await app.page.evaluate(() => {
      setMode('echo');
      echoTarget = 55;      // G3 — an octave above what we are about to play
      tracker.reset();
    });
    const verdict = await until(app.page, () => {
      const el = document.getElementById('eVerdict');
      return el.className.includes('ok') ? el.textContent : null;
    });
    assert.ok(verdict, 'echo mode should accept the same note an octave away');
    assert.match(verdict, /G/);
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
  const app = await openWithNote(G2);
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTheoryTrainer.v1');
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      hintLevel = 0; wrongThisQ = 0; qStart = performance.now();
    });

    await until(app.page, () => {
      const el = document.getElementById('fVerdict');
      return el.className.includes('ok') ? el.textContent : null;
    });

    // The app now picks its own next question while G keeps sounding.
    await new Promise(r => setTimeout(r, 4000));

    const stats = await app.page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')).stats);
    assert.equal(stats.correct, 1, 'exactly one answer was actually played');
    assert.equal(stats.answered, 1,
      `the ring-out was judged again: ${stats.answered} answers recorded for one note`);
    assert.deepEqual(stats.heat, {}, 'no phantom misses on the heatmap');
  } finally { await app.close(); }
});

test('entering echo mode does not score the note the app itself just played', async () => {
  const app = await openWithNote(E1);
  try {
    await app.page.evaluate(() => { setMode('echo'); echoTarget = 43; });
    await new Promise(r => setTimeout(r, 600));
    const verdict = await app.page.evaluate(() => document.getElementById('eVerdict').textContent.trim());
    assert.equal(verdict, '', `echo judged before the player did anything: "${verdict}"`);
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

test('the string labels stay visible when the fretboard scrolls to a hint', async () => {
  // Regression: scrolling the board to reveal a high fret painted the cells
  // over the sticky string labels, so the reveal showed an unlabelled grid.
  const app = await openWithNote(G2);
  try {
    await app.page.evaluate(() => {
      setMode('find');
      tier = 4; focus = null; renderTierUI();
      q = { si: 2, f: 11, midi: 66, sn: 'A', name: 'F#' };
      hintLevel = 1; showHint();          // jump to the full reveal
      // The game scene sits above the board now, so on a phone viewport the
      // reveal starts below the fold; elementFromPoint needs it on screen.
      document.getElementById('fBoard').scrollIntoView({ block: 'center' });
    });
    await app.page.waitForTimeout(400);

    const labelsVisible = await app.page.evaluate(() => {
      const labels = [...document.querySelectorAll('#fBoard .neck-label')];
      if (!labels.length) return 'no labels rendered';
      return labels.every(l => {
        const r = l.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top === l || l.contains(top);
      });
    });
    assert.equal(labelsVisible, true, 'fretboard cells are covering the string labels');
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
      hintLevel = 0; wrongThisQ = 0; qStart = performance.now();
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

test('sheet-music mode poses the question on a bass-clef staff, and the hint names it', async () => {
  const app = await openWithNote(A1); // a wrong note, so the question stays put
  try {
    const { page } = app;
    await page.evaluate(() => {
      setMode('find');
      q = { si: 1, f: 3, midi: 43, sn: 'E', name: 'G' };
      hintLevel = 0; wrongThisQ = 0; qStart = performance.now();
      tracker.reset();
    });
    await page.click('#gvPromptSeg button[data-r="staff"]');
    await page.waitForSelector('#gvStaffWrap:not(.hidden)', { timeout: 3000 });
    const posed = await page.textContent('#fQ');
    assert.match(posed, /Play this note on the/, 'the reading question should not name the note');
    assert.doesNotMatch(posed, /\bG\b/, 'the note name leaked into a reading question');
    // The staff canvas must actually carry ink — lines, clef and a note head.
    const inked = await page.evaluate(() => {
      const cv = document.getElementById('gvStaff');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    assert.ok(inked > 300, 'the staff canvas is blank (' + inked + ' inked pixels)');
    // First hint in reading mode is the note's NAME.
    await page.click('#fHint');
    assert.match(await page.textContent('#fQ'), /G/, 'the hint should reveal the name');
    assert.deepEqual(app.errors, [], 'page errors');
  } finally { await app.close(); }
});

test('repeated guesses at one ear-training note count as a single answer', async () => {
  // Regression: Echo recorded every wrong guess into the shared accuracy that
  // the Theory Trainer's checkpoints read, penalising the act of practising.
  const app = await openWithNote(G2);
  try {
    await app.page.evaluate(() => {
      localStorage.removeItem('bassTheoryTrainer.v1');
      setMode('echo');
      echoTarget = 45;            // A2 — we will keep "playing" G at it
      echoWrongThisTarget = 0;
      A.muteUntil = 0;
    });
    await until(app.page, () => {
      const el = document.getElementById('eVerdict');
      return el.className.includes('no') ? el.textContent : null;
    });
    // Keep guessing the same wrong note for a few seconds.
    await app.page.waitForTimeout(2500);

    const stats = await app.page.evaluate(() =>
      JSON.parse(localStorage.getItem('bassTheoryTrainer.v1')).stats);
    assert.equal(stats.answered, 1,
      `hunting for the note recorded ${stats.answered} answers against accuracy`);
  } finally { await app.close(); }
});
