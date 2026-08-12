const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../../shared/songs.js');

test('every song ships a playable roadmap: tempo, ordered sections, roots', () => {
  assert.ok(S.SONGS.length >= 5, 'five beginner-viable songs');
  for (const song of S.SONGS) {
    assert.ok(song.bpm > 40 && song.bpm < 200, song.title + ' bpm looks wrong');
    assert.ok(song.sections.length >= 2, song.title + ' needs sections');
    for (const sec of song.sections) {
      assert.ok(sec.bars > 0, song.title + '/' + sec.name + ' needs bars');
      assert.ok(typeof sec.root === 'string' && sec.root.length <= 2,
        song.title + '/' + sec.name + ' root must be a note name');
    }
  }
  // Ordered easiest-first: the slowest song comes before the fastest.
  assert.ok(S.SONGS[0].bpm < S.SONGS[S.SONGS.length - 1].bpm,
    'the list should ramp up in tempo');
});

test('a roadmap expands into a beat timeline', () => {
  const song = {
    bpm: 120, beatsPerBar: 4,
    sections: [
      { name: 'Intro', root: 'E', bars: 2 },
      { name: 'Verse', root: 'A', bars: 4 },
    ],
  };
  const tl = S.timeline(song);
  assert.equal(tl.length, 2);
  assert.equal(tl[0].startBeat, 0);
  assert.equal(tl[0].endBeat, 8, '2 bars of 4 = 8 beats');
  assert.equal(tl[1].startBeat, 8);
  assert.equal(tl[1].endBeat, 24, '4 more bars = 16 more beats');
  assert.equal(S.totalBeats(song), 24);
});

test('position is measured from the moment you tapped, so it can follow a record', () => {
  // There is no way to read Spotify's playhead accurately, so the player taps
  // on beat 1 and the app runs its own clock from that tap.
  const song = {
    bpm: 120, beatsPerBar: 4,
    sections: [
      { name: 'Intro', root: 'E', bars: 2 },   // beats 0-7
      { name: 'Verse', root: 'A', bars: 4 },   // beats 8-23
    ],
  };
  // At 120bpm a beat is 500ms.
  assert.equal(S.positionAt(song, 0).section.name, 'Intro');
  assert.equal(S.positionAt(song, 0).beat, 0);
  assert.equal(S.positionAt(song, 1500).beat, 3, '1.5s = 3 beats at 120bpm');
  assert.equal(S.positionAt(song, 1500).section.name, 'Intro');
  assert.equal(S.positionAt(song, 4000).section.name, 'Verse', 'beat 8 starts the verse');
  assert.equal(S.positionAt(song, 4000).barInSection, 1, 'the first bar of a section is bar 1, not bar 0');
  assert.equal(S.positionAt(song, 4000).beatInBar, 1);
  // Past the end, it reports finished rather than running off the timeline.
  assert.equal(S.positionAt(song, 999999).finished, true);
});

test('the expected root is the one for wherever you are now', () => {
  const song = {
    bpm: 120, beatsPerBar: 4,
    sections: [
      { name: 'Intro', root: 'E', bars: 2 },
      { name: 'Chorus', root: 'G', bars: 2 },
    ],
  };
  assert.equal(S.expectedRoot(song, 0), 'E');
  assert.equal(S.expectedRoot(song, 3999), 'E');
  assert.equal(S.expectedRoot(song, 4000), 'G', 'the chorus changed the root');
});

test('playing the right root counts, and a wrong one names what the section wanted', () => {
  const song = {
    bpm: 120, beatsPerBar: 4,
    sections: [
      { name: 'Verse', root: 'E', bars: 2 },
      { name: 'Chorus', root: 'G', bars: 2 },
    ],
  };
  const run = S.createSongRun(song);
  // E in any octave is the verse root — this is roots-per-section, untimed.
  assert.equal(run.push(28, 500).verdict, 'correct');
  assert.equal(run.push(40, 1000).verdict, 'correct', 'a higher E is still the root');

  const wrong = run.push(33, 1500);           // A during an E section
  assert.equal(wrong.verdict, 'wrong');
  assert.equal(wrong.expectedRoot, 'E');
  assert.equal(wrong.playedName, 'A');
  assert.equal(wrong.section, 'Verse');

  // After the change, G becomes right and E becomes wrong.
  assert.equal(run.push(31, 4500).verdict, 'correct', 'G in the chorus');
  assert.equal(run.push(28, 5000).verdict, 'wrong', 'E is last section&apos;s root');

  const r = run.result();
  assert.equal(r.correct, 3);
  assert.equal(r.wrong, 2);
  assert.deepEqual(r.bySection.Verse, { correct: 2, wrong: 1 });
});

