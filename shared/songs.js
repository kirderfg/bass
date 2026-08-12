/* ============================================================
   Song play-along engine.

   SCOPE, and why it stops where it does: a tab player already solves
   learning the notes of a song — Songsterr Plus shows the tab, mutes the
   bass track, slows the tempo and loops a section. Duplicating any of
   that would be building a worse Songsterr. The one thing no tab player
   does is HEAR THE PLAYER, so that is all this engine is for: it knows
   which root the section wants, and judges what actually came out of the
   bass against it.

   So these are PRACTICE ROADMAPS, not transcriptions: the root note and
   order of each section, which for root-driven rock is most of the
   bassline. Full note-for-note tablature of copyrighted songs is also a
   licensing problem, and is deliberately not reproduced — each song
   links out to its Songsterr tab instead.

   The clock runs from a TAP, not from the player. No player exposes a
   playhead this can read (Spotify's Web Playback SDK needs Premium and
   its reported position jitters by up to a second, against a ~500ms
   beat), so the player taps on beat 1 and this keeps time from there,
   with a re-sync if it drifts. That inaccuracy is also why song play is
   judged on ROOTS ONLY and never on rhythm — timing is graded on the
   drill screen, against a click the app itself scheduled. The drill
   screen's RHYTHM drills are the other half of that split: a bar of
   eighths on one root belongs to nobody, so sustaining a rhythm can be
   trained and graded there without crossing the tab-layer line drawn
   above.

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
      why: 'Slowest of the ten and built from three roots. The riff is the guitar’s; your job is landing E, D and A on time.',
      tab: 'https://www.songsterr.com/a/wsa/acdc-back-in-black-bass-tab-s449',
      sections: [
        { name: 'Intro riff', root: 'E', bars: 4 },
        { name: 'Verse', root: 'E', bars: 8 },
        { name: 'Pre-chorus', root: 'D', bars: 2 },
        { name: 'Pre-chorus', root: 'A', bars: 2 },
        { name: 'Chorus', root: 'E', bars: 8 },
      ],
    },
    /* The five below joined for the 12-week course. Roadmaps were researched and
       cross-checked; the Songsterr URLs came from live search-index results but
       could not be click-verified from this sandbox. */
    {
      id: 'hb', title: 'Hells Bells', artist: 'AC/DC', bpm: 108, beatsPerBar: 4,
      why: 'Slow and in A minor — your first long tacet intro with an entry on cue, and the C root is the first note the open-string drills never touch.',
      tab: 'https://www.songsterr.com/a/wsa/ac-dc-hells-bells-bass-tab-s205',
      sections: [
        { name: 'Intro', root: 'A', bars: 4 },
        { name: 'Verse', root: 'A', bars: 4 },
        { name: 'Verse', root: 'D', bars: 2 },
        { name: 'Verse', root: 'C', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
        { name: 'Chorus', root: 'D', bars: 2 },
        { name: 'Chorus', root: 'C', bars: 2 },
        { name: 'Chorus', root: 'D', bars: 2 },
      ],
    },
    {
      id: 'hth', title: 'Highway to Hell', artist: 'AC/DC', bpm: 116, beatsPerBar: 4,
      why: 'Three roots and a rhythm that never changes — the classic first AC/DC song. Week 3 of the plan drills these same roots.',
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
      id: 'hadom', title: 'Have a Drink on Me', artist: 'AC/DC', bpm: 122, beatsPerBar: 4,
      why: 'Four roots instead of three — the verse walks A, G and D like Highway, then the chorus adds C, so you prove you can hold a longer map.',
      tab: 'https://www.songsterr.com/a/wsa/ac-dc-have-a-drink-on-me-bass-tab-s23714',
      sections: [
        { name: 'Intro riff', root: 'A', bars: 4 },
        { name: 'Verse', root: 'A', bars: 4 },
        { name: 'Verse', root: 'G', bars: 2 },
        { name: 'Verse', root: 'D', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 4 },
        { name: 'Chorus', root: 'C', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
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
      why: 'Fastest here, and in a new key — G, C and D instead of the E and A shapes the plan starts with.',
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
    {
      id: 'ts', title: 'Thunderstruck', artist: 'AC/DC', bpm: 134, beatsPerBar: 4,
      why: 'One root for minutes at a time — but it is B, your first root with no open string, so the fretting hand finally earns its keep.',
      tab: 'https://www.songsterr.com/a/wsa/ac-dc-thunderstruck-bass-tab-s1352',
      sections: [
        { name: 'Intro chant', root: 'B', bars: 8 },
        { name: 'Verse', root: 'B', bars: 8 },
        { name: 'Chorus', root: 'B', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
        { name: 'Chorus', root: 'E', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
      ],
    },
    {
      id: 'ggr', title: 'Girls Got Rhythm', artist: 'AC/DC', bpm: 138, beatsPerBar: 4,
      why: 'Pure eighth-note stamina on roots you already drill — nothing new to learn, everything to sustain at speed. Check the chorus root order against the tab before you gig it: the roots are confirmed, their order here is a best reconstruction.',
      tab: 'https://www.songsterr.com/a/wsa/ac-dc-girls-got-rhythm-bass-tab-s24083',
      sections: [
        { name: 'Intro', root: 'A', bars: 4 },
        { name: 'Verse', root: 'A', bars: 8 },
        { name: 'Chorus', root: 'D', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
        { name: 'Chorus', root: 'E', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
      ],
    },
    {
      id: 'stt', title: 'Shoot to Thrill', artist: 'AC/DC', bpm: 141, beatsPerBar: 4,
      why: 'Fastest of the ten: Dirty Deeds’ A, G and D moves at a sprint, plus a breakdown where you go quiet without slowing down.',
      tab: 'https://www.songsterr.com/a/wsa/ac-dc-shoot-to-thrill-bass-tab-s569',
      sections: [
        { name: 'Intro riff', root: 'A', bars: 4 },
        { name: 'Verse', root: 'A', bars: 8 },
        { name: 'Chorus', root: 'A', bars: 2 },
        { name: 'Chorus', root: 'G', bars: 2 },
        { name: 'Chorus', root: 'D', bars: 2 },
        { name: 'Chorus', root: 'A', bars: 2 },
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

  /* ---------------- the gig-ready bar ----------------
     One rule for what "ready" means, stated as code so every screen agrees:
     - gig-ready: a 90%+ FULL memory-mode play on two DISTINCT days. Same day
       twice is one day of evidence — the drill engine's mastery-day rule.
     - learning: any banked full play (the store only banks bests from plays
       that covered the whole roadmap), or a first memory day.
     - new: nothing proved yet. Plays alone prove nothing — an abandoned
       twelve-second intro increments `plays` too. */
  function songReadiness(rec, song) {
    void song;   // the bar is the same for every song; the arg keeps call sites honest
    if (!rec || typeof rec !== 'object') return 'new';
    const days = Array.isArray(rec.memoryDays) ? new Set(rec.memoryDays).size : 0;
    if (days >= 2) return 'gig-ready';
    if (days >= 1 || (Number(rec.bestAccuracy) || 0) > 0) return 'learning';
    return 'new';
  }

  /* ---------------- setlist runs ----------------
     A live set is songs back to back, and the skill the single-song screen
     never tests is the seam: new key, count-in, go. So a set run is the same
     roots-per-section judging, chained, with an 8-beat gap between songs that
     runs at the NEXT song's tempo — it is that song's count-in. */
  const GAP_BEATS = 8;

  function createSetRun(songs) {
    // Boundaries in absolute ms from the set's beat 1, computed once.
    const segs = [];
    let t = 0;
    songs.forEach((song, i) => {
      if (i > 0) t += GAP_BEATS * (60000 / song.bpm);   // count-in at THIS song's tempo
      const len = totalBeats(song) * (60000 / song.bpm);
      segs.push({ song, index: i, startMs: t, endMs: t + len });
      t += len;
    });
    const runs = songs.map(createSongRun);
    // The entry is watched per song: a correct root inside the FIRST BAR, or
    // the song was entered late — the exact failure a band notices most.
    const entered = songs.map(() => false);

    function positionAt(ms) {
      for (const seg of segs) {
        if (ms < seg.startMs) {
          const beatMs = 60000 / seg.song.bpm;
          return {
            gap: true, finished: false, index: seg.index, nextSong: seg.song,
            nextRoot: seg.song.sections[0].root,
            beatsLeft: Math.max(1, Math.ceil((seg.startMs - ms) / beatMs)),
          };
        }
        if (ms < seg.endMs) {
          return { gap: false, finished: false, index: seg.index, song: seg.song,
                   pos: positionAtSong(seg.song, ms - seg.startMs) };
        }
      }
      return { finished: true, gap: false };
    }

    return {
      segments() { return segs.slice(); },
      totalMs() { return segs.length ? segs[segs.length - 1].endMs : 0; },
      positionAt,
      push(midi, ms) {
        const p = positionAt(ms);
        if (p.finished) return { verdict: 'finished' };
        if (p.gap) return { verdict: 'gap', nextSong: p.nextSong };
        const seg = segs[p.index];
        const r = runs[p.index].push(midi, ms - seg.startMs);
        const bpb = seg.song.beatsPerBar || 4;
        if (r.verdict === 'correct' && (ms - seg.startMs) < bpb * (60000 / seg.song.bpm)) {
          entered[p.index] = true;
        }
        return Object.assign({ songId: seg.song.id, songTitle: seg.song.title }, r);
      },
      result() {
        let correct = 0, wrong = 0;
        const perSong = songs.map((song, i) => {
          const r = runs[i].result();
          correct += r.correct; wrong += r.wrong;
          return { id: song.id, title: song.title, correct: r.correct, wrong: r.wrong,
                   accuracy: r.accuracy, bySection: r.bySection };
        });
        return {
          perSong, correct, wrong,
          accuracy: correct + wrong ? correct / (correct + wrong) : 0,
          entries: songs.map((song, i) => ({ id: song.id, made: entered[i] })),
        };
      },
    };
  }
  // createSongRun's clock is song-local; the set clock is absolute. Alias the
  // song-level positionAt so the closure above can use both without shadowing.
  const positionAtSong = positionAt;

  return {
    SONGS, timeline, totalBeats, positionAt, expectedRoot, upcomingChange,
    createSongRun, createSetRun, songReadiness, GAP_BEATS, NAMES,
  };
});
