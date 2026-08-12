/* The 12-week course as testable data. These invariants ARE the point of
   extracting WEEKS out of app-theory: the 3-week course shipped You Shook Me
   All Night Long against a C root no week had taught, and nothing could have
   caught it because the plan lived inside an IIFE. Now the plan is data, and
   the gap analysis is a machine-checked rule. Run with `npm test`. */
const { test } = require('node:test');
const assert = require('node:assert');
const Course = require('../../shared/course.js');
const Songs = require('../../shared/songs.js');

/* ---------------- shape ---------------- */

test('the course is 12 weeks in 3 phases, and every week belongs to exactly one', () => {
  assert.equal(Course.WEEKS.length, 12);
  assert.equal(Course.PHASES.length, 3);
  assert.deepEqual(Course.PHASES.map(p => p.name),
    ['Foundations', 'Repertoire', 'Performance']);
  const claimed = [];
  for (const p of Course.PHASES) {
    assert.ok(p.grades, 'phase ' + p.name + ' must say what its proof is');
    claimed.push(...p.weeks);
  }
  assert.deepEqual(claimed.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const w of Course.WEEKS) {
    assert.equal(Course.weekOf(w.n), w, 'weekOf(' + w.n + ')');
    assert.ok(Course.phaseOf(w.n), 'phaseOf(' + w.n + ')');
    assert.ok(Course.phaseOf(w.n).weeks.includes(w.n));
  }
});

test('item and checkpoint ids are unique across the whole course', () => {
  const seen = new Set();
  for (const w of Course.WEEKS) {
    for (const it of w.items.concat(w.checkpoints)) {
      assert.ok(it.id, 'week ' + w.n + ' has an id-less entry');
      assert.ok(!seen.has(it.id), 'duplicate id ' + it.id);
      seen.add(it.id);
    }
  }
});

test('every week has a tune item and at least one checkpoint, and fits the evening', () => {
  for (const w of Course.WEEKS) {
    assert.ok(w.items.some(it => it.tune), 'week ' + w.n + ' has no tune item — markTuned() would find nothing');
    assert.ok(w.checkpoints.length >= 1, 'week ' + w.n + ' has no checkpoint');
    const min = w.items.reduce((a, it) => a + it.min, 0);
    // Foundations and Repertoire evenings are ~30 min with headroom; the
    // Performance phase says up front that evenings run honestly up to 40.
    const cap = w.n <= 8 ? 35 : 40;
    assert.ok(min <= cap, 'week ' + w.n + ' asks for ' + min + ' min (cap ' + cap + ')');
    assert.ok(w.title && w.goal, 'week ' + w.n + ' needs a title and a goal');
  }
});

/* ---------------- the compatibility contract ---------------- */

test('weeks 1-3 carry exactly the legacy ids the user has history against', () => {
  // Hardcoded on purpose: this list is the contract. Rename or drop any of
  // these and every logged practice day and ticked checkpoint orphans.
  const LEGACY = {
    1: { items: ['w1t', 'w1a', 'w1b', 'w1c', 'w1d'], cps: ['w1cp0', 'w1cp1', 'w1cp2'] },
    2: { items: ['w2t', 'w2a', 'w2b', 'w2c', 'w2d', 'w2e'], cps: ['w2cp0', 'w2cp1', 'w2cp2'] },
    3: { items: ['w3t', 'w3a', 'w3b', 'w3c', 'w3d', 'w3e'], cps: ['w3cp0', 'w3cp1', 'w3cp2'] },
  };
  for (const n of [1, 2, 3]) {
    const w = Course.weekOf(n);
    assert.deepEqual(w.items.map(i => i.id), LEGACY[n].items, 'week ' + n + ' item ids');
    assert.deepEqual(w.checkpoints.map(c => c.id), LEGACY[n].cps, 'week ' + n + ' checkpoint ids');
  }
});

/* ---------------- the gap analysis, as a rule ---------------- */

