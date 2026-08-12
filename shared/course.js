/* ============================================================
   The 12-week course, as testable data.

   This used to be a 3-week WEEKS array sealed inside app-theory's
   IIFE — which is exactly how You Shook Me All Night Long shipped
   with a C root no week had taught: the plan could not be checked
   against the song book because neither could see the other. Now the
   plan is a module, and trainer/test/course.test.js holds it to the
   rules that matter: ids stay unique (logs key on them), every week
   tunes up first, evenings fit the evening, and a song is never
   scheduled before its roots have been taught.

   COMPATIBILITY: weeks 1-3 keep every item and checkpoint id
   byte-identical to the 3-week course. The user has practice logs and
   ticked checkpoints stored against these ids; renaming one orphans
   that history silently.

   Item link shapes (rendered by app-theory's renderPractice):
     link:  { label, spec:{ tab, ... } }          deep link into a Learn tab
     link:  { label, live:'drill'|'songs'|'tuner', preset:{...} }
     link:  { label, href }                       external (Songsterr)

   No dependencies; `BassCourse` in a browser, require()-able in Node.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassCourse = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Each phase names its proof, because "what does done look like" is the
     question a self-taught player has nobody to ask. */
  const PHASES = [
    { n: 1, name: 'Foundations', weeks: [1, 2, 3, 4],
      grades: 'Graded on accuracy: find the notes, play the shapes in order, in time.' },
    { n: 2, name: 'Repertoire', weeks: [5, 6, 7, 8],
      grades: 'Graded on songs banked: every week adds songs and steals the keys they need.' },
    { n: 3, name: 'Performance', weeks: [9, 10, 11, 12],
      grades: 'Graded on gig-readiness: full tempo, from memory, in a set. Evenings honestly run up to 40 minutes.' },
  ];

  /* Which week each song root is first TAUGHT (not merely visible on the
     neck). The course invariant "no song before its roots" is checked against
     this map — it is the gap analysis that the 3-week course never had. */
  const ROOT_WEEKS = { E: 1, A: 1, D: 2, G: 2, C: 4, B: 8 };

  const WEEKS = [
    { n: 1, title: 'Hands, fretboard & first notes',
      goal: 'Get your hands working and learn where the notes are on E and A.',
      items: [
        // `tune:true` is what markTuned() looks for, so the Tuner can tick this
        // off without the Live half needing to know any item id.
        { id: 'w1t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Play each open string and match it to the green zone. An out-of-tune bass makes everything below sound wrong — and teaches your ear the wrong thing.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w1a', diagram: 'chromatic', cat: 'Warm-up', min: 5,
          text: 'Chromatic 1-2-3-4: one finger per fret, up every string and back. Slow and clean beats fast and sloppy.', met: 60 },
        { id: 'w1b', cat: 'Fretboard', min: 5,
          text: 'Note names on the E and A strings, frets 0–5. Study first, then try a few rounds of "Find the note".',
          link: { label: 'Open the Note quiz (E+A, 0–5)', spec: { tab: 'trainer', trainer: { tier: 0, mode: 'study', focus: null, study: { show: true, strings: ['E', 'A'], naturalsOnly: true, maxFret: 5 } } } } },
        { id: 'w1c', diagram: 'floatingThumb', cat: 'Technique', min: 8,
          text: 'Alternate index and middle on the open E, one note per click. Rest your thumb on the B string so it stays silent.', met: 60 },
        { id: 'w1d', diagram: 'plucking', cat: 'Music', min: 10,
          text: 'Groove on one note: open E, one note per click, every note dead on the beat. Boring is the point — that steady pulse is the TNT verse.', met: 60 },
      ],
      checkpoints: [
        { id: 'w1cp0', text: 'Chromatic warmup is clean at 60 bpm (no buzzes, one finger per fret)' },
        { id: 'w1cp1', text: 'I can name any note on E or A, frets 0–5, in under 2 seconds (check "seconds per answer" under Your progress, on the Note quiz tab)' },
        { id: 'w1cp2', text: 'My thumb mutes the B string without me thinking about it' },
      ],
      theory: ['fretHalfStep', 'bcef'] },

    { n: 2, title: 'Eighth notes + E minor pentatonic',
      goal: 'Lock in eighth notes and memorize the most important scale in rock.',
      items: [
        // Weeks 2 and 3 used to DROP the tune-up after week 1 had taught that an
        // out-of-tune bass "teaches your ear the wrong thing" — the habit lapsed
        // the week after it was argued for. markTuned() finds these by `tune`.
        { id: 'w2t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Each open string into the green zone before the scale work — this week is your ear learning E minor pentatonic, and an out-of-tune bass teaches it the wrong thing.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w2a', diagram: 'chromatic', cat: 'Warm-up', min: 5,
          text: 'Chromatic 1-2-3-4 on all strings. Push to 65 bpm if yesterday was clean.', met: 65 },
        { id: 'w2b', cat: 'Scales', min: 5,
          text: 'E minor pentatonic, open position: E G A B D. Play it up and down slowly until your fingers know it in both directions. Use "Play scale" to check yourself.',
          link: { label: 'Open E minor pentatonic', spec: { tab: 'scales', scales: { root: 'E', type: 'minPent', view: 'open', labels: 'names' } } },
          // The preset makes the link land CONFIGURED: without it, Drills opens on
          // whatever the picker last showed, which is only this shape by luck.
          link2: { label: 'Then check it in Drills', live: 'drill',
                   preset: { drill: { type: 'scale', scaleKey: 'minPent', rootPc: 4, from: 0 } } } },
        { id: 'w2c', diagram: 'eighthNotes', cat: 'Technique', min: 10,
          text: 'Eighth notes on the open E: two notes per click, strict index-middle alternation. Every 4 beats, switch to another pentatonic note without breaking the rhythm.', met: 65 },
        { id: 'w2d', cat: 'Music', min: 10,
          text: 'Loop E → G → A, eighth notes, 4 beats each. Smooth switches matter more than speed.', met: 65 },
        { id: 'w2e', cat: 'Bonus', min: 3,
          text: 'Note quiz: "Find the note" on E + A naturals. Use the "E only" drill button to bank 20 E-string answers at 90%+.',
          link: { label: 'Find the note (tier 1)', spec: { tab: 'trainer', trainer: { tier: 0, mode: 'find', focus: null } } } },
      ],
      checkpoints: [
        { id: 'w2cp0', text: '2 minutes of clean, even eighth notes at 70 bpm' },
        { id: 'w2cp1', text: 'E minor pentatonic memorized, up AND down, without looking' },
        { id: 'w2cp2', text: 'Over 90% on my last 20 E-string answers (see "Accuracy by string" under Your progress, on the Note quiz tab)' },
      ],
      theory: ['rootsJob', 'octave'] },

    { n: 3, title: 'First song: T.N.T.',
      goal: 'Everything so far becomes a real AC/DC song.',
      items: [
        // Same reason as w2t: the tune-up must not lapse the week a real song lands.
        { id: 'w3t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Each open string into the green zone before the song — T.N.T. is the week\'s payoff, and an out-of-tune bass teaches your ear the wrong thing while you play it.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w3a', cat: 'Warm-up', min: 5,
          text: 'Chromatic warmup at 70 bpm, or E minor pentatonic up and down twice.', met: 70 },
        { id: 'w3b', cat: 'Scales', min: 5,
          text: 'The MOVEABLE pentatonic box. On your 5-string, the root E sits on the B string at fret 5 — the box anchors there. Same note recipe as the open position, packed into one closed shape with no open strings, so you can slide it anywhere.',
          link: { label: 'Open the moveable box', spec: { tab: 'scales', scales: { root: 'E', type: 'minPent', view: 'box', labels: 'names' } } },
          // from:5 is the E-root box boxOptions() offers (B string, fret 5). Without
          // the preset this link opened the picker on the OPEN position — a
          // different shape from the one the item just taught.
          link2: { label: 'Then check it in Drills', live: 'drill',
                   preset: { drill: { type: 'scale', scaleKey: 'minPent', rootPc: 4, from: 5 } } } },
        { id: 'w3c', diagram: 'tntRoots', cat: 'Technique', min: 10,
          text: 'TNT chorus moves: roots E → A → G as eighth notes, 4 beats each. All three live in E minor pentatonic.', met: 70 },
        { id: 'w3d', cat: 'Music', min: 10,
          text: 'T.N.T.: verse = steady eighth notes on E (palm-relaxed, locked to click). Chorus = the E→A→G shifts. Loop verse → chorus. Full speed is ~126 bpm — start at 70 and work up.',
          link: { label: 'TNT tab — mute the bass track, slow it down ↗', href: 'https://www.songsterr.com/a/wsa/acdc-tnt-bass-tab-s407' },
          // The song preset scrolls to and highlights T.N.T.: this link used to
          // land at the top of the list, on Back in Black.
          link2: { label: 'Then let the app listen while you play it', live: 'songs',
                   preset: { song: 'tnt' } } },
        { id: 'w3e', cat: 'Bonus', min: 3,
          text: 'Note quiz: "Find the note" focused on the A string only. Get your last 20 answers above 90%.',
          link: { label: 'Find the note (A string)', spec: { tab: 'trainer', trainer: { tier: 1, mode: 'find', focus: ['A'] } } } },
      ],
      checkpoints: [
        { id: 'w3cp0', text: 'TNT verse + chorus at full speed, locked to the beat' },
        { id: 'w3cp1', text: 'Moveable box shape playable from fret 5 without looking at a diagram' },
        { id: 'w3cp2', text: 'Over 90% on my last 20 A-string answers (see "Accuracy by string" under Your progress, on the Note quiz tab)' },
      ],
      theory: ['relative'] },

    /* ---------------- week 4: the Foundations finale ----------------
       C is the gap the 3-week course shipped: You Shook Me All Night Long was
       already in the book, its chorus lives on C, and no week ever taught C.
       This week exists to close exactly that hole. */
    { n: 4, title: 'The fourth root: C',
      goal: 'The note You Shook Me has been waiting for — C joins E, A, D and G, and the song gets played whole.',
      items: [
        { id: 'w4t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Each open string into the green zone first — this week adds a fourth root, and a C learned against a slack A string is the wrong C.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w4a', cat: 'Fretboard', min: 6,
          text: 'C on the neck. Home base is <b>A-string fret 3</b> — the same shape as the G you know at E-string fret 3, one string over — and it lives again at <b>E-string fret 8</b>. Find it until it is boring.',
          link: { label: 'Find the note (E + A strings)', spec: { tab: 'trainer', trainer: { tier: 1, mode: 'find', focus: null } } } },
        { id: 'w4b', cat: 'Drills', min: 6,
          text: 'Slide the moveable box to C: anchor it at A-string fret 3 and the week-3 shape plays C minor pentatonic — same recipe, new root. Play it in order until the drill stops complaining.',
          link: { label: 'Drill the C box', live: 'drill',
                  preset: { drill: { type: 'scale', scaleKey: 'minPent', rootPc: 0, from: 3 } } } },
        { id: 'w4c', cat: 'Music', min: 12,
          text: 'You Shook Me All Night Long, the <b>whole roadmap</b> with the app\'s click: G, C and D — the C is why this song waited until now. Full speed is ~127 bpm; start slower in the tab player and work up. (Weeks 1–3 consolidate themselves: whatever review is due shows up first on this list.)',
          link: { label: 'YSMANL tab — mute the bass track ↗', href: 'https://www.songsterr.com/a/wsa/acdc-you-shook-me-all-night-long-bass-tab-s446' },
          link2: { label: 'Then let the app listen', live: 'songs', preset: { song: 'ysmanl' } } },
      ],
      checkpoints: [
        { id: 'w4cp0', text: 'I can name C anywhere on the E or A string in under 2 seconds (Note quiz, "Find the note")' },
        { id: 'w4cp1', text: 'You Shook Me All Night Long: whole roadmap with the app\'s click at 80%+ on the root' },
      ],
      theory: [] },

    /* ---------------- phase 2: Repertoire ---------------- */
    { n: 5, title: 'Two songs live here now',
      goal: 'The set starts here: Back in Black and Highway to Hell join the book, and the rhythm drill starts grading what the songs never could.',
      items: [
        { id: 'w5t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Two songs land this week and both get learned as much by ear as by eye — feed that ear in-tune notes.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w5a', cat: 'Warm-up', min: 5,
          text: 'Chromatic 1-2-3-4 at 75 bpm, or last week\'s C box up and down twice.', met: 75 },
        { id: 'w5b', cat: 'Music', min: 10,
          text: 'Back in Black — the slowest song in the book, which is the trap: landing E, D and A dead ON the beat at 92 is harder than it sounds, because there is nowhere to hide between the hits.',
          link: { label: 'Back in Black tab ↗', href: 'https://www.songsterr.com/a/wsa/acdc-back-in-black-bass-tab-s449' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'bib' } } },
        { id: 'w5c', cat: 'Music', min: 10,
          text: 'Highway to Hell — three roots and a rhythm that never changes. Week 3 drilled these exact moves; now they are a song in your set.',
          link: { label: 'Highway to Hell tab ↗', href: 'https://www.songsterr.com/a/wsa/acdc-highway-to-hell-bass-tab-s448' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'hth' } } },
        { id: 'w5d', cat: 'Rhythm', min: 8,
          text: 'First <b>rhythm drill</b>: straight eighth notes on E, 8 bars at 92 with the click. A live set is mostly this — sustaining one rhythm without drifting — and the drill click can grade it, which the songs\' tap clock honestly cannot.',
          link: { label: 'Run the rhythm drill', live: 'drill',
                  preset: { drill: { type: 'rhythm', pattern: 'eighths', rootPc: 4, bars: 8, bpm: 92 } } } },
      ],
      checkpoints: [
        { id: 'w5cp0', text: 'Back in Black: whole roadmap with the app\'s click at 85%+ on the root' },
        { id: 'w5cp1', text: 'Highway to Hell: whole roadmap at 85%+ on the root' },
        { id: 'w5cp2', text: '8 bars of straight eighths on E, clean and in time at 92 (the rhythm drill\'s verdict says so)' },
      ],
      theory: [] },

    { n: 6, title: 'Four roots in one song',
      goal: 'Dirty Deeds joins, and Have a Drink on Me makes C earn its keep — four roots on one map.',
      items: [
        { id: 'w6t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. A four-root map punishes a slack string twice as often — every open string into the green before anything else.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w6a', cat: 'Warm-up', min: 5,
          text: 'Straight eighths on A, 8 bars at 100 — last week\'s rhythm drill, one string over and a notch faster.',
          link: { label: 'Run the rhythm drill', live: 'drill',
                  preset: { drill: { type: 'rhythm', pattern: 'eighths', rootPc: 9, bars: 8, bpm: 100 } } } },
        { id: 'w6b', cat: 'Music', min: 10,
          text: 'Dirty Deeds Done Dirt Cheap — the same A, G and D as Highway, moved around. Prove you can hear a section change coming before it arrives.',
          link: { label: 'Dirty Deeds tab ↗', href: 'https://www.songsterr.com/a/wsa/acdc-dirty-deeds-done-dirt-cheap-bass-tab-s447' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'dd' } } },
        { id: 'w6c', cat: 'Music', min: 10,
          text: 'Have a Drink on Me — the verse walks A, G and D like Highway, then the chorus adds C. Four roots is a longer map than anything so far: hold all of it.',
          link: { label: 'Have a Drink on Me tab ↗', href: 'https://www.songsterr.com/a/wsa/ac-dc-have-a-drink-on-me-bass-tab-s23714' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'hadom' } } },
        { id: 'w6d', cat: 'Rhythm', min: 8,
          text: 'Eighths <b>with a push</b>: skip the hit on beat 4 and land the and-of-4 instead, leaning into the next bar. The push is the most AC/DC move there is. 8 bars at 100.',
          link: { label: 'Run the rhythm drill', live: 'drill',
                  preset: { drill: { type: 'rhythm', pattern: 'push', rootPc: 4, bars: 8, bpm: 100 } } } },
      ],
      checkpoints: [
        { id: 'w6cp0', text: 'Dirty Deeds: whole roadmap at 85%+ on the root' },
        { id: 'w6cp1', text: 'Have a Drink on Me: whole roadmap at 85%+ on the root' },
        { id: 'w6cp2', text: 'Back in Black and Highway to Hell each revisited once this week — two-week-old songs rot without it' },
      ],
      theory: [] },

    { n: 7, title: 'Play it with your eyes closed',
      goal: 'Hells Bells brings the A-minor colour and a long tacet intro; your first two songs go from memory.',
      items: [
        { id: 'w7t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Playing from memory means trusting your hands — give them an in-tune neck to trust.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w7a', cat: 'Music', min: 10,
          text: 'Hells Bells — slow, A minor, and a <b>long tacet intro</b>: you stand silent while the bell rings, then enter on cue. Entering on cue is a real live skill — a band will forgive a thin note long before a missed entry — and this is the song that teaches it.',
          link: { label: 'Hells Bells tab ↗', href: 'https://www.songsterr.com/a/wsa/ac-dc-hells-bells-bass-tab-s205' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'hb' } } },
        { id: 'w7b', cat: 'Rhythm', min: 5,
          text: 'Rest-then-drive: two beats of silence, then eighths, every bar — 8 bars at 92. Counting through silence and entering on cue is the Hells Bells intro, made drillable.',
          link: { label: 'Run the rhythm drill', live: 'drill',
                  preset: { drill: { type: 'rhythm', pattern: 'restdrive', rootPc: 9, bars: 8, bpm: 92 } } } },
        { id: 'w7c', cat: 'Memory', min: 8,
          text: 'Back in Black <b>from memory</b>: arm the song with the app\'s click and flip the toggle to "From memory" — no roots, no neck, no warnings, just the count. A full play at 90%+ banks a memory day; two separate days is gig-ready.',
          link: { label: 'Play it from memory', live: 'songs', preset: { song: 'bib' } } },
        { id: 'w7d', cat: 'Memory', min: 8,
          text: 'Highway to Hell from memory — same deal. Two songs you can play with your eyes closed is the start of a set you can gig.',
          link: { label: 'Play it from memory', live: 'songs', preset: { song: 'hth' } } },
      ],
      checkpoints: [
        { id: 'w7cp0', text: 'Hells Bells: whole roadmap (shown) at 85%+ on the root' },
        { id: 'w7cp1', text: 'Back in Black from memory at 90%+' },
        { id: 'w7cp2', text: 'Highway to Hell from memory at 90%+' },
      ],
      theory: [] },

    { n: 8, title: 'The root with no open string',
      goal: 'B — A-string fret 2, and the moveable box slid to fret 7. Thunderstruck pedals on it for minutes.',
      items: [
        { id: 'w8t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. B has no open string to check yourself against, so the strings around it have to be right.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w8a', cat: 'Fretboard', min: 6,
          text: 'B — the first root with <b>no open string anywhere</b>. Home base is <b>A-string fret 2</b>; and the week-3 moveable box slides here too: anchored at <b>E-string fret 7</b> it plays B minor pentatonic. Same box as G at fret 3 and A at fret 5 — two frets up again.',
          link: { label: 'Find the note (E + A, 0–5)', spec: { tab: 'trainer', trainer: { tier: 0, mode: 'find', focus: null } } },
          link2: { label: 'Drill the B box at fret 7', live: 'drill',
                   preset: { drill: { type: 'scale', scaleKey: 'minPent', rootPc: 11, from: 7 } } } },
        { id: 'w8b', cat: 'Music', min: 10,
          text: 'Thunderstruck — one root, B, for minutes at a time. No open string to lean on, so the fretting hand finally earns its keep: keep the fretted B ringing evenly while the picking hand sprints.',
          link: { label: 'Thunderstruck tab ↗', href: 'https://www.songsterr.com/a/wsa/ac-dc-thunderstruck-bass-tab-s1352' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'ts' } } },
        { id: 'w8c', cat: 'Music', min: 9,
          text: 'Girls Got Rhythm, begun — 138 bpm of pure eighth-note stamina on roots you already own. It will not be comfortable this week; it is not supposed to be. Check the chorus root order against the tab before you gig it.',
          link: { label: 'Girls Got Rhythm tab ↗', href: 'https://www.songsterr.com/a/wsa/ac-dc-girls-got-rhythm-bass-tab-s24083' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'ggr' } } },
        { id: 'w8d', cat: 'Rhythm', min: 8,
          text: 'Straight eighths on B, 8 bars at 110 — stamina where there is no open string to rest on.',
          link: { label: 'Run the rhythm drill', live: 'drill',
                  preset: { drill: { type: 'rhythm', pattern: 'eighths', rootPc: 11, bars: 8, bpm: 110 } } } },
      ],
      checkpoints: [
        { id: 'w8cp0', text: 'I can name B (A-string fret 2, E-string fret 7) in under 2 seconds' },
        { id: 'w8cp1', text: 'Thunderstruck: whole roadmap at 85%+ on the root' },
      ],
      theory: [] },

    /* ---------------- phase 3: Performance ----------------
       Evenings honestly run up to 40 minutes from here: a ten-song set does
       not maintain itself in 30, and pretending otherwise just moves the
       overrun somewhere unplanned. The week header says so too. */
    { n: 9, title: 'The whole set exists',
      goal: 'Shoot to Thrill completes the ten. Every roadmap gets played this week — the set exists; now it firms up.',
      items: [
        { id: 'w9t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Every night this month starts here — a set is only as tight as its slackest string.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w9a', cat: 'Music', min: 10,
          text: 'Shoot to Thrill — 141 bpm, the sprint. Dirty Deeds\' A, G and D moves at full tilt, plus the breakdown: go quiet without slowing down.',
          link: { label: 'Shoot to Thrill tab ↗', href: 'https://www.songsterr.com/a/wsa/ac-dc-shoot-to-thrill-bass-tab-s569' },
          link2: { label: 'Let the app listen', live: 'songs', preset: { song: 'stt' } } },
        { id: 'w9b', cat: 'Songs', min: 18,
          text: 'Play <b>every one of the ten roadmaps</b> at least once this week — two or three a night. The set board on this tab keeps the score; the songs you avoid are the ones that need it.',
          link: { label: 'Open Songs', live: 'songs' } },
        { id: 'w9c', cat: 'Rhythm', min: 10,
          text: 'Rhythm endurance: straight eighths, <b>16 bars at 130+</b>. Girls Got Rhythm is three minutes of exactly this.',
          link: { label: 'Run the endurance drill', live: 'drill',
                  preset: { drill: { type: 'rhythm', pattern: 'eighths', rootPc: 9, bars: 16, bpm: 130 } } } },
      ],
      checkpoints: [
        { id: 'w9cp0', text: 'Shoot to Thrill: whole roadmap at 85%+ on the root' },
        { id: 'w9cp1', text: 'All ten roadmaps played at least once this week' },
      ],
      theory: [] },

    { n: 10, title: 'From memory',
      goal: 'Every song from memory at full tempo at least once, at 90%+. The weakest three get the repeats.',
      items: [
        { id: 'w10t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. From-memory playing leans entirely on your hands and ears — do not let a flat string teach them lies all week.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w10a', cat: 'Memory', min: 20,
          text: 'Work the list: every song at <b>90%+ from memory</b>, full tempo, at least once. Two a night gets there; the readiness pills say which songs still owe you a memory day.',
          link: { label: 'Open Songs', live: 'songs' } },
        { id: 'w10b', cat: 'Music', min: 15,
          text: 'The weakest three get the repeats — the set board names them: lowest scores, fewest memory days. Roadmap on, find what is actually going wrong, then memory again.',
          link: { label: 'Open Songs', live: 'songs' } },
      ],
      checkpoints: [
        { id: 'w10cp0', text: '10 of 10 songs have a full memory-mode play banked at 90%+' },
      ],
      theory: [] },

    { n: 11, title: 'Sets, not songs',
      goal: 'Songs back to back: 3–4 song sets with the click, attention on the transitions — new key, count-in, go.',
      items: [
        { id: 'w11t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. There is no re-tuning between songs in a set — get it right before the first count-in.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w11a', cat: 'Set', min: 18,
          text: 'Build a 3–4 song set (the <b>Setlist</b> card on the Songs tab) and run it with the click. The 8-beat gap between songs IS the exercise — new key, count-in, go — and the verdict watches exactly those entries.',
          link: { label: 'Open the Setlist card', live: 'songs' } },
        { id: 'w11b', cat: 'Set', min: 15,
          text: 'A second set run, different songs or different order — "weakest first" makes the hard entries come while you are fresh.',
          link: { label: 'Open the Setlist card', live: 'songs' } },
        { id: 'w11c', cat: 'Review', min: 5,
          text: 'Whichever entry you missed in the set runs, play that song\'s opening section on its own until the entry is boring.',
          link: { label: 'Open Songs', live: 'songs' } },
      ],
      checkpoints: [
        { id: 'w11cp0', text: 'A set run of 3+ songs banked at 85%+ overall' },
        { id: 'w11cp1', text: 'A second set run of 3+ songs banked at 85%+ overall' },
      ],
      theory: [] },

    { n: 12, title: 'Gig week',
      goal: 'All ten gig-ready, one full set of 4+, and the report that plans set two.',
      items: [
        { id: 'w12t', cat: 'First', min: 2, tune: true,
          text: 'Tune up. Gig week: tuning first is the habit that has to survive contact with a stage.',
          link: { label: 'Open the tuner', live: 'tuner' } },
        { id: 'w12a', cat: 'Music', min: 13,
          text: 'Close the gaps: every song to <b>gig-ready</b> — two separate days each with a 90%+ memory play. The pills say which songs still owe a day.',
          link: { label: 'Open Songs', live: 'songs' } },
        { id: 'w12b', cat: 'Set', min: 20,
          text: 'The dress rehearsal: one setlist run of <b>4+ songs</b> with the click, from memory if you dare. Bank it.',
          link: { label: 'Open the Setlist card', live: 'songs' } },
        { id: 'w12c', cat: 'Report', min: 5,
          text: 'Tick the last checkpoint below and the <b>gig-readiness report</b> appears at the bottom of this tab: song by song against the bar, the weakest named, and a block to paste to Claude for the set-two program.' },
      ],
      checkpoints: [
        { id: 'w12cp0', text: 'All 10 songs are gig-ready: two separate days each with a 90%+ memory play' },
        { id: 'w12cp1', text: 'A set run of 4+ songs is banked' },
        { id: 'w12cp2', text: 'Course complete — ticking this generates the gig-readiness report below' },
      ],
      theory: [] },
  ];

  function weekOf(n) { return WEEKS.find(w => w.n === n); }
  function phaseOf(n) { return PHASES.find(p => p.weeks.indexOf(n) >= 0); }

  /** Every root taught by the end of week n — the "no song before its roots"
      invariant reads this, so it is the single source of when a key exists. */
  function rootsIntroducedBy(n) {
    return Object.keys(ROOT_WEEKS).filter(r => ROOT_WEEKS[r] <= n);
  }

  /** Song ids week n points a play-along preset at, in item order. */
  function songsScheduledIn(n) {
    const w = weekOf(n);
    if (!w) return [];
    const out = [];
    for (const it of w.items) {
      for (const key of ['link', 'link2', 'link3']) {
        const ln = it[key];
        if (ln && ln.preset && ln.preset.song && out.indexOf(ln.preset.song) < 0) {
          out.push(ln.preset.song);
        }
      }
    }
    return out;
  }

  return { PHASES, WEEKS, ROOT_WEEKS, weekOf, phaseOf, rootsIntroducedBy, songsScheduledIn };
});
