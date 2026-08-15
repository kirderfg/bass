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
    steady: { label: 'Gig',        detail: 'The cannon fuse burns slow. Burnt out = one of your three stage lights (the ⚡ bolts up top) goes dark. The fuse tightens a touch as you level.',
              approachMs: 14000, hearts: 3 },
    turbo:  { label: 'Encore',     detail: 'A short fuse. For those about to rock. Same three stage lights as Gig — and the fuse tightens a touch as you level.',
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

  /* ================= XP, combo, levels =================
     A rising curve, not a flat rate: level n costs 120 + 40×(n−1) XP, so
     L1→L2 is 120, L2→L3 is 160, L3→L4 is 200… Cumulative XP to REACH level
     n is therefore 20×(n−1)×(n+4): L2 at 120, L3 at 280, L4 at 480. */
  const LEVEL_TITLES = ['Garage Roadie', 'Pub Rocker', 'Support Act', 'Riff Machine',
                        'Headliner', 'Stadium Shaker', 'Rock Legend', 'Thunderstruck'];
  /** How much XP the step from `level` to the next one costs. */
  function levelSpan(level) {
    const n = Math.max(1, level | 0);
    return 120 + 40 * (n - 1);
  }
  /** Total XP needed to have REACHED `level` (level 1 is free). */
  function levelBase(level) {
    const n = Math.max(1, level | 0);
    return 20 * (n - 1) * (n + 4);
  }
  // Kept for compatibility: the first level's span, derived from the curve.
  const XP_PER_LEVEL = levelSpan(1);
  function levelFor(xp) {
    const x = Math.max(0, xp);
    let n = 1;
    while (x >= levelBase(n + 1)) n++;
    return n;
  }
  function levelTitle(level) {
    return LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.max(0, level - 1))];
  }
  /** Where the HUD bar sits inside the CURRENT level's span:
      {into, span, frac} — `span` is what this level's step costs. */
  function levelProgress(xp) {
    const x = Math.max(0, xp);
    const level = levelFor(x);
    const into = x - levelBase(level);
    const span = levelSpan(level);
    return { into, span, frac: into / span };
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
   *   'clean'    — right note, first attempt
   *   'dirty'    — right note after hunting
   *   'assisted' — right note, but the reveal hint SHOWED it: no XP, no zap,
   *                the combo goes, the hearts are untouched — a shown answer
   *                must not feed the arcade score
   *   'wrong'    — a miss (streak breaks; stage lights are NOT touched —
   *                only the fuse burning out costs one, i.e. 'breach')
   *   'breach'   — the clock ran out: the cannon fuse burnt to nothing
   *   'skip'     — player asked for the next one
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
      cleanZaps: 0,                     // first-try, unaided finds — the best-run metric
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
        s.xp += gain; s.zaps++; s.cleanZaps++;
      } else if (kind === 'dirty') {
        // The hunt already broke the combo (every wrong is judged first).
        gain = Math.round(4 * m);
        s.xp += gain; s.zaps++;
      } else if (kind === 'assisted') {
        // A revealed answer: nothing gained, nothing lost but the combo.
        s.combo = 0;
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

  /* ================= fuse-hold budget =================
     Fairness holds on the fuse are bounded PER QUESTION, or they become an
     exploit: a reviewer held a 7-second fuse at 6990ms for 15 seconds by
     spamming wrong notes (each 'no' verdict renewed a 1s freeze), and the
     out-of-tune hold could stall it forever. One budget object per question:
     'wrong' holds cap at ~3s, the out-of-tune hold at ~4s — after that,
     consume() grants nothing and the fuse burns on. */
  function createFuseBudget(caps) {
    const cap = Object.assign({ wrong: 3000, tune: 4000 }, caps);
    const spent = { wrong: 0, tune: 0 };
    return {
      /** Ask to hold the fuse for `ms` more milliseconds of `kind`
          ('wrong' | 'tune'). Returns the ms actually granted. */
      consume(kind, ms) {
        const c = cap[kind] || 0;
        const grant = Math.max(0, Math.min(ms || 0, c - (spent[kind] || 0)));
        spent[kind] = (spent[kind] || 0) + grant;
        return grant;
      },
      /** How much of `kind`'s budget is left. */
      left(kind) { return Math.max(0, (cap[kind] || 0) - (spent[kind] || 0)); },
      get state() { return { wrong: spent.wrong, tune: spent.tune }; },
    };
  }

  /* ================= XP multiplier honesty =================
     The stage premium pays for the SIZE of the neck in play. A focus filter
     (one string, a fret window) shrinks the askable pool, so the premium
     scales by the pool's share of the unfocused stage pool — floored at 0.5
     (focused practice still earns) and capped at 1 (no bonus for filters). */
  function focusMult(poolSize, fullPoolSize) {
    if (!fullPoolSize || !isFinite(fullPoolSize) || fullPoolSize <= 0) return 1;
    return Math.max(0.5, Math.min(1, poolSize / fullPoolSize));
  }

  /* ================= octave counting, in words =================
     A +24-semitone slip is "two octaves", not "an octave" — corrections that
     count wrong tell the player their ear is wrong when it was right. */
  function octaveWords(semis) {
    const n = Math.max(1, Math.round(Math.abs(semis) / 12));
    return n === 1 ? 'an octave' : n === 2 ? 'two octaves'
         : n === 3 ? 'three octaves' : n + ' octaves';
  }

  /* ================= adaptive question picker =================
     Memorisation lives or dies on WHICH note comes next. Uniform random
     wastes reps on notes already known; this weights the pool by recent
     performance per fret position:
       - a note you keep missing shows up much more often
       - a note you have never been asked gets a look-in
       - a note you have nailed three times running fades back
       - the note just asked NEVER repeats back-to-back (weight 0) while the
         pool has anything else to offer; a one-note pool still serves its note
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
    if (isLast) return 0;                               // never twice in a row
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
      if (roll <= 0 && weights[i] > 0) return pool[i];
    }
    // Floating-point fallthrough: return the last item that can be served —
    // never the hard-excluded lastKey.
    for (let i = pool.length - 1; i >= 0; i--) if (weights[i] > 0) return pool[i];
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
  /* Flat spellings of the same five pitch classes: the enharmonic twin sits
     one letter HIGHER (D♭ lives on D's line/space). Reading music means
     meeting both spellings, so staffSpec can be asked to prefer these. */
  const SPELL_FLAT = { 1: ['D', 'b'], 3: ['E', 'b'], 6: ['G', 'b'], 8: ['A', 'b'], 10: ['B', 'b'] };
  const G2_DIA = 2 * 7 + LETTERS.indexOf('G');   // diatonic index of the bottom line

  /**
   * Where a SOUNDING midi note sits on the written staff.
   * @param {{prefer?:'flat'}} [opts] — 'flat' spells the five accidentals as
   *        flats (D♭ on D's position, acc:'b'); naturals are never touched.
   * @returns {{pos:number, letter:string, acc:string|null, octave:number,
   *            ledgers:number[]}} pos as above; ledgers lists the ledger-line
   *           positions (even numbers) the note needs drawn, nearest first.
   */
  function staffSpec(midi, opts) {
    const written = midi + 12;
    const octave = Math.floor(written / 12) - 1;
    const pc = ((written % 12) + 12) % 12;
    let [letter, acc] = SPELL[pc];
    if (opts && opts.prefer === 'flat' && SPELL_FLAT[pc]) [letter, acc] = SPELL_FLAT[pc];
    const dia = octave * 7 + LETTERS.indexOf(letter);
    const pos = dia - G2_DIA;
    const ledgers = [];
    for (let p = -2; p >= pos; p -= 2) ledgers.push(p);       // below the staff
    for (let p = 10; p <= pos; p += 2) ledgers.push(p);       // above the staff
    return { pos, letter, acc, octave, ledgers };
  }

  /* ---- staff positions in words ----
     Non-visual parity for the reading mode: the spoken question names WHERE
     the note sits, never what it is. Positions -5..14; even = line, odd =
     space; the staff proper is 0..8, ledgers live beyond 8 and below 0. */
  const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
  function staffPosName(pos) {
    const p = pos | 0;
    if (p >= 0 && p <= 8) {                                     // on the staff
      const LINES = { 0: 'the bottom line', 2: 'the second line', 4: 'the middle line',
                      6: 'the fourth line', 8: 'the top line' };
      const SPACES = { 1: 'the first space', 3: 'the second space',
                       5: 'the third space', 7: 'the top space' };
      return (p % 2 === 0 ? 'on ' + LINES[p] : 'in ' + SPACES[p]);
    }
    if (p < 0) {                                                // hanging below
      if (p === -1) return 'just below the staff';
      if (p % 2 === 0) {
        const n = (-p) / 2;
        return 'on the ' + (ORDINALS[n - 1] || n + 'th') + ' ledger line below the staff';
      }
      const n = (-p - 1) / 2;
      return 'below the ' + (ORDINALS[n - 1] || n + 'th') + ' ledger line below the staff';
    }
    if (p === 9) return 'just above the staff';                 // riding above
    if (p % 2 === 0) {
      const n = (p - 8) / 2;
      return 'on the ' + (ORDINALS[n - 1] || n + 'th') + ' ledger line above the staff';
    }
    const n = (p - 9) / 2;
    return 'above the ' + (ORDINALS[n - 1] || n + 'th') + ' ledger line above the staff';
  }

  return {
    PACES, PACE_ORDER, PROMPTS, PROMPT_ORDER, resolvePrompt,
    XP_PER_LEVEL, LEVEL_TITLES, levelFor, levelTitle, levelProgress, approachMs,
    createRun, weightFor, weightedPick, createReviewQueue, staffSpec, staffPosName,
    createFuseBudget, octaveWords, focusMult,
  };
});
