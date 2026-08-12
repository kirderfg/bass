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