/* ---------------- the ten-song book ---------------- */

test('the book holds the ten songs of the set, ordered easiest-first by tempo', () => {
  assert.equal(S.SONGS.length, 10, 'the 12-week course gigs on ten songs');
  // The order is a promise the list makes: the song above you is never faster.
  for (let i = 1; i < S.SONGS.length; i++) {
    assert.ok(S.SONGS[i].bpm >= S.SONGS[i - 1].bpm,
      S.SONGS[i].title + ' (' + S.SONGS[i].bpm + ') sits after ' +
      S.SONGS[i - 1].title + ' (' + S.SONGS[i - 1].bpm + ')');
  }
  const ids = S.SONGS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'song ids must be unique');
  // The five that joined for the course, at their researched tempos.
  const byId = Object.fromEntries(S.SONGS.map(s => [s.id, s]));
  assert.equal(byId.hb.bpm, 108, 'Hells Bells');
  assert.equal(byId.hadom.bpm, 122, 'Have a Drink on Me');
  assert.equal(byId.ts.bpm, 134, 'Thunderstruck');
  assert.equal(byId.ggr.bpm, 138, 'Girls Got Rhythm');
  assert.equal(byId.stt.bpm, 141, 'Shoot to Thrill');
});

test('every roadmap is playable data: sections, bars, and roots that parse', () => {
  const VALID = new Set(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
                         'Db', 'Eb', 'Gb', 'Ab', 'Bb']);
  for (const song of S.SONGS) {
    assert.ok(song.sections.length >= 2, song.title + ' needs at least two sections');
    assert.ok(song.why, song.title + ' needs a why — the list explains every pick');
    assert.match(song.tab, /^https:\/\/www\.songsterr\.com\//, song.title + ' tab link');
    for (const sec of song.sections) {
      assert.ok(VALID.has(sec.root), song.title + '/' + sec.name + ' root "' + sec.root + '"');
      assert.ok(sec.bars > 0, song.title + '/' + sec.name + ' bars');
    }
  }
  // The new keys the course teaches for: Thunderstruck pedals on B, and
  // Hells Bells is where C stops being a note the open-string drills skip.
  const roots = (id) => S.SONGS.find(s => s.id === id).sections.map(x => x.root);
  assert.ok(roots('ts').includes('B'), 'Thunderstruck must pedal on B');
  assert.ok(roots('hb').includes('C'), 'Hells Bells must visit C');
});

test('a section change is announced so the player can see it coming', () => {
  const song = {
    bpm: 120, beatsPerBar: 4,
    sections: [
      { name: 'Verse', root: 'E', bars: 2 },
      { name: 'Chorus', root: 'G', bars: 2 },
    ],
  };
  // One bar of warning before the change: beat 8 is the change, so beat 4+.
  assert.equal(S.upcomingChange(song, 0), null, 'nothing to warn about yet');
  const warn = S.upcomingChange(song, 2000);   // beat 4, one bar out
  assert.ok(warn, 'a change one bar away should be flagged');
  assert.equal(warn.root, 'G');
  assert.equal(warn.name, 'Chorus');
});

/* ---------------- setlist runs ---------------- */

// Two tiny songs at different tempos, so the boundary maths is checkable by hand.
const SET_A = {
  id: 'a', title: 'Song A', bpm: 120, beatsPerBar: 4,
  sections: [{ name: 'Verse', root: 'E', bars: 2 }],       // 8 beats @500ms = 4000ms
};
const SET_B = {
  id: 'b', title: 'Song B', bpm: 60, beatsPerBar: 4,
  sections: [{ name: 'Verse', root: 'G', bars: 1 }],       // 4 beats @1000ms = 4000ms
};

