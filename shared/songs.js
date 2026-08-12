/* ============================================================
   Song play-along engine.

   These are PRACTICE ROADMAPS, not transcriptions: the root note and
   order of each section, which for root-driven rock is most of the
   bassline. Full note-for-note tablature of copyrighted songs is a
   licensing problem and is deliberately not reproduced — each song
   links out to a tab instead.

   The clock runs from a TAP, not from Spotify. There is no way to read
   a streaming playhead accurately (the Web Playback SDK needs Premium
   and its reported position jitters by up to a second, against a
   ~500ms beat), so the player taps on beat 1 and this keeps time from
   there, with a re-sync if it drifts.

   No dependencies; `BassSongs` in a browser, require()-able in Node.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassSongs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = (n) => ((n % 12) + 12) % 12;
  function pcOf(name) {
    const i = NAMES.indexOf(name);
    return i >= 0 ? i : NAMES.indexOf(name.replace('b', '#'));
  }

  /* Ordered easiest-first: slowest and most repetitive comes first, which is
     the opposite of ordering by fame. Tempos are the commonly cited ones and
     are a starting point — practise slower and work up. */
  const SONGS = [
    {
      id: 'bib', title: 'Back in Black', artist: 'AC/DC', bpm: 92, beatsPerBar: 4,
      why: 'Slowest of the five and built from three roots. The riff is the guitar’s; your job is landing E, D and A on time.',
      tab: 'https://www.songsterr.com/a/wsa/acdc-back-in-black-bass-tab-s449',
      sections: [
        { name: 'Intro riff', root: 'E', bars: 4 },
        { name: 'Verse', root: 'E', bars: 8 },
        { name: 'Pre-chorus', root: 'D', bars: 2 },
        { name: 'Pre-chorus', root: 'A', bars: 2 },
        { name: 'Chorus', root: 'E', bars: 8 },
      ],
    },
    {
      id: 'hth', title: 'Highway to Hell', artist: 'AC/DC', bpm: 116, beatsPerBar: 4,
      why: 'Three roots you already know from week 3, in a rhythm that never changes. The classic first AC/DC song.',
      tab: 'https://www.songsterr.com/a/wsa/acdc-highway-to-hell-bass-tab-s448',
      sections: [
        { name: 'Intro', root: 'A', bars: 4 },
        { name: 'Verse', root: 'A', bars: 8 },
        { name: 'Verse', root: 'D', bars: 4 },
        { name: 'Chorus', root: 'A', bars: 4 },
        { name: 'Chorus', root: 'G', bars: 2 },
        { name: 'Chorus', root: 'D', bars: 2 },
      ],
    },
    {
      id: 'dd', title: 'Dirty Deeds Done Dirt Cheap', artist: 'AC/DC', bpm: 121, beatsPerBar: 4,
      why: 'Same three roots as Highway, moved around. Good for proving you can hear a section change coming.',
      tab: 'https://www.songsterr.com/a/wsa/acdc-dirty-deeds-done-dirt-cheap-bass-tab-s447',
      sections: [
        { name: 'Intro', root: 'A', bars: 4 },
        { name: 'Verse', root: 'A', bars: 8 },
        { name: 'Chorus', root: 'G', bars: 2 },
        { name: 'Chorus', root: 'D', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 4 },
      ],
    },
    {
      id: 'tnt', title: 'T.N.T.', artist: 'AC/DC', bpm: 126, beatsPerBar: 4,
      why: 'The song the three-week plan builds to: steady eighths on E, then the E → A → G chorus moves.',
      tab: 'https://www.songsterr.com/a/wsa/acdc-tnt-bass-tab-s407',
      sections: [
        { name: 'Intro chant', root: 'E', bars: 8 },
        { name: 'Verse', root: 'E', bars: 8 },
        { name: 'Chorus', root: 'E', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
        { name: 'Chorus', root: 'G', bars: 2 },
        { name: 'Chorus', root: 'E', bars: 2 },
      ],
    },
    {
      id: 'ysmanl', title: 'You Shook Me All Night Long', artist: 'AC/DC', bpm: 127, beatsPerBar: 4,
      why: 'Fastest here, and in a new key — G, C and D instead of the E and A shapes you have drilled.',
      tab: 'https://www.songsterr.com/a/wsa/acdc-you-shook-me-all-night-long-bass-tab-s446',
      sections: [
        { name: 'Intro', root: 'G', bars: 4 },
        { name: 'Verse', root: 'G', bars: 4 },
        { name: 'Verse', root: 'C', bars: 2 },
        { name: 'Verse', root: 'D', bars: 2 },
        { name: 'Chorus', root: 'G', bars: 4 },
        { name: 'Chorus', root: 'C', bars: 2 },
        { name: 'Chorus', root: 'D', bars: 2 },
      ],
    },
  ];

  const beatsPerBar = (song) => song.beatsPerBar || 4;

  /** Expand the roadmap into absolute beat positions. */
  function timeline(song) {
    const bpb = beatsPerBar(song);
    let beat = 0;
    return song.sections.map((sec, i) => {
      const len = sec.bars * bpb;
      const out = Object.assign({}, sec, {
        index: i, startBeat: beat, endBeat: beat + len, beats: len,
      });
      beat += len;
      return out;
    });
  }
  function totalBeats(song) {
    return song.sections.reduce((a, s) => a + s.bars * beatsPerBar(song), 0);
  }

  /**
   * Where in the song `elapsedMs` after the tap falls.
   * @returns {{beat, section, barInSection, beatInBar, finished}}
   */
  function positionAt(song, elapsedMs) {
    const bpb = beatsPerBar(song);
    const msPerBeat = 60000 / song.bpm;
    const beat = Math.floor(elapsedMs / msPerBeat);
    const tl = timeline(song);
    const sec = tl.find(s => beat >= s.startBeat && beat < s.endBeat);
    if (!sec) {
      return { beat, section: null, barInSection: 0, beatInBar: 0, finished: true };
    }
    const into = beat - sec.startBeat;
    return {
      beat,                                   // absolute, 0-based: for maths
      section: sec, finished: false,
      // 1-based, because these are shown to a musician who counts "bar 1,
      // beat 1" — not to a programmer.
      barInSection: Math.floor(into / bpb) + 1,
      beatInBar: (into % bpb) + 1,
      barsInSection: sec.bars,
    };
  }

  /** The root the band is on right now, or null past the end. */
  function expectedRoot(song, elapsedMs) {
    const p = positionAt(song, elapsedMs);
    return p.section ? p.section.root : null;
  }

  /**
   * The next section, if it is within `barsAhead` — so the roadmap can warn
   * "chorus coming, move to G" before it happens rather than after.
   */
  function upcomingChange(song, elapsedMs, barsAhead) {
    const bpb = beatsPerBar(song);
    const ahead = (barsAhead || 1) * bpb;
    const p = positionAt(song, elapsedMs);
    if (!p.section) return null;
    const tl = timeline(song);
    const next = tl[p.section.index + 1];
    if (!next) return null;
    const beatsToGo = next.startBeat - p.beat;
    if (beatsToGo <= 0 || beatsToGo > ahead) return null;
    return Object.assign({}, next, { beatsToGo });
  }

  /**
   * Judge a play-along by roots per section, untimed: "are you on the right
   * note for where the song is". Rhythm is deliberately not graded yet.
   */
  function createSongRun(song) {
    let correct = 0, wrong = 0;
    const bySection = {};
    return {
      push(midi, elapsedMs) {
        const p = positionAt(song, elapsedMs);
        if (!p.section) return { verdict: 'finished' };
        const want = pcOf(p.section.root);
        const ok = pc(midi) === want;
        const bucket = bySection[p.section.name] || (bySection[p.section.name] = { correct: 0, wrong: 0 });
        if (ok) { correct++; bucket.correct++; } else { wrong++; bucket.wrong++; }
        return {
          verdict: ok ? 'correct' : 'wrong',
          section: p.section.name,
          expectedRoot: p.section.root,
          playedName: NAMES[pc(midi)],
          beat: p.beat,
        };
      },
      result() {
        return {
          correct, wrong, bySection,
          accuracy: correct + wrong ? correct / (correct + wrong) : 0,
        };
      },
    };
  }

  return {
    SONGS, timeline, totalBeats, positionAt, expectedRoot, upcomingChange,
    createSongRun, NAMES,
  };
});