test('every song scheduled in week N uses only roots introduced by week N', () => {
  // THE invariant. It would have caught the YSMANL/C bug the 3-week course
  // shipped: the song was in the book, C was in its chorus, and no week
  // taught C. A song's roots come from its roadmap, never from a hand-kept list.
  const byId = Object.fromEntries(Songs.SONGS.map(s => [s.id, s]));
  for (const w of Course.WEEKS) {
    const known = Course.rootsIntroducedBy(w.n);
    for (const id of Course.songsScheduledIn(w.n)) {
      const song = byId[id];
      assert.ok(song, 'week ' + w.n + ' schedules unknown song "' + id + '"');
      for (const sec of song.sections) {
        assert.ok(known.includes(sec.root),
          'week ' + w.n + ' schedules ' + song.title + ' but its ' + sec.name +
          ' needs ' + sec.root + ', which is only taught later');
      }
    }
  }
  // The map itself, pinned: E/A/D/G belong to the foundations, C to week 4,
  // B to week 8.
  assert.ok(!Course.rootsIntroducedBy(3).includes('C'), 'C must not predate week 4');
  assert.ok(Course.rootsIntroducedBy(4).includes('C'));
  assert.ok(!Course.rootsIntroducedBy(7).includes('B'), 'B must not predate week 8');
  assert.ok(Course.rootsIntroducedBy(8).includes('B'));
});

test('every link points somewhere real: song presets, tab hrefs, destinations', () => {
  const DESTS = ['practice', 'scales', 'chords', 'trainer', 'tuner', 'find', 'echo', 'drill', 'songs'];
  const songIds = new Set(Songs.SONGS.map(s => s.id));
  for (const w of Course.WEEKS) {
    for (const it of w.items) {
      for (const key of ['link', 'link2', 'link3']) {
        const ln = it[key];
        if (!ln) continue;
        assert.ok(ln.label, w.n + '/' + it.id + ' ' + key + ' has no label');
        if (ln.spec) {
          assert.ok(DESTS.includes(ln.spec.tab), w.n + '/' + it.id + ' deep-links to "' + ln.spec.tab + '"');
        } else if (ln.live) {
          assert.ok(DESTS.includes(ln.live), w.n + '/' + it.id + ' opens live "' + ln.live + '"');
          if (ln.preset && ln.preset.song) {
            assert.ok(songIds.has(ln.preset.song),
              w.n + '/' + it.id + ' presets unknown song "' + ln.preset.song + '"');
          }
        } else if (ln.href) {
          assert.match(ln.href, /^https:\/\/www\.songsterr\.com\//,
            w.n + '/' + it.id + ' href goes somewhere other than Songsterr');
        } else {
          assert.fail(w.n + '/' + it.id + ' ' + key + ' is neither spec, live nor href');
        }
      }
    }
  }
});

test('all ten songs are scheduled at least once, ramping in tempo as they land', () => {
  const byId = Object.fromEntries(Songs.SONGS.map(s => [s.id, s]));
  const scheduled = new Set();
  for (const w of Course.WEEKS) {
    for (const id of Course.songsScheduledIn(w.n)) scheduled.add(id);
    // Within each Repertoire/early-Performance week, the week's songs are met
    // easiest-first: a week that opened on its faster song would front-load
    // the harder work.
    if (w.n >= 5 && w.n <= 9) {
      const fresh = Course.songsScheduledIn(w.n).filter(id => {
        for (let m = 1; m < w.n; m++) if (Course.songsScheduledIn(m).includes(id)) return false;
        return true;
      });
      for (let i = 1; i < fresh.length; i++) {
        assert.ok(byId[fresh[i]].bpm >= byId[fresh[i - 1]].bpm,
          'week ' + w.n + ' meets ' + fresh[i] + ' after the faster ' + fresh[i - 1]);
      }
    }
  }
  for (const s of Songs.SONGS) {
    assert.ok(scheduled.has(s.id), s.title + ' is in the book but never scheduled');
  }
});