test('a set run sequences songs back to back with an 8-beat gap at the NEXT tempo', () => {
  const run = S.createSetRun([SET_A, SET_B]);
  const segs = run.segments();
  assert.equal(segs.length, 2);
  assert.equal(segs[0].startMs, 0);
  assert.equal(segs[0].endMs, 4000, 'song A is 8 beats at 120');
  // The gap counts you IN to song B, so it runs at B's tempo: 8 × 1000ms.
  assert.equal(segs[1].startMs, 12000, '4000 + 8 beats at 60bpm');
  assert.equal(segs[1].endMs, 16000);
});

test('positionAt knows which song has the floor, and when the set is between songs', () => {
  const run = S.createSetRun([SET_A, SET_B]);
  const inA = run.positionAt(1000);
  assert.equal(inA.gap, false);
  assert.equal(inA.song.id, 'a');
  assert.equal(inA.pos.section.root, 'E');

  const gap = run.positionAt(5000);            // 1s into the 8s gap
  assert.equal(gap.gap, true);
  assert.equal(gap.nextSong.id, 'b', 'the gap announces what comes next');
  assert.equal(gap.beatsLeft, 7, '7 of the 8 count-in beats remain');

  const inB = run.positionAt(13000);
  assert.equal(inB.gap, false);
  assert.equal(inB.song.id, 'b');
  assert.equal(run.positionAt(16001).finished, true);
});

test('pushes are graded against whichever song is playing, and never during the gap', () => {
  const run = S.createSetRun([SET_A, SET_B]);
  assert.equal(run.push(28, 500).verdict, 'correct', 'E during song A');
  assert.equal(run.push(31, 1000).verdict, 'wrong', 'G is not song A\'s root');
  assert.equal(run.push(31, 5000).verdict, 'gap', 'the gap judges nothing');
  assert.equal(run.push(31, 13000).verdict, 'correct', 'G during song B');

  const r = run.result();
  assert.equal(r.perSong.length, 2);
  assert.equal(r.perSong[0].id, 'a');
  assert.deepEqual([r.perSong[0].correct, r.perSong[0].wrong], [1, 1]);
  assert.deepEqual([r.perSong[1].correct, r.perSong[1].wrong], [1, 0]);
  assert.equal(r.correct, 2); assert.equal(r.wrong, 1);
  assert.ok(Math.abs(r.accuracy - 2 / 3) < 1e-9, 'overall accuracy pools every judged note');
});

test('the entry into each song — the moment of "new key, go" — is watched by name', () => {
  // Song B needs a second bar here: a one-bar song is ALL first bar, so a
  // late note could never be told apart from a made entry.
  const B2 = Object.assign({}, SET_B, { sections: [{ name: 'Verse', root: 'G', bars: 2 }] });
  const run = S.createSetRun([SET_A, B2]);
  run.push(28, 500);                 // song A entered inside its first bar
  run.push(31, 17000);               // song B (starts 12000): first correct note in bar 2
  const r = run.result();
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries[0], { id: 'a', made: true });
  assert.deepEqual(r.entries[1], { id: 'b', made: false },
    'a correct note after the first bar is a recovered song, not a made entry');
});

/* ---------------- the gig-ready bar ---------------- */

test('gig-ready is two distinct memory days; a banked full play is learning; else new', () => {
  const song = S.SONGS[0];
  assert.equal(S.songReadiness(undefined, song), 'new', 'no record at all');
  assert.equal(S.songReadiness({ id: song.id, plays: 3 }, song), 'new',
    'plays without a banked full play prove nothing');

  assert.equal(S.songReadiness({ id: song.id, plays: 3, bestAccuracy: 0.7 }, song),
    'learning', 'any banked full play — the store only banks bests from full plays');
  assert.equal(S.songReadiness({ id: song.id, memoryDays: ['2026-08-11'] }, song),
    'learning', 'one memory day is progress, not proof');

  assert.equal(S.songReadiness(
    { id: song.id, memoryDays: ['2026-08-11', '2026-08-12'] }, song), 'gig-ready');
  // Distinct DAYS, the same discipline as the drill engine's mastery days:
  // two banked plays inside one evening are one day of evidence.
  assert.equal(S.songReadiness(
    { id: song.id, memoryDays: ['2026-08-11', '2026-08-11'] }, song), 'learning');
});
