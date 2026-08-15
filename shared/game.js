/* Bass Trainer — Fret Quest game logic.
   The rules of the Find-it mini game, kept pure so Node can test them:
   difficulty paces, combo/XP/heart arithmetic, the adaptive question
   picker, and the bass-clef staff geometry the reading mode draws.
   Loads in the browser as `BassGame`, and in Node via require().
   No dependencies, no build step — same contract as trainer/core.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassGame = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= paces =================
     The game's second difficulty axis, orthogonal to the neck scope
     (the stage): how much time pressure a question carries. Soundcheck is
     the default and can never end a set — the fuse is a timed-mode idea. */
  const PACES = {
    chill:  { label: 'Soundcheck', detail: 'No fuse, no pressure — find every note at your own pace.',
              approachMs: null,  hearts: null },
    steady: { label: 'Gig',        detail: 'The cannon fuse burns slow. Burnt out = one of your three bolts — your stage lights — goes dark.',
              approachMs: 14000, hearts: 3 },
    turbo:  { label: 'Encore',     detail: 'A short fuse. For those about to rock.',
              approachMs: 7000,  hearts: 3 },
  };
  const PACE_ORDER = ['chill', 'steady', 'turbo'];

  /* What the question shows: the note's name, its position on a bass-clef
     staff (the reading skill), or a per-question coin flip between the two. */
  const PROMPTS = {
    name:  { label: 'Names' },
    staff: { label: 'Sheet music' },
    mix:   { label: 'Mixed' },
  };
  const PROMPT_ORDER = ['name', 'staff', 'mix'];
  function resolvePrompt(mode, rand) {
    if (mode === 'mix') return (rand || Math.random)() < 0.5 ? 'staff' : 'name';
    return mode === 'staff' ? 'staff' : 'name';
  }

  /* ================= XP, combo, levels ================= */
  const XP_PER_LEVEL = 120;
  const LEVEL_TITLES = ['Garage Roadie', 'Pub Rocker', 'Support Act', 'Riff Machine',
                        'Headliner', 'Stadium Shaker', 'Rock Legend', 'Thunderstruck'];
  function levelFor(xp) { return 1 + Math.floor(Math.max(0, xp) / XP_PER_LEVEL); }
  function levelTitle(level) {
    return LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.max(0, level - 1))];
  }
  /** XP still to go inside the current level, for the HUD bar. */
  function levelProgress(xp) {
    const into = Math.max(0, xp) % XP_PER_LEVEL;
    return { into, span: XP_PER_LEVEL, frac: into / XP_PER_LEVEL };
  }

  /** How long the cannon fuse takes to burn down. Higher levels shave a
      little off, floored well above "impossible". */
  function approachMs(pace, level) {
    const p = PACES[pace];
    if (!p || p.approachMs == null) return null;
    const lvl = Math.max(1, level | 0);
    if (pace === 'turbo') return Math.max(4500, p.approachMs - (lvl - 1) * 200);
    return Math.max(10000, p.approachMs - (lvl - 1) * 250);
  }

  /**
   * One run of the game. Tracks hearts, combo, XP and whether the run is
   * over. Judgement kinds:
   *   'clean'   — right note, first attempt
   *   'dirty'   — right note after hunting
   *   'wrong'   — a miss (streak breaks; stage lights are NOT touched —
   *               only the fuse burning out costs one, i.e. 'breach')
   *   'breach'  — the clock ran out: the cannon fuse burnt to nothing
   *   'skip'    — player asked for the next one
   */
  function createRun(opts) {
    const pace = PACES[(opts && opts.pace)] ? opts.pace : 'chill';
    const startXp = (opts && opts.xp) | 0;
    const s = {
      pace,
      hearts: PACES[pace].hearts,      // null = infinite (chill)
      maxHearts: PACES[pace].hearts,
      combo: 0, bestCombo: 0,
      xp: startXp,
      zaps: 0,                          // notes nailed this set
      over: false,
    };
    /** `mult` is an optional XP multiplier (pace × stage × prompt, decided by
        the caller) applied to the gain only — hearts and combo are game
        STATE and never scale. Default 1, so existing callers pay the old rates. */
    function judge(kind, mult) {
      if (s.over) return { ignored: true, over: true, gain: 0, combo: s.combo, hearts: s.hearts };
      const m = (typeof mult === 'number' && mult > 0) ? mult : 1;
      const before = levelFor(s.xp);
      let gain = 0;
      if (kind === 'clean') {
        s.combo++;
        if (s.combo > s.bestCombo) s.bestCombo = s.combo;
        gain = Math.round((10 + 2 * Math.min(s.combo - 1, 15)) * m);
        s.xp += gain; s.zaps++;
      } else if (kind === 'dirty') {
        // The hunt already broke the combo (every wrong is judged first).
        gain = Math.round(4 * m);
        s.xp += gain; s.zaps++;
      } else if (kind === 'wrong') {
        s.combo = 0;
      } else if (kind === 'breach') {
        s.combo = 0;
        if (s.hearts != null) {
          s.hearts = Math.max(0, s.hearts - 1);
          if (s.hearts === 0) s.over = true;
        }
      } else if (kind === 'skip') {
        s.combo = 0;
      }
      const level = levelFor(s.xp);
      return {
        gain, combo: s.combo, hearts: s.hearts, over: s.over,
        level, leveled: level > before,
      };
    }
    return {
      judge,
      get state() { return s; },
    };
  }

  /* ================= adaptive question picker =================
     Memorisation lives or dies on WHICH note comes next. Uniform random
     wastes reps on notes already known; this weights the pool by recent
     performance per fret position:
       - a note you keep missing shows up much more often
       - a note you have never been asked gets a look-in
       - a note you have nailed three times running fades back
       - the note just asked is strongly (not absolutely) avoided
     `view(key)` returns {recent:[0/1...], tries:number} or null — the
     caller owns storage; this owns only the arithmetic. */
  function weightFor(v, isLast) {
    let w = 1;
    if (!v || !v.tries) w += 0.8;                       // never seen: worth a look
    const recent = (v && v.recent) || [];
    if (recent.length) {
      const missRate = 1 - recent.reduce((a, b) => a + b, 0) / recent.length;
      w += 2.5 * missRate;                              // trouble notes come back
      const lastSix = recent.slice(-6);
      const lastThree = recent.slice(-3);
      if (v.tries >= 6 && lastSix.length === 6 && lastSix.every(x => x === 1)) {
        w *= 0.08;                                        // deeper-parked: truly known
      } else if (lastThree.length === 3 && lastThree.every(x => x === 1)) {
        w *= 0.15;                                        // parked
      }
    }
    if (isLast) w *= 0.15;                              // rarely twice in a row
    return w;
  }
  function weightedPick(pool, view, lastKey, rand) {
    if (!pool || !pool.length) return null;
    const r = rand || Math.random;
    const weights = pool.map(item => {
      const key = item.sn + ':' + item.f;
      return weightFor(view ? view(key) : null, pool.length > 1 && key === lastKey);
    });
    let total = 0;
    for (const w of weights) total += w;
    let roll = r() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /* ================= review queue =================
     A missed note must come back SOON — spaced repetition inside one sitting.
     Counting is in QUESTIONS, not time: the caller increments a counter per
     question and asks the queue before rolling the adaptive picker.
       add(key, nowCount)  — schedule a first revisit 3–7 questions out
       next(nowCount, lastKey, has) — the oldest due key (never lastKey,
         never one `has` rejects), or null. Serving the first visit books a
         second ~8–14 questions later; serving that one retires the key. */
  function createReviewQueue(rand) {
    const r = rand || Math.random;
    const items = {};                       // key → { due, stage } stage 0|1
    return {
      add(key, nowCount) {
        if (items[key]) return;             // already booked — keep its slot
        items[key] = { due: (nowCount | 0) + 3 + Math.floor(r() * 5), stage: 0 };
      },
      next(nowCount, lastKey, has) {
        let best = null;
        for (const k in items) {
          if (k === lastKey) continue;                  // never twice in a row
          if (items[k].due > nowCount) continue;        // not due yet
          if (has && !has(k)) continue;                 // not in the pool: skip, keep
          if (!best || items[k].due < items[best].due) best = k;
        }
        if (!best) return null;
        const it = items[best];
        if (it.stage === 0) { it.stage = 1; it.due = (nowCount | 0) + 8 + Math.floor(r() * 7); }
        else delete items[best];
        return best;
      },
      get size() { return Object.keys(items).length; },
    };
  }

  /* ================= bass-clef staff geometry =================
     Bass guitar is written in bass clef an octave ABOVE where it sounds
     (otherwise the low B would live four ledger lines under the staff).
     Positions are diatonic steps from the bottom staff line, written G2:
     0 = bottom line, 1 = bottom space (A2), 2 = second line (B2)…
     8 = top line (A3). Even positions are lines, odd are spaces. */
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  // Sharp spellings, matching BassCore.NAMES: pitch class → [letter, accidental]
  const SPELL = [['C', null], ['C', '#'], ['D', null], ['D', '#'], ['E', null], ['F', null],
                 ['F', '#'], ['G', null], ['G', '#'], ['A', null], ['A', '#'], ['B', null]];
  const G2_DIA = 2 * 7 + LETTERS.indexOf('G');   // diatonic index of the bottom line

  /**
   * Where a SOUNDING midi note sits on the written staff.
   * @returns {{pos:number, letter:string, acc:string|null, octave:number,
   *            ledgers:number[]}} pos as above; ledgers lists the ledger-line
   *           positions (even numbers) the note needs drawn, nearest first.
   */
  function staffSpec(midi) {
    const written = midi + 12;
    const octave = Math.floor(written / 12) - 1;
    const [letter, acc] = SPELL[((written % 12) + 12) % 12];
    const dia = octave * 7 + LETTERS.indexOf(letter);
    const pos = dia - G2_DIA;
    const ledgers = [];
    for (let p = -2; p >= pos; p -= 2) ledgers.push(p);       // below the staff
    for (let p = 10; p <= pos; p += 2) ledgers.push(p);       // above the staff
    return { pos, letter, acc, octave, ledgers };
  }

  return {
    PACES, PACE_ORDER, PROMPTS, PROMPT_ORDER, resolvePrompt,
    XP_PER_LEVEL, LEVEL_TITLES, levelFor, levelTitle, levelProgress, approachMs,
    createRun, weightFor, weightedPick, createReviewQueue, staffSpec,
  };
});
