/* ============================================================
   Drill engine — the pedagogy, as code.

   Design decisions here follow an evidence review rather than
   instinct, and the comments say which parts rest on solid ground
   and which are defaults to be tuned:

   - Sequences are generated per direction and can be windowed onto
     the MIDDLE, because errors cluster away from a phrase's
     boundaries (serial-position effects in music performance).
   - Contextual interference RAMPS: blocked while an item is new,
     then serial, then random. Learners prefer blocked and over-rate
     it, so the schedule is not theirs to choose. (The CI effect is
     ~3x smaller in applied settings than in the lab, so the
     thresholds are config, not truth.)
   - Feedback is terminal, not concurrent — a live wrong-note buzzer
     is the design the motor-learning literature warns against.
   - Review is day-scale (Leitner). Minute-scale spacing has a
     direct null result in piano learning, so there is none here.
   - Mastery is measured on a COLD first attempt across two days,
     because in-session fluency is exactly what massed practice and
     live feedback inflate.

   No dependencies; require()-able in Node, `BassDrill` in a browser.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassDrill = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEGREES = { 0:'R', 1:'b2', 2:'2', 3:'b3', 4:'3', 5:'4', 6:'b5', 7:'5', 8:'b6', 9:'6', 10:'b7', 11:'7' };
  const pc = (n) => ((n % 12) + 12) % 12;

  /**
   * Build the ordered list of targets for one octave of a scale inside a
   * fret window.
   *
   * For each pitch we pick the LOWEST FRET occurrence (tie-broken by lowest
   * string), which is what produces the fingering a teacher would write:
   * open strings in open position, and one note per finger in a box higher up.
   *
   * @returns {{si:number, fret:number, midi:number, degree:string}[]}
   */
  function sequence(spec) {
    const { tuning, intervals, rootPc, direction } = spec;
    const fromFret = spec.fromFret || 0;
    const toFret = spec.toFret != null ? spec.toFret : 12;
    const pcs = intervals.map(i => pc(rootPc + i));

    // every playable position in the window that belongs to the scale
    const all = [];
    for (let si = 0; si < tuning.midi.length; si++) {
      for (let f = fromFret; f <= toFret; f++) {
        const midi = tuning.midi[si] + f;
        if (pcs.indexOf(pc(midi)) >= 0) all.push({ si, fret: f, midi });
      }
    }
    if (!all.length) return [];

    // one position per pitch: prefer the lowest fret, then the lowest string
    const byPitch = new Map();
    for (const p of all) {
      const cur = byPitch.get(p.midi);
      if (!cur || p.fret < cur.fret || (p.fret === cur.fret && p.si < cur.si)) byPitch.set(p.midi, p);
    }
    const rising = [...byPitch.values()].sort((a, b) => a.midi - b.midi);

    // one octave upward from the lowest root available
    const first = rising.findIndex(p => pc(p.midi) === rootPc);
    if (first < 0) return [];
    const start = rising[first].midi;
    const octave = rising.filter(p => p.midi >= start && p.midi <= start + 12);

    const out = octave.map(p => ({
      si: p.si, fret: p.fret, midi: p.midi,
      degree: DEGREES[pc(p.midi - rootPc)],
    }));
    return direction === 'down' ? out.slice().reverse() : out;
  }

  /**
   * The middle `size` targets of a sequence. Beginnings and ends of a
   * sequence are learned first; the middle is what needs over-sampling.
   */
  function middleWindow(targets, size) {
    if (targets.length <= size) return targets.slice();
    const start = Math.floor((targets.length - size) / 2);
    return targets.slice(start, start + size);
  }

  /**
   * Judge one attempt at a sequence.
   *
   * Feedback is TERMINAL: this reports progress (which note you are on) but
   * the diagnosis comes from result(). A wrong note halts the run rather
   * than letting the player carry on through an unresolved error.
   */
  function createRun(targets) {
    let i = 0, halted = false, error = null;
    const notes = [];
    let firstAt = null;

    return {
      expected() { return targets[i] || null; },
      index() { return i; },
      /** @param midi detected note, @param atMs time of the note */
      push(midi, atMs) {
        if (halted || i >= targets.length) return { status: 'halted', index: i };
        const want = targets[i];
        if (midi === want.midi) {
          if (firstAt === null) firstAt = atMs;
          notes.push({ midi, at: atMs - firstAt, target: want });
          i++;
          return i >= targets.length
            ? { status: 'done', index: i }
            : { status: 'advanced', index: i };
        }
        halted = true;
        error = {
          status: 'error', index: i, expected: want, played: midi,
          // An octave slip is a different lesson from a wrong note, so the
          // engine names it separately and the UI can teach accordingly.
          reason: pc(midi) === pc(want.midi) ? 'wrong-octave' : 'wrong-note',
        };
        return error;
      },
      result() {
        return {
          passed: i >= targets.length && !halted,
          errorIndex: error ? error.index : null,
          reason: error ? error.reason : null,
          notes,
          elapsedMs: notes.length ? notes[notes.length - 1].at : 0,
          total: targets.length,
        };
      },
    };
  }

  /**
   * A short contiguous span of the sequence containing the missed note, for
   * repairing the failing segment before re-running the whole thing.
   */
  function errorWindow(targets, index, size) {
    const n = size || 4;
    if (targets.length <= n) return targets.slice();
    let start = Math.max(0, Math.min(index - Math.floor((n - 1) / 2), targets.length - n));
    return targets.slice(start, start + n);
  }

  /* ---- contextual interference ramp ----
     Blocked -> serial -> random. Learners prefer blocked practice and
     over-rate how well it is working, so this is not theirs to choose.
     The CI effect is much smaller in applied settings than in the lab, so
     treat the rung thresholds as tunable rather than settled. */
  const CI_RUNGS = ['blocked', 'serial', 'random'];
  function nextCI(state, passed) {
    const i = Math.max(0, CI_RUNGS.indexOf(state));
    const j = passed ? Math.min(CI_RUNGS.length - 1, i + 1) : Math.max(0, i - 1);
    return CI_RUNGS[j];
  }

  /* ---- tempo gate ----
     Two consecutive clean reps, where "clean" means the right notes in the
     right order AND onsets inside tolerance. The step is a percentage so it
     scales: +5 bpm is an 8% jump at 60 and 4% at 120. The constants below
     are practitioner practice, not evidence — no trial establishes them. */
  const TEMPO_STEP = 0.08, TEMPO_REPS = 2;
  function tempoGate(history, bpm, opts) {
    const need = (opts && opts.reps) || TEMPO_REPS;
    const step = (opts && opts.step) || TEMPO_STEP;
    const recent = history.slice(-need);
    const clean = recent.length === need && recent.every(r => r.passed && r.timingOk);
    return {
      advance: clean,
      nextBpm: clean ? Math.round(bpm * (1 + step)) : bpm,
      cleanReps: recent.filter(r => r.passed && r.timingOk).length,
      need,
    };
  }

  /* ---- Leitner review ----
     Day-scale only. Minute-scale spacing has a direct null result in piano
     learning, so there is deliberately no intra-session spacing logic. A new
     item always comes back tomorrow, because the overnight interval is the
     one with music-specific evidence behind it. */
  const BOX_DAYS = [1, 3, 7, 16, 35];
  function addDays(iso, days) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function schedule(item, passed, todayISO) {
    const box = passed
      ? Math.min(BOX_DAYS.length, (item.box || 0) + 1)
      : Math.max(1, (item.box || 0) - 1);
    const days = passed ? BOX_DAYS[box - 1] : 1;
    return Object.assign({}, item, { box, due: addDays(todayISO, days), lastSeen: todayISO });
  }
  function isDue(item, todayISO) {
    return !item.due || item.due <= todayISO;
  }

  /* ---- mastery ----
     Measured on a COLD first attempt of a session, on two separate days.
     In-session fluency is precisely what massed practice and live feedback
     inflate, so it does not count. The 0.9 bar is imported from
     mastery-learning practice, not from a music study: tune it. */
  const ACCURACY_BAR = 0.9;
  function masteryOf(attempts, opts) {
    const bar = (opts && opts.accuracy) || ACCURACY_BAR;
    if (!attempts || !attempts.length) return 'new';
    const good = attempts.filter(a =>
      a.cold && a.atTargetTempo && a.timingOk && a.accuracy >= bar);
    const days = new Set(good.map(a => a.date));
    return days.size >= 2 ? 'mastered' : 'acquired';
  }

  return {
    sequence, middleWindow, createRun, errorWindow,
    nextCI, tempoGate, schedule, isDue, masteryOf,
    DEGREES, CI_RUNGS, BOX_DAYS,
  };
});
