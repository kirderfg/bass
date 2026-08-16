/* ==================================================================
   Bass Live Trainer — the Live half of the app: the game (Play), the
   Tuner and Songs. Everything here needs the bass plugged in, so
   everything here waits for the mic to be armed, and the mic is not
   armed until the player asks for one of these modes.

   It carried two more modes until the app was refocused on the game:
   Ear training and the pattern Drills. Both are gone — Drills' job is
   the game's Scales mode, and the roadmap in the mode strip says what
   is coming for the rest.

   Lifted verbatim out of trainer/index.html when the two apps became
   one page. It is wrapped in an IIFE because both apps now share one
   global scope and both declare TUNING, SCALES, NAMES and pcOf —
   textual concatenation would have made one of them win at
   random. The only thing published is window.BassLive, at the bottom.
   ================================================================== */
(function(){
"use strict";
const C = window.BassCore;

/* ================= what the game remembers about YOU =================
   Which positions you fumble, which boxes you fumble, and how recently.
   The adaptive picker reads it and brings weak spots back sooner; the
   note map paints it as the weak-spot overlay.

   This lived in bassTheoryTrainer.v1 while a Note quiz and a practice
   plan read the same numbers off it — accuracy, streaks, per-day counts,
   an ear-training tally. None of those screens exist any more, so the
   store is the game's alone and carries only the three things the game
   actually consults. */
const LS_KEY = 'bassTrainer.gamemem.v1';
function loadShared(){
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ return {}; }
}
function saveStats(mutate){
  const st = loadShared();
  st.stats = Object.assign({ heat:{}, noteRecent:{}, scaleRecent:{}, scaleHeat:{} }, st.stats);
  mutate(st.stats);
  try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch(e){}
}

const TUNING = { midi:[23,28,33,38,43], names:['B','E','A','D','G'] };
const NATURALS = new Set(['C','D','E','F','G','A','B']);
const pcOf = (midi) => ((midi % 12) + 12) % 12;
/** Today, in the player's OWN timezone — toISOString() is UTC, which rolls the
    date over mid-evening for anyone east of Greenwich. Songs date their plays
    with it. */
function todayISO(){
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
}
const TIERS = [
  { label:'1 · E + A strings, frets 0–5', strings:['E','A'], maxFret:5, accidentals:false },
  { label:'2 · E + A strings, frets 0–12', strings:['E','A'], maxFret:12, accidentals:false },
  { label:'3 · add D + G strings', strings:['E','A','D','G'], maxFret:12, accidentals:false },
  { label:'4 · add the low B string', strings:['B','E','A','D','G'], maxFret:12, accidentals:false },
  { label:'5 · everything + sharps', strings:['B','E','A','D','G'], maxFret:12, accidentals:true }
];
// How much neck the Notes game asks about. It used to be shared with the
// Theory Trainer's quiz — reaching tier 3 there started you at tier 3
// here — and with that quiz retired it is the game's own setting, kept in
// the game's own store beside the pace and the prompt mode.
let tier = 0;
let focus = null, mode = 'tuner';
function persistTier(){ gvSave(); }

/* ================= audio ================= */
const A = { ctx:null, analyser:null, stream:null, buf:null, timer:null, rate:44100, level:0, muteUntil:0 };
const DECIMATE = 4;
/* The tracker's settle time. The game's entry grace leans on it: a stable
   reading fires this long after its note's attack, so "did this note begin
   before the grace ended?" is answerable from the stable's own timestamp. */
const TRACKER_STABLE_MS = 150;
let tracker = C.createTracker({ stableMs:TRACKER_STABLE_MS });
/* Readings used to decide whether the INSTRUMENT is out of tune: {cents, name}
   per reading, so the warning can tell one flat string from a flat bass. */
let centsHistory = [];
/* How far a reading may sit from an open string and still be taken AS that open
   string being tuned. A fret's worth is 100 cents, so 60 keeps genuinely slack
   open strings in and keeps fretted notes (>=100 cents away) out. */
const DRIFT_MAX_CENTS = 60;

/* Has the mic ever been granted? Once it has, no Live mode ever gates again:
   the stream and the AudioContext are kept alive across tab switches so that
   coming back from a Learn tab is instant, and only the analyser loop
   is stopped meanwhile. */
let armed = false;

/* Report a listening failure wherever the player can actually see it: the gate
   before arming, and the input row afterwards. Switching device is the case
   that made this necessary — it can only fail once armed, and #gateErr is
   hidden by then, so the old code wrote "could not open an audio input" into an
   invisible element and the switch just appeared to do nothing. */
function liveError(msg){
  const gate = document.getElementById('gate');
  const onGate = gate && !gate.classList.contains('hidden');
  const shown = document.getElementById(onGate ? 'gateErr' : 'liveErr');
  const other = document.getElementById(onGate ? 'liveErr' : 'gateErr');
  if (other) other.classList.add('hidden');
  if (!shown) return;
  if (msg == null){ shown.classList.add('hidden'); return; }
  shown.textContent = msg;
  shown.classList.remove('hidden');
}

async function startListening(deviceId){
  try {
    if (A.stream) A.stream.getTracks().forEach(t => t.stop());
    const constraints = { audio: {
      echoCancellation:false, noiseSuppression:false, autoGainControl:false,
      channelCount:1
    }};
    if (deviceId) constraints.audio.deviceId = { exact: deviceId };
    A.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!A.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      A.ctx = new AC();
    }
    if (A.ctx.state === 'suspended') await A.ctx.resume();
    A.rate = A.ctx.sampleRate;
    const src = A.ctx.createMediaStreamSource(A.stream);
    A.analyser = A.ctx.createAnalyser();
    A.analyser.fftSize = 8192;
    src.connect(A.analyser);
    A.buf = new Float32Array(A.analyser.fftSize);
    armed = true;
    liveError(null);
    await listDevices();
    if (!A.timer) A.timer = setInterval(tick, 55);
    return true;
  } catch(e){
    liveError(e && e.name === 'NotAllowedError'
      ? 'Microphone permission was blocked. Allow it in your browser’s address-bar icon, then tap Start again.'
      : 'Could not open an audio input (' + (e && e.name || e) + '). Check your interface is plugged in.');
    return false;
  }
}
async function listDevices(){
  const sel = document.getElementById('deviceSel');
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const current = A.stream && A.stream.getAudioTracks()[0];
    const label = current && current.label;
    sel.innerHTML = devices.map((d,i) =>
      '<option value="' + d.deviceId + '"' + (d.label === label ? ' selected' : '') + '>' +
      (d.label || ('Input ' + (i+1))) + '</option>').join('');
  } catch(e){ sel.innerHTML = '<option>Default input</option>'; }
}

function tick(){
  if (!A.analyser) return;
  A.analyser.getFloatTimeDomainData(A.buf);
  let rms = 0;
  for (let i = 0; i < A.buf.length; i++) rms += A.buf[i]*A.buf[i];
  rms = Math.sqrt(rms / A.buf.length);
  A.level = rms;
  document.getElementById('levelBar').style.width = Math.min(100, rms * 320) + '%';
  const dot = document.getElementById('liveDot');
  dot.classList.toggle('on', rms > 0.008);
  document.getElementById('liveTxt').textContent = rms > 0.008 ? 'hearing your bass' : 'listening…';
  // Remembered so a song that scored nothing can tell the difference between
  // "nothing reached the input" and "the input was fine, no new notes started".
  if (rms > 0.008 && SG.t0 != null && !SG.finished) SG.sawSignal = true;

  // While Echo mode is sounding its own note, the microphone hears the
  // speaker — especially on a phone. Treat that window as silence, which
  // also re-arms the tracker ready for the player's reply.
  const now = performance.now();
  if (now < A.muteUntil){
    tracker.push(null, now);
    document.getElementById('liveTxt').textContent = 'playing the note — listen…';
    document.getElementById('liveDot').classList.remove('on');
    if (mode === 'tuner') renderTuner(null, null);
    return;
  }

  const small = C.downsample(A.buf, DECIMATE);
  const pitch = C.detectPitch(small, A.rate / DECIMATE);
  const reading = tracker.push(pitch ? pitch.hz : null, now);

  if (mode === 'tuner') renderTuner(pitch, reading);
  else if (reading.state === 'stable') {
    /* Entry grace for the game only: a note (or hum) that was already sounding
       when the Find-it screen arrived must NEVER be judged as the player's
       first answer — it dies unjudged, however long it keeps ringing. The
       gate lives HERE, not in onStableNote — manual test feeds must bypass
       it. A stable reading fires TRACKER_STABLE_MS after its note began, so
       any stable landing before graceUntil + that settle time belongs to a
       note that began inside the grace: dropped for good. The tracker has
       already consumed the attack, so only a release and a fresh attack can
       produce the next judgeable stable. */
    if (mode === 'find' && now < GV.graceUntil + TRACKER_STABLE_MS){ /* pre-entry ring: dies unjudged */ }
    else onStableNote(reading);
  }
  else if (mode === 'find') {
    /* No streamed "hearing X…" text here any more — raw detector output
       flipping under the question 18×/second WAS the flicker the game
       replaced. While a note settles, a quiet quaver rises through the
       canvas (no reflow, no text). The one sentence kept is committed,
       rare and useful: the still-ringing-from-before nudge. */
    if (reading.state === 'listening') {
      GV.hearingUntil = now + 350;
    } else if (reading.state === 'held' && q && reading.midi === q.midi
               && now - lastProgressAt > 1200) {
      document.getElementById('fHeard').textContent =
        'that note is still ringing from before — mute the string, then play it again';
    }
  }

  // Only measure drift against a note we KNOW was intended — the open string
  // being tuned. Chromatic cents wrap at ±50, so a badly flat string would
  // otherwise be reported as sharp of its neighbour.
  //
  // nearestOpenString matches within ±250 cents, which it has to: a badly slack
  // string must still find ITSELF rather than its neighbour. But that window
  // also swallows FRETTED notes — F at E-string fret 1 sits +100 cents from the
  // open E, and the E2 octave dot Songs draws sits +200 from the open D — and
  // feeding those to the drift test told a correctly-tuned bass it was 100 cents
  // sharp. So only readings close enough to BE an open string are counted.
  const openMatch = pitch ? C.nearestOpenString(pitch.hz, TUNING.midi) : null;
  if (openMatch && Math.abs(openMatch.cents) <= DRIFT_MAX_CENTS){
    centsHistory.push({ cents:openMatch.cents, name:openMatch.name });
    if (centsHistory.length > 24) centsHistory.shift();
    const recent = centsHistory.slice(-12);
    const drift = C.tuningDrift(recent.map(r => r.cents));
    const strings = recent.map(r => r.name).filter((n,i,a) => a.indexOf(n) === i);
    const warn = document.getElementById('tuneWarn');
    const dirWords = drift.meanCents < 0 ? 'flat (too low)' : 'sharp (too high)';
    const off = Math.abs(Math.round(drift.meanCents));
    const where = mode === 'tuner' ? 'Tune each open string to the green zone below.' : 'Open the Tuner tab.';
    // Two different open strings agreeing is what makes it the INSTRUMENT. One
    // string only ever gets to be a claim about that one string.
    if (drift.drifting && strings.length >= 2){
      warn.textContent = 'Every open string is landing ' + off + ' cents ' + dirWords +
        ' (' + strings.join(', ') + ') — your bass itself may be out of tune. ' + where;
      warn.classList.toggle('hidden', mode === 'tuner');   // redundant on this screen
    } else if (drift.drifting && recent.length >= 8){
      warn.textContent = 'Your open ' + strings[0] + ' string is landing ' + off + ' cents ' + dirWords +
        ' — that one string needs tuning. ' + where;
      warn.classList.toggle('hidden', mode === 'tuner');
    } else warn.classList.add('hidden');
  }
}

/* ================= tuner ================= */
const tunedStrings = {};
function renderTuneList(activeName){
  const host = document.getElementById('tuneList');
  if (!host) return;
  const names = TUNING.names;
  const html = names.map(n => {
    const done = tunedStrings[n];
    const cls = done ? 'is-done' : (n === activeName ? 'is-active' : '');
    return '<span class="tune-chip ' + cls + '">' + n + (done ? ' ✓' : '') + '</span>';
  }).join('');
  if (host.dataset.sig !== html){ host.innerHTML = html; host.dataset.sig = html; }
}
/* Every string green means tuning is genuinely done, so say so. It used to also
   tick "Tune up" off a twelve-week practice plan; that plan is retired, and the
   end of the job is worth marking on its own. */
function reportTuned(){
  const all = TUNING.names.every(n => tunedStrings[n]);
  const done = document.getElementById('tuneDone');
  if (done) done.classList.toggle('hidden', !all);
}

function renderTuner(pitch, reading){
  const noteEl = document.getElementById('tNote'), hzEl = document.getElementById('tHz');
  const bar = document.getElementById('tBar'), centsEl = document.getElementById('tCents');
  if (!pitch){
    noteEl.textContent = '—'; noteEl.classList.remove('intune');
    hzEl.textContent = 'play a note';
    centsEl.innerHTML = '&nbsp;';
    bar.style.transform = 'translate3d(0,0,0)';
    bar.classList.remove('intune');
    bar.parentElement.classList.remove('is-intune');
    renderTuneList(null);
    return;
  }
  const chromatic = C.hzToNote(pitch.hz);
  // Aim at the open string being tuned, not the nearest chromatic note: a
  // string 70 cents flat is closer to D#, and "tune DOWN to D#" is exactly
  // the wrong advice for someone tuning up to E.
  const target = C.nearestOpenString(pitch.hz, TUNING.midi);
  const n = target ? { name: target.name, octave: C.hzToNote(C.midiToHz(target.midi)).octave, cents: target.cents }
                   : chromatic;
  const inTune = Math.abs(Math.round(n.cents)) <= 15;  // match the number we display
  noteEl.innerHTML = n.name + '<small>' + n.octave + '</small>';
  noteEl.classList.toggle('intune', inTune);
  hzEl.textContent = pitch.hz.toFixed(2) + ' Hz' +
    (target ? ' · tuning the ' + target.name + ' string' : ' · not near an open string');
  // Clamp to the meter's range so a wildly-off note pins at the edge
  // instead of sliding out from under the scale.
  const clamped = Math.max(-50, Math.min(50, n.cents));
  const halfTrack = (bar.parentElement.clientWidth - 10) / 2;   // 5px inset each side
  bar.style.transform = 'translate3d(' + (clamped / 50 * halfTrack) + 'px,0,0)';
  bar.classList.toggle('intune', inTune);
  bar.parentElement.classList.toggle('is-intune', inTune);
  if (target && inTune) tunedStrings[target.name] = true;
  renderTuneList(target && target.name);
  reportTuned();
  centsEl.textContent = inTune ? '✓ in tune'
    : Math.abs(Math.round(n.cents)) + ' cents ' + (n.cents > 0 ? 'sharp — tune DOWN' : 'flat — tune UP');
  centsEl.style.color = inTune ? 'var(--good)' : 'var(--root)';
}

/* ================= PLAY — FRET QUEST =================
   The note-memorisation mini game. The detection engine underneath is
   unchanged (tracker → onStableNote → checkAnswer → recordAnswer), but the
   screen is a pixel rock stage: the note being asked for hangs on the
   BELL, the right note fires the CANNON, and the streak feeds a wall of
   FIRE across the stage front. Three difficulty axes: STAGE (how much
   neck — the shared tier), PACE (the cannon fuse and the stage lights),
   and PROMPT (note names, bass-clef staff, or a mix). */
let q = null, qStart = 0, wrongThisQ = 0, lastProgressAt = 0, outOfTuneThisQ = false;
/* An out-of-tune reading ON the target fret (or its accepted octave twin) told
   the player where the note is — a free confirmation. The eventual in-tune
   correct still counts as found, but never as a first-try recall. */
let tuneWaivedThisQ = false;
/* How many out-of-tune readings this question has drawn. The second one
   escalates the coaching: one bad reading is a finger a millimetre off, two in
   a row on the same question is usually the STRING — and that is a Tuner job. */
let outOfTuneCount = 0;
/* A stalled player gets one pointer at Show-me per question; more than that is
   nagging someone who is thinking. */
let nudgedThisQ = false;
/* Question counter + the in-session review queue: a missed note books itself
   a comeback a few questions out (see BassGame.createReviewQueue). */
let qCount = 0;
/* The staff teaching pointer persists until a staff question has actually
   been ANSWERED (not merely seen), and it is a real link to the clef card. */
let staffAnswered = false;
/* One "5 seconds" spoken warning per question, and one fuse double-tick. */
let saidFiveThisQ = false, tickedFuseThisQ = false;
/* Reading mode meets FLATS: an accidental staff question coin-flips its
   spelling per question (D♭ or C♯ — same fret, same sound, both accepted).
   Name mode stays sharps: its labels and pool are name-based. */
let qFlat = false;
const FLAT_DISP = { 'C#':'D♭', 'D#':'E♭', 'F#':'G♭', 'G#':'A♭', 'A#':'B♭' };
/* `score` = questions you eventually found; `clean` = found on the first attempt,
   which is the one the stored accuracy is built from. */
const sess = { find:{ score:0, clean:0, streak:0, asked:0 } };

const GAME = window.BassGame;
const reviewQ = GAME.createReviewQueue();
const GV_KEY = 'bassTrainer.game.v1';
/* Everything the game owns beyond the question itself. XP is persistent —
   losing the stage lights ends a set, never progress. */
const GV = {
  /* WHAT THE GAME ASKS FOR — the mode strip on the console, not a setting:
     'notes' asks for one note, 'scales' shows a chord and asks for the whole
     moveable box under it. Persisted, because which game you are playing is
     not something to re-choose every session. */
  gameMode:'notes',
  pace:'chill', prompt:'name', xp:0, best:{},
  calm:false,            // "Effects: Calm" — forces the reduced-motion path
  sound:true,            // WebAudio cues (all far above the 420 Hz detector)
  frets:'all',           // fret-region focus: all | low | mid | high
  /* The note map's display options (the reference card below the console —
     never anything the game consults). spell: natural | sharp | flat;
     stage: dim what this stage does not ask; weak: overlay your own misses. */
  map:{ spell:'natural', stage:true, weak:false },
  /* The scale card's display options — the same standing as the map's: a
     reference card below the console, never anything the game consults.
     root is a pitch class; view: box | neck; labels: names | degrees. */
  study:{ root:9, type:'minPent', view:'box', labels:'names' },
  /* WHICH RUNG OF WHICH LADDER. The stage control has two meanings — how much
     NECK in Notes mode, how far up the SCALE ladder here — so it has two
     stored values. Sharing one made a Notes stage-5 player's first ever scale
     question an eleven-note run in any key from any position; a first-time
     scale player starts at rung 1 whatever their Notes rung is. */
  scaleTier:0,
  /* How many strings the player's bass HAS. Scale mode's top rung anchors on
     the low B unless this says there isn't one. (Notes mode's neck comes from
     the shared tier table and is untouched by this.) */
  strings5:true,
  run:null,
  runBestKey:null,       // the best-run key SNAPSHOTTED at run start (A settings
                         // change mid-run starts a new run, so a run can never
                         // bank under a difficulty it did not play)
  promptKind:'name',     // what THIS question shows ('mix' resolves per question)
  phase:'idle',          // idle | fight | zap | breach | hold | over
  spawnAt:0,             // when the question arrived, for the fuse clock
  carryFuseMs:null,      // remaining fuse carried across a skip (a skip must
                         // not refill the fuse on timed paces)
  freezeUntil:0,         // wrong-verdict fairness: the fuse holds ~1s while a
                         // 'no' verdict is being read (same slide as out-of-tune)
  fuseBudget:null,       // per-question cap on those holds (BassGame.createFuseBudget):
                         // ~3s of wrong-verdict freezes, ~4s of out-of-tune hold —
                         // spam can no longer stall the fuse forever
  bell:null,             // { wobble } — wobble is the last-miss timestamp
  bx:230, by:28,         // where the bell was last drawn (ring fx start there)
  zapT:0, breachT:0, zapHit:false,
  fx:[],                 // particles and floating toasts
  hearingUntil:0,        // canvas quaver while a pluck settles
  graceUntil:0,          // entry grace: a note already sounding when the
                         // screen arrives is ambience, not an answer — it is
                         // dropped for good, never judged (tick only)
  hiddenAt:null,         // when the tab went to the background (fuse pauses)
  nextQTimer:null,       // THE one pending question-advance timeout (zap ~900ms,
                         // breach/skip 2600ms holds). One slot, cleared by
                         // gvNewRun and newQuestion — a settings change mid-hold
                         // must never let a dead timer swap the fresh question
                         // and silently refill the fuse ~2s later
  srToast:null,          // a toast waiting to be spoken: newQuestion batches it
                         // into its own announcement ("+10 XP. Next: …")
  raf:null, lastFrame:0,
};
/* REDUCED = the OS's reduced-motion setting OR the game's own "Effects: Calm"
   toggle — either one forces the still path everywhere the scene animates. */
let OS_REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
let REDUCED = OS_REDUCED;
function updateReduced(){
  REDUCED = OS_REDUCED || GV.calm;
  /* The CSS animations (verdict pop, fuse pulse) are gated on this class too:
     the OS media query cannot see the in-app "Effects: Calm" toggle. */
  const sec = document.getElementById('secFind');
  if (sec) sec.classList.toggle('calm', REDUCED);
}
if (typeof matchMedia === 'function'){
  // Live, not a snapshot: flipping the OS setting mid-session must take.
  const rmq = matchMedia('(prefers-reduced-motion: reduce)');
  if (rmq.addEventListener) rmq.addEventListener('change', e => { OS_REDUCED = e.matches; updateReduced(); });
}
/** Difficulty premium on XP: pace × stage × prompt, SCALED by how much of the
    stage's unfocused pool the current focus filters leave askable — a 6-note
    focus pool must not collect the full "bigger stage" premium (the premium
    caption already says "bigger stages", so nothing new to disclose).
    Hearts/combo never scale. */
function gvMult(){
  const paceM = GV.pace === 'turbo' ? 1.5 : GV.pace === 'steady' ? 1.25 : 1;
  const stageM = 1 + gvTier() * 0.1;
  /* Scale mode pays by the LENGTH OF THE RUN: one question there is six notes
     (eleven at the top stage), so it is worth six notes' work — half a point
     per note, i.e. ×3 for a box and ×5.5 for up-and-back. The prompt and focus
     premiums are Notes-mode ideas and do not exist here. */
  if (scaleMode()) return paceM * stageM * (scRunLength() / 2);
  const promptM = GV.promptKind === 'staff' ? 1.2 : 1;
  const focusM = GAME.focusMult(pool().length,
    fretWinPositions([0, tierNow().maxFret]));   // the unfocused stage pool
  return paceM * stageM * promptM * focusM;
}
/** Best runs are per difficulty — pace, stage, prompt, string focus AND fret
    window — or a Soundcheck name run would own the number an Encore staff run
    is chasing, and an E-only frets-0–5 run would own the all-strings record.
    Old three-part keys ride along harmlessly; missing keys read as 0. */
function gvBestKey(){
  /* Scale mode's records are its own: a set of six-note runs and a set of
     single notes are not the same achievement, so they never share a slot.
     Only pace and stage move the difficulty there — the prompt, string and
     fret axes are Notes-mode axes. */
  if (scaleMode()) return 'scale|' + GV.pace + '|' + GV.scaleTier;
  return GV.pace + '|' + tier + '|' + GV.prompt + '|' + (focus || 'all') + '|' + GV.frets;
}

function gvLoad(){
  try {
    const s = JSON.parse(localStorage.getItem(GV_KEY)) || {};
    if (GAME.PACES[s.pace]) GV.pace = s.pace;
    if (GAME.PROMPTS[s.prompt]) GV.prompt = s.prompt;
    GV.xp = Math.max(0, s.xp | 0);
    GV.calm = !!s.calm;
    GV.sound = s.sound !== false;   // default ON
    if (FRET_WINS.hasOwnProperty(s.frets)) GV.frets = s.frets;
    if (s.gameMode === 'scales' || s.gameMode === 'notes') GV.gameMode = s.gameMode;
    /* The scale ladder's own rung — never seeded from the Notes tier. A
       player who has never played scale mode starts at the bottom of it. */
    /* window.BassScales, not the SCL alias: gvLoad runs long before that
       const is initialised, and a TDZ throw here would lose every setting. */
    GV.scaleTier = Math.min(window.BassScales.STAGES.length - 1, Math.max(0, s.scaleTier | 0));
    /* The Notes ladder's rung. It lived in the Theory Trainer's store while a
       quiz shared the same difficulty; it belongs here now, beside every other
       thing the game remembers. */
    tier = Math.min(TIERS.length - 1, Math.max(0, s.tier | 0));
    GV.strings5 = s.strings5 !== false;
    if (s.map){
      if (MAP_SPELLS.indexOf(s.map.spell) >= 0) GV.map.spell = s.map.spell;
      GV.map.stage = s.map.stage !== false;
      GV.map.weak = !!s.map.weak;
    }
    if (s.study){
      if (s.study.root >= 0 && s.study.root <= 11) GV.study.root = s.study.root | 0;
      if (STUDY_TYPES.indexOf(s.study.type) >= 0) GV.study.type = s.study.type;
      if (s.study.view === 'neck' || s.study.view === 'box') GV.study.view = s.study.view;
      if (s.study.labels === 'degrees' || s.study.labels === 'names') GV.study.labels = s.study.labels;
    }
    // Keyed pace|tier|prompt since the multiplier landed; the old plain
    // 'steady'/'turbo' keys ride along harmlessly and missing keys read as 0.
    GV.best = Object.assign({}, s.best);
  } catch(e){}
}
function gvSave(){
  try { localStorage.setItem(GV_KEY, JSON.stringify({
    pace:GV.pace, prompt:GV.prompt, xp:GV.xp, best:GV.best, gameMode:GV.gameMode,
    calm:GV.calm, sound:GV.sound, frets:GV.frets, map:GV.map, study:GV.study,
    scaleTier:GV.scaleTier, tier:tier, strings5:GV.strings5 })); } catch(e){}
}
/* Fret-region focus for the question pool. Windows overlap on purpose —
   fret 5 belongs to both hands' territory. */
const FRET_WINS = {
  all:  { label:'All',   range:null },
  low:  { label:'0–5',   range:[0, 5] },
  mid:  { label:'5–9',   range:[5, 9] },
  high: { label:'7–12',  range:[7, 12] },
};
const FRET_ORDER = ['all', 'low', 'mid', 'high'];
/* How the note map spells what it draws. Naturals-only is the default: the
   seven letters are the map a beginner is actually building, and the five
   accidentals drawn beside them are noise until those letters are solid. */
const MAP_SPELLS = ['natural', 'sharp', 'flat'];
/* The scales the study card can draw. The table itself (intervals and degrees)
   is SCALES, further down — one scale vocabulary for the whole app. */
const STUDY_TYPES = ['minPent', 'natMinor', 'majPent', 'major', 'blues'];
gvLoad();
updateReduced();

/** Display spelling of a note name: the engraved ♯, never the ASCII #.
    Display only — q.name and every stored key stay ASCII. */
function disp(name){ return String(name).replace(/#/g, '♯'); }
/** THIS question's display spelling: the flat name when the staff coin-flip
    chose flats (D♭), the sharp name otherwise. Stored keys stay sharp/ASCII. */
function dispQ(){ return q ? (qFlat && FLAT_DISP[q.name] ? FLAT_DISP[q.name] : disp(q.name)) : ''; }
/** A HEARD accidental, spelled the way the current question spells itself —
    "that's a C♯" under a D♭ question would read as a different note. */
function dispHeard(name){ return (qFlat && FLAT_DISP[name]) ? FLAT_DISP[name] : disp(name); }
/** 'an A', 'an E', 'an F♯' — the article covers sharps too (prefix test). */
function article(name){ return /^[AEF]/.test(name) ? 'an' : 'a'; }
/** The game's screen-reader channel: a visually-hidden polite live region.
    #fQ itself is not live — the question is announced here, once, with the
    XP toast that preceded it batched in front of it. */
function srAnnounce(text){
  const el = document.getElementById('gvLive');
  if (el) el.textContent = text;
}
/** The one writer of #fSub. #fSub is aria-live, so every write is announced —
    subWrite always writes (a stall nudge is news), subWriteIfChanged skips
    when the text is already up, so the static per-question instruction is not
    re-announced on every new question. */
function subWrite(html){
  const el = document.getElementById('fSub');
  if (!el) return;
  el.innerHTML = html;
  el.dataset.sig = html;
}
/* Last instruction announced PER PROMPT-KIND: mixed mode alternates two static
   instructions, and comparing only against the text currently up re-announced
   each of them on every other question. An instruction this kind has already
   spoken swaps in with the live region off — visible, silent. */
const SUB_SEEN = {};
function subWriteIfChanged(html, kind){
  const el = document.getElementById('fSub');
  if (!el || el.dataset.sig === html) return;
  const k = kind || '';
  if (SUB_SEEN[k] === html){
    el.setAttribute('aria-live', 'off');
    subWrite(html);
    setTimeout(() => el.setAttribute('aria-live', 'polite'), 400);
    return;
  }
  SUB_SEEN[k] = html;
  subWrite(html);
}

/* ---- sound cues ----
   Tiny WebAudio blips through the SAME AudioContext the mic uses. Every cue
   sits far above the detector's 420 Hz ceiling, so even on a phone speaker
   the mic can never hear one as a note. Optional (GV.sound), default on. */
function gvCue(kind){
  if (!GV.sound || !A.ctx) return;
  try {
    const t = A.ctx.currentTime;
    const blip = (freq, at, dur, peak, type) => {
      const o = A.ctx.createOscillator(), g = A.ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(peak, t + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g); g.connect(A.ctx.destination);
      o.start(t + at); o.stop(t + at + dur + 0.02);
    };
    if (kind === 'ding'){          // a clean zap rings a tiny bell
      blip(1760, 0, 0.35, 0.12);
      blip(2637, 0, 0.22, 0.05);   // a bright partial over it
    } else if (kind === 'tick'){   // the fuse crossed 2s: a soft double-tick
      blip(880, 0, 0.05, 0.07);
      blip(880, 0.14, 0.05, 0.07);
    } else if (kind === 'phut'){   // the fuse died: a dull phut
      blip(620, 0, 0.16, 0.09, 'triangle');
    } else if (kind === 'step'){   // one note of a scale run landed: a short soft
      blip(1320, 0, 0.09, 0.055);  // click, well under the ding that ends the run
    } else if (kind === 'buzz'){   // a wrong answer: short, dull, quieter than
      blip(560, 0, 0.10, 0.05, 'triangle');   // the ding — and above the 420 Hz
      blip(530, 0.02, 0.09, 0.035, 'triangle'); // detector ceiling, like every cue
    }
  } catch(e){ /* a blocked context must never break a verdict */ }
}

function gvNewRun(){
  GV.run = GAME.createRun({ pace: GV.pace, xp: GV.xp });
  /* The best-run key is decided at RUN START and never re-read mid-run: any
     setting that affects the game (pace, stage, prompt) starts a new run, so
     a record can only ever be banked under the difficulty that earned it. */
  GV.runBestKey = gvBestKey();
  /* Kill any pending question-advance from the old run: a dead breach/skip
     hold timer firing ~2s into the new run silently swapped the fresh
     question and refilled the fuse. */
  if (GV.nextQTimer != null){ clearTimeout(GV.nextQTimer); GV.nextQTimer = null; }
  GV.carryFuseMs = null;
  GV.freezeUntil = 0;
  GV.phase = 'idle';
  const over = document.getElementById('gvOver');
  if (over) over.classList.add('hidden');
  // The over screen's idle-♪ gate lifts with the overlay.
  const secEl = document.getElementById('secFind');
  if (secEl) secEl.classList.remove('gv-overon');
  // Back on stage: the control the over screen disabled comes back.
  const skip = document.getElementById('fSkip');
  if (skip) skip.disabled = false;
  renderHud();
}
/** Feed one judgement to the run and let every dependent surface follow.
    `scale` shades the difficulty multiplier for a judgement that is only
    worth part of a question (a scale run's landed notes). */
function gvJudge(kind, scale){
  if (!GV.run) return null;
  const r = GV.run.judge(kind, gvMult() * (scale == null ? 1 : scale));
  if (r.ignored) return r;
  GV.xp = GV.run.state.xp;
  /* Bests bank LIVE, not only at lights-out: a Soundcheck run (which never
     ends) and an abandoned run keep their records the moment they set them.
     The metric is CLEAN zaps, banked under the run's snapshotted key. */
  const bk = GV.runBestKey || gvBestKey();
  if (GV.run.state.cleanZaps > (GV.best[bk] || 0)){
    GV.best[bk] = GV.run.state.cleanZaps;
    updateBestNote();
  }
  gvSave();
  renderHud();
  if (r.leveled) gvToast('LEVEL UP — ' + GAME.levelTitle(r.level).toUpperCase());
  // Combo milestones ride the toast every few rungs — the payout and the
  // reason it is growing, in one line.
  else if (r.gain > 0) gvToast('+' + r.gain + ' XP' +
    (r.combo >= 5 && r.combo % 5 === 0 ? ' — combo ×' + r.combo : ''));
  return r;
}
function renderHud(){
  const s = GV.run && GV.run.state;
  const hearts = document.getElementById('gvHearts');
  if (hearts){
    hearts.innerHTML = (!s || s.hearts == null) ? '' :
      Array.from({ length: s.maxHearts }, (_, i) =>
        '<i' + (i < s.hearts ? '' : ' class="lost"') + '></i>').join('');
    hearts.setAttribute('aria-label', (!s || s.hearts == null)
      ? 'no stage lights on this pace'
      : s.hearts + ' of ' + s.maxHearts + ' stage lights lit');
  }
  const level = GAME.levelFor(GV.xp);
  const lv = document.getElementById('gvLevel');
  if (lv) lv.textContent = 'LV ' + level + ' · ' + GAME.levelTitle(level).toUpperCase();
  const combo = document.getElementById('gvCombo');
  if (combo){
    const c = s ? s.combo : 0;
    combo.classList.toggle('hidden', c < 2);
    // COMBO, not STREAK: the session tile below already says "streak" about a
    // different number — two things called STREAK on one screen read as one.
    combo.textContent = 'COMBO ×' + c;
  }
  const prog = GAME.levelProgress(GV.xp);
  const bar = document.getElementById('gvXpBar');
  if (bar) bar.style.width = Math.round(prog.frac * 100) + '%';
  // The numbers behind the bar, visible: "90/120" beside it.
  const xpNum = document.getElementById('gvXpNum');
  if (xpNum) xpNum.textContent = prog.into + '/' + prog.span;
  const xpWrap = bar && bar.parentElement;
  if (xpWrap && xpWrap.getAttribute('role') === 'progressbar'){
    xpWrap.setAttribute('aria-valuenow', prog.into);
    xpWrap.setAttribute('aria-valuemax', prog.span);
    /* Past the last title the bar must not promise Thunderstruck again —
       beyond the cap the next stop is just the next level number. */
    const nextName = level + 1 > GAME.LEVEL_TITLES.length
      ? 'LV ' + (level + 1) : GAME.levelTitle(level + 1);
    xpWrap.setAttribute('aria-valuetext', prog.into + ' of ' + prog.span +
      ' XP to ' + nextName);
  }
}

function tierNow(){ return TIERS[tier]; }
/** How many askable positions (string × fret, minus the tier's filtered
    accidentals) a fret window leaves on the current stage. Windows below 4
    are disabled: a one-fret sliver "works" but asks the same two notes
    forever, which is a lit button teaching nothing. */
function fretWinPositions(range){
  if (!range) return Infinity;
  const t = tierNow();
  let n = 0;
  for (const sn of t.strings){
    const si = TUNING.names.indexOf(sn);
    for (let f = Math.max(0, range[0]); f <= Math.min(t.maxFret, range[1]); f++){
      const name = C.NAMES[((TUNING.midi[si] + f) % 12 + 12) % 12];
      if (!t.accidentals && !NATURALS.has(name)) continue;
      n++;
    }
  }
  return n;
}
/* There is no gvScrollScene any more. It existed because a settings change
   started a new run under a console that had already been pushed off the
   screen by the settings card itself — the fix for a layout that overflowed.
   The console is fixed-height and always on screen now, so scrolling the page
   on the player's behalf would only ever take something away from them. The
   game scrolls NOTHING: no new run, no verdict, no lights-out. */
function pool(){
  const t = tierNow();
  let strs = t.strings;
  if (focus) strs = strs.filter(s => s === focus);
  const out = [];
  for (const sn of strs){
    const si = TUNING.names.indexOf(sn);
    for (let f = 0; f <= t.maxFret; f++){
      const midi = TUNING.midi[si] + f;
      const name = C.NAMES[((midi % 12) + 12) % 12];
      if (!t.accidentals && !NATURALS.has(name)) continue;
      out.push({ si, f, midi, sn, name });
    }
  }
  /* Fret-region focus, combined with the string focus above. If the combined
     filter empties the pool (a 7–12 window on a 5-fret stage), fall back to
     the whole range — a dead pool must never happen. */
  const win = FRET_WINS[GV.frets] && FRET_WINS[GV.frets].range;
  if (win){
    const inWin = out.filter(it => it.f >= win[0] && it.f <= win[1]);
    if (inWin.length) return inWin;
  }
  return out;
}
/** Per-position recent results, for the adaptive picker: the notes being
    missed come back sooner, the parked ones fade back. Written by
    recordAnswer into the shared stats. */
function noteView(){
  const nr = (loadShared().stats || {}).noteRecent || {};
  return key => nr[key] ? { tries: nr[key].length, recent: nr[key] } : null;
}
function newQuestion(){
  /* One door for "pose the next question", whichever game is being played:
     every caller (a settings change, a restart, the advance timer) goes
     through here, so neither mode can be left half-posed. */
  if (scaleMode()) return newScaleQuestion();
  /* Belt and braces with gvNewRun: whoever poses a question owns the advance
     slot — any older pending advance is now stale and must never fire. */
  if (GV.nextQTimer != null){ clearTimeout(GV.nextQTimer); GV.nextQTimer = null; }
  const p = pool();
  if (!p.length){ q = null; return; }
  const lastKey = q ? q.sn + ':' + q.f : null;
  qCount++;
  /* Missed notes booked a comeback? Serve them first — spaced repetition
     inside the sitting. Keys the current pool cannot pose are left booked. */
  const dueKey = reviewQ.next(qCount, lastKey, k => p.some(it => it.sn + ':' + it.f === k));
  q = dueKey ? p.find(it => it.sn + ':' + it.f === dueKey)
             : GAME.weightedPick(p, noteView(), lastKey, Math.random);
  wrongThisQ = 0; outOfTuneThisQ = false; qStart = performance.now();
  tuneWaivedThisQ = false; outOfTuneCount = 0;
  nudgedThisQ = false;
  saidFiveThisQ = false; tickedFuseThisQ = false;
  lastProgressAt = qStart;
  tracker.reset();   // clears the settle clock only — a ringing note stays consumed
  GV.promptKind = GAME.resolvePrompt(GV.prompt, Math.random);
  /* Reading mode coin-flips the SPELLING of accidentals: D♭ is as real on a
     page as C♯, and only the staff carries the choice — name mode's labels
     and pool are sharp-named. Same pitch accepted either way. */
  qFlat = GV.promptKind === 'staff' && /#/.test(q.name) && Math.random() < 0.5;
  renderPrompt();
  // Announce the fresh question to screen readers — #fQ itself is not live.
  // A staff question announces its POSITION, not its name: reading the staff
  // is the skill being tested, and the position is what the eyes get — which
  // includes the accidental sign, or an SR player hears a natural's position
  // and gets marked wrong for playing exactly what they were told.
  // A toast still waiting to speak (the zap's XP payout) is batched in FRONT
  // of the question — one utterance, instead of the toast being cut off by
  // the next-question announcement landing 650ms behind it.
  const toastLead = GV.srToast ? GV.srToast + '. ' : '';
  GV.srToast = null;
  if (GV.promptKind === 'staff'){
    const spec = GAME.staffSpec(q.midi, qFlat ? { prefer:'flat' } : undefined);
    const accWords = spec.acc === '#' ? ' with a sharp sign'
                   : spec.acc === 'b' ? ' with a flat sign' : '';
    srAnnounce(toastLead + 'Next: read the staff — a note ' + GAME.staffPosName(spec.pos) +
      accWords + ', on the ' + q.sn + ' string');
  } else {
    srAnnounce(toastLead + 'Next: play ' + disp(q.name) + ' on the ' + q.sn + ' string');
  }
  const v = document.getElementById('fVerdict');
  v.innerHTML = '&nbsp;'; v.className = 'verdict';
  document.getElementById('fHeard').innerHTML = '&nbsp;';
  // (the staff slot is renderPrompt's)
  gvSpawn();
  updateFindStats();
}
/** Show or hide the question staff. Its slot keeps its reserved height whether
    the staff is in it or not, so switching prompt modes — the only thing that
    empties it — cannot change the console's height by a pixel. */
function gvShowStaff(on){
  const wrap = document.getElementById('gvStaffWrap');
  if (wrap) wrap.classList.toggle('hidden', !on);
}
function renderPrompt(){
  const wrap = document.getElementById('gvStaffWrap');
  if (!q){ if (wrap) wrap.classList.add('hidden'); return; }
  if (GV.promptKind === 'staff'){
    document.getElementById('fQ').innerHTML = 'Play this note on the <b>' + q.sn + '</b> string';
    /* The teaching pointer stays until a staff question has been ANSWERED —
       seeing one proves nothing — and it is a real link: it opens the clef
       card below and scrolls there (wired once, delegated, in the ui section).
       Written only when it CHANGES: #fSub is aria-live, and rewriting the same
       instruction re-announced it over every question. */
    subWriteIfChanged(staffAnswered
      ? 'Read it off the staff, find it on the neck, play it.'
      : 'Read it off the staff and play it. New to this? ' +
        '<a href="#" class="gv-staffhelp-link">The one-minute staff guide</a>.',
      'staff');
    drawStaff(document.getElementById('gvStaff'), q.midi, { showName:false, flat:qFlat });
    gvShowStaff(true);
  } else {
    // The note letter is the thing being learned — it gets the root amber;
    // the string letter stays chrome-violet.
    document.getElementById('fQ').innerHTML = 'Play <b class="gv-note">' + disp(q.name) + '</b> on the <b>' + q.sn + '</b> string';
    subWriteIfChanged('Find it on the neck and play it.', 'name');
    gvShowStaff(false);
  }
}

/* ================= SCALE MODE =================
   Same console, same cannon, a different question. The bell wears a CHORD —
   "Am7", "A5", "C" — and nothing else: knowing which scale that chord wants
   IS the skill, so the game never names it until the answer is given away.
   The roots arrive as a looping four-chord progression in one key, so a set
   reads like a chart; when the loop has been played through, a new key is
   drawn. One chord is one RUN of the moveable box, and one run is ONE
   question: one fuse over the whole thing, one verdict, one payout.

   The rules are all in shared/scales.js (Node-tested): which scale a chord
   asks for, the progressions, where the box anchors, the target list for a
   run and the park-and-retry judging. This file only draws it and keeps the
   score. */
const SCL = window.BassScales;
const SC = {
  prog:null,          // the current progression (key, mode, name, chords)
  chords:null,        // the four bars actually being played (a vamp repeats one)
  idx:0,              // how far through the loop we are
  chord:null,         // the chord this question is asking
  anchor:null,        // {si, fret} — where its box sits
  targets:[],         // the notes of this run, in the order the run wants them
  run:null,           // BassScales.createScaleRun
  landed:0,           // notes in so far (mirrors run.index(), for the pips)
  wrong:0,            // wrong notes this run (a run survives them; credit does not)
  waived:false,       // an out-of-tune reading on the note it was waiting for
  asked:false,        // this run has been counted into the session figures
  shape:'up',
  stage:-1,           // the ladder rung this loop was drawn for
};
function scaleMode(){ return GV.gameMode === 'scales'; }
/** WHICH RUNG the stage control is on, for the game being played. The one
    control has two ladders behind it — Notes mode's neck and scale mode's
    own stage — and they are stored apart, so
    arriving in scale mode from a high Notes stage starts at the bottom. */
function gvTier(){ return scaleMode() ? GV.scaleTier : tier; }
/** The stage ladder's rung for the current stage. */
function scStage(){ return SCL.stage(GV.scaleTier); }
/** The anchor strings this rung may use, minus the low B when the player has
    told us their bass has four strings. */
function scStrings(st){
  const list = st.strings;
  if (GV.strings5) return list;
  const four = list.filter(si => si > 0);
  return four.length ? four : list;
}
/** How many notes this question is worth. Six for a box, eleven up-and-back —
    the fuse and the XP both scale off this. */
function scRunLength(){ return (SC.targets && SC.targets.length) || 6; }
/** A chord symbol as it should be READ. The spelling is decided in
    shared/scales.js (from the degree in the key), so this only has to catch
    an ASCII # from anything older. */
function dispSym(sym){ return String(sym).replace(/#/g, '♯'); }
/** …and as it should be SPOKEN: "A flat major", never "A♭". */
function speakChord(chord){
  if (!chord) return '';
  const name = String(chord.root || SCL.NAMES[chord.rootPc])
    .replace(/[♯#]/g, ' sharp').replace(/[♭]/g, ' flat');
  const label = SCL.CHORDS[chord.quality].label;
  return name + ' ' + label;
}
/** What this stage asks a run to do, in words — the one instruction line.
    Plain words: "the shape" and "your hand", never "the box, ascending". */
function scRunWords(){
  return SC.shape === 'down' ? 'six notes, high to low'
       : SC.shape === 'updown' ? 'six notes up, then back down'
       : 'six notes, low to high';
}
/** Where the box may live on this stage. */
function scSpec(st){
  return { tuning:TUNING, anchorStrings:scStrings(st),
           minFret:st.minFret, maxFret:st.maxFret };
}
/** Draw a new key and loop for the stage, rejecting any key whose chords do
    not all fit the neck this stage opens — a loop must never strand the
    player on a chord whose box is off the end of the stage. */
function scNewProgression(){
  const st = scStage();
  const wasKey = SC.prog ? SC.prog.keyPc : -1;
  /* The rung's own key pool (the first two rungs stay on natural letters),
     shuffled, then WEIGHTED: a loop whose boxes you keep fumbling comes back
     sooner. Same arithmetic the note game's picker uses. */
  const pool = (st.roots || [0,1,2,3,4,5,6,7,8,9,10,11]).slice()
    .sort(() => Math.random() - 0.5);
  const view = scView();
  const cand = [];
  let fallback = null;
  for (const keyPc of pool){
    const modeName = st.modes[Math.floor(Math.random() * st.modes.length)];
    const p = SCL.progression({ keyPc, mode:modeName, power:st.power }, Math.random);
    const chords = st.vamp ? [p.chords[0], p.chords[0], p.chords[0], p.chords[0]] : p.chords;
    if (!SCL.anchorChords(chords, scSpec(st)).every(Boolean)) continue;
    if (!fallback) fallback = { p, chords };
    if (keyPc === wasKey) continue;         // never the same key twice running
    /* A loop is worth as much as its WORST-remembered box — that is the one
       the player needs another go at. */
    let w = 0.2;
    const keys = [];
    for (const ch of chords){
      const a = scAnchorFor(ch, st);
      if (!a) continue;
      const k = scKeyFor(ch, a);
      keys.push(k);
      w = Math.max(w, GAME.weightFor(view(k), false));
    }
    cand.push({ p, chords, w, keys });
  }
  if (cand.length){
    /* A box booked for a comeback outranks the roll: serving it here is what
       makes a fumbled shape come back SOON rather than at chance. */
    const bookable = new Set();
    for (const c of cand) for (const k of c.keys) bookable.add(k);
    const due = scReviewQ.next(qCount, null, k => bookable.has(k));
    if (due){
      const hit = cand.filter(c => c.keys.indexOf(due) >= 0)[0];
      if (hit){ SC.prog = hit.p; SC.chords = hit.chords; SC.idx = 0; return; }
    }
    let total = 0;
    for (const c of cand) total += c.w;
    let roll = Math.random() * total;
    let pick = cand[cand.length - 1];
    for (const c of cand){ roll -= c.w; if (roll <= 0){ pick = c; break; } }
    SC.prog = pick.p; SC.chords = pick.chords; SC.idx = 0;
    return;
  }
  /* Every fitting key was the one we just played (or none fits at all — which
     the ladder's own test rules out). Play it again rather than stall. */
  if (fallback){ SC.prog = fallback.p; SC.chords = fallback.chords; SC.idx = 0; }
}
/** Where to put this chord's box. Low stages always take the lowest position
    the shape fits — the same hand every time — while the later ones pick
    among the strings that can host it, which is what "more positions" means. */
function scAnchorFor(chord, st){
  const strings = scStrings(st);
  const base = { rootPc:chord.rootPc, scaleKey:chord.scaleKey, tuning:TUNING,
                 minFret:st.minFret, maxFret:st.maxFret };
  if (st.positions === 'any'){
    const opts = strings
      .map(si => SCL.anchorFor(Object.assign({ anchorStrings:[si] }, base)))
      .filter(Boolean);
    if (opts.length) return opts[Math.floor(Math.random() * opts.length)];
  }
  return SCL.anchorFor(Object.assign({ anchorStrings:strings }, base));
}
/* ---- which boxes you fumble ----
   A box is a ROOT, a SHAPE and a PLACE: the same A minor pentatonic played
   from the E string and from the B string are two different things to
   remember. Keyed that way, stored beside the note game's own record (so the
   note map's weak-spot overlay can show scale misses too), and read back by
   the key picker above — a box missed four times used to come back at chance. */
function scKeyFor(chord, anchor){
  return 'sc:' + chord.scaleKey + ':' + chord.rootPc + ':' +
         (anchor ? anchor.si + ':' + anchor.fret : '?');
}
/** The stored record for the weighting, in the shape BassGame.weightFor wants. */
function scView(){
  const sr = (loadShared().stats || {}).scaleRecent || {};
  return key => sr[key] ? { tries: sr[key].length, recent: sr[key] } : null;
}
/** Bank how a run went, against the exact box it asked for. `landedFrac` also
    lights the positions on the note map's weak-spot overlay. */
function scRecord(ok){
  if (!SC.chord || !SC.anchor) return;
  const key = scKeyFor(SC.chord, SC.anchor);
  const notes = SC.targets.map(t => TUNING.names[t.si] + ':' + t.fret)
    .filter((v, i, a) => a.indexOf(v) === i);
  saveStats(st => {
    st.scaleRecent = st.scaleRecent || {};
    const r = st.scaleRecent[key] || (st.scaleRecent[key] = []);
    r.push(ok ? 1 : 0);
    if (r.length > 6) r.shift();
    /* The note map marks POSITIONS, so a fumbled box marks the positions it
       is made of — the same overlay, fed by both games. */
    if (!ok){
      st.scaleHeat = st.scaleHeat || {};
      for (const k of notes) st.scaleHeat[k] = (st.scaleHeat[k] || 0) + 1;
    }
  });
  if (!ok) scReviewQ.add(key, qCount);
}
/* Missed boxes book a comeback, the same way missed notes do. */
const scReviewQ = GAME.createReviewQueue();
/** One chord, one run, one question. `retry` guards the one recursive path
    below — a stage whose table could not place a chord would otherwise spin. */
function newScaleQuestion(retry){
  if (GV.nextQTimer != null){ clearTimeout(GV.nextQTimer); GV.nextQTimer = null; }
  const st = scStage();
  /* THE SECOND ASK. A reveal teaches for three seconds and then used to ask a
     DIFFERENT chord, so the shape just drawn was never played. After a Show
     me or a burnt fuse the same chord comes straight back — uncredited, with
     the box still on screen — and it is booked to return later as well. */
  const again = SC.repose;
  SC.repose = false;
  if (!again){
    /* A new loop when the old one has been played through — and whenever the
       STAGE has changed, because the rung decides what the chords may be (one
       chord or four, one family or two) and how much neck the box may use.
       Finishing the previous stage's loop on the new rung's rules would be a
       chart nobody chose. */
    if (!SC.chords || SC.idx >= SC.chords.length || SC.stage !== GV.scaleTier){
      SC.stage = GV.scaleTier;
      scNewProgression();
    }
  }
  const chord = again && SC.chord ? SC.chord : SC.chords[SC.idx];
  if (!again) SC.idx++;
  const anchor = again && SC.anchor ? SC.anchor : scAnchorFor(chord, st);
  if (!anchor){                       // cannot happen on a tested ladder (see
    if (retry) return;                // scales.test.js); if it ever did, one
    scNewProgression();               // fresh key is the way out — and only one
    return newScaleQuestion(true);
  }
  SC.chord = chord;
  SC.anchor = anchor;
  SC.shape = again ? SC.shape : SCL.runShapeFor(st, Math.random);
  SC.second = !!again;                // this ask pays nothing: it was given away
  SC.targets = SCL.runTargets({ scaleKey:chord.scaleKey, si:anchor.si,
                                fret:anchor.fret, tuning:TUNING, shape:SC.shape });
  SC.run = SCL.createScaleRun(SC.targets);
  SC.landed = 0; SC.wrong = 0; SC.waived = false; SC.asked = false;
  /* Scale mode poses a chord, not a note: the note question is cleared so
     nothing downstream can judge against a stale one. */
  q = null;
  qCount++;
  wrongThisQ = 0; outOfTuneThisQ = false; outOfTuneCount = 0; tuneWaivedThisQ = false;
  nudgedThisQ = false; saidFiveThisQ = false; tickedFuseThisQ = false;
  qStart = performance.now(); lastProgressAt = qStart;
  tracker.reset();
  GV.promptKind = 'name';             // there is no staff in scale mode
  renderScalePrompt();
  scRenderChart();
  /* The second ask of a chord that was just given away keeps the SHAPE on
     screen — the whole point of asking again is that the drawing gets used. */
  if (SC.second){ scDrawBox(); scShowMedia('box'); }
  scRenderPips();
  const v = document.getElementById('fVerdict');
  v.innerHTML = '&nbsp;'; v.className = 'verdict';
  document.getElementById('fHeard').innerHTML = '&nbsp;';
  /* One announcement per question: the chord, and what to do with it. The
     landing notes are NOT announced — that is what the pips and the counter
     are for — only the chord and the outcome. */
  const toastLead = GV.srToast ? GV.srToast + '. ' : '';
  GV.srToast = null;
  srAnnounce(toastLead + (SC.second ? 'Same chord again: ' : 'Next chord: ') +
    speakChord(SC.chord) + '. Play its shape — ' + scRunWords() + '.');
  /* The study card below follows the chord on screen — unless the player has
     it open, in which case they are studying something on purpose. */
  scSyncStudyCard();
  gvSpawn();
  updateFindStats();
}
/** The chord, as big as the read column can carry it — and nothing else.
    The sub-line says what to do with it, and the word "box" in it is a real
    link to the Scale card — the same door the staff prompt opens for the
    clef card. */
function renderScalePrompt(){
  document.getElementById('fQ').textContent = SC.chord ? dispSym(SC.chord.symbol) : '';
  const boxWord = '<a href="#" class="gv-boxhelp-link">box</a>';
  subWriteIfChanged('Play its ' + boxWord + ' — <b>' + scRunWords() + '</b>.',
    'scale:' + SC.shape);
  gvShowStaff(false);
}
/** The Scale card starts on the chord you are being asked, so opening it is
    never a hunt for the shape you were just shown. A card the player has
    OPENED is theirs — it is not moved under them. */
function scSyncStudyCard(){
  const card = document.getElementById('gvScaleStudy');
  if (!SC.chord || (card && card.open)) return;
  GV.study.root = SC.chord.rootPc;
  GV.study.type = SC.chord.scaleKey === 'majPent' ? 'majPent' : 'minPent';
  GV.study.view = 'box';
  gvSave();
  if (typeof renderScaleStudyUI === 'function') renderScaleStudyUI();
}
/** The chart you are playing: four bars, the current one lit. It shows the
    chords and only the chords — naming the scale here would answer the
    question the bell is asking. */
/* THE RULE THE GAME TESTS, in the words a second-week player has.
   It sits under the chart on every question, permanently: the mapping used to
   appear NOWHERE on this screen, so the only route from "I don't know" to "I
   know" was paying for Show me over and over. */
const SC_RULE = 'An <b>m</b>, <b>m7</b> or <b>5</b> after the letter → that ' +
  'letter’s <b>minor</b> shape. Just a letter → <b>major</b> shape.';
const SC_RULE_SPOKEN = 'The rule: an m, m7 or 5 after the letter means that ' +
  'letter’s minor pentatonic shape; a letter on its own means the major one.';
function scRenderChart(){
  const el = document.getElementById('gvChart');
  if (!el || !SC.prog) return;
  const st = scStage();
  /* A drill is not a chart. On the rungs where every chord is voiced as a 5
     the game grades the MINOR shape of each root, so printing "A minor ·
     i-VII-VI-VII" beside it would be a key signature the graded answer
     contradicts. Those rungs say what they are: same shape, four roots. */
  const drill = st.power || st.vamp;
  /* One chord over and over is one bar with a repeat sign, not four identical
     bars — and "vamp" is a word nobody has in week two. */
  const bars = st.vamp
    ? '<div class="gv-chart-bar on repeat">' + dispSym(SC.chords[0].symbol) + '</div>'
    : SC.chords.map((ch, i) =>
        '<div class="gv-chart-bar' + (i === SC.idx - 1 ? ' on' : (i < SC.idx - 1 ? ' done' : '')) +
        '">' + dispSym(ch.symbol) + '</div>').join('');
  const head = st.vamp ? 'One chord, over and over'
    : drill ? 'Same shape, four chords'
    : 'Key of ' + dispSym(SC.prog.key) + ' ' + SC.prog.mode + ' · ' + SC.prog.name;
  el.innerHTML = '<span class="gv-chart-key">' + head + '</span>' +
    '<div class="gv-chart-bars">' + bars + '</div>' +
    '<p class="gv-chart-caption" id="gvRule">' + SC_RULE + '</p>';
  el.setAttribute('aria-label', (st.vamp
      ? 'One chord, repeated: ' + speakChord(SC.chords[0])
      : (drill ? 'Four chords, one shape' : 'Chord loop in ' + dispSym(SC.prog.key) + ' ' + SC.prog.mode) +
        ': ' + SC.chords.map(ch => speakChord(ch)).join(', ') +
        '. Now on chord ' + SC.idx + ' of 4') + '. ' + SC_RULE_SPOKEN);
  scShowMedia('chart');
}
/** Exactly one of the two occupants of the reserved compartment. */
function scShowMedia(which){
  const chart = document.getElementById('gvChart');
  const box = document.getElementById('gvBoxWrap');
  if (chart) chart.classList.toggle('hidden', which !== 'chart');
  if (box) box.classList.toggle('hidden', which !== 'box');
}
/** One pip per note of the run, filled as each note lands. Never the only
    signal: the verdict line counts the same notes in words, and the row
    carries the count as its own label — SPOKEN, politely and terse ("4 of
    11"), because a screen-reader player used to hear the chord and then
    nothing at all for six to eleven notes. Throttled to one utterance a
    second so a fast run does not become a stream of chatter. */
let scPipSaidAt = 0, scPipSaid = '';
function scRenderPips(){
  const el = document.getElementById('gvPips');
  if (!el) return;
  const n = scRunLength();
  el.innerHTML = Array.from({ length:n }, (_, i) =>
    '<i class="' + (i < SC.landed ? 'on' : (i === SC.landed ? 'at' : '')) + '"></i>').join('');
  el.setAttribute('aria-label', SC.landed
    ? SC.landed + ' of ' + n + ' notes landed'
    : 'no notes landed yet — ' + n + ' to play');
  const live = document.getElementById('gvPipLive');
  if (!live) return;
  const now = performance.now();
  const words = SC.landed ? SC.landed + ' of ' + n : '';
  /* The last note is always spoken — "6 of 6" is the one count that matters
     even if it lands inside another count's second. */
  const due = SC.landed === n || SC.landed === 0 || now - scPipSaidAt > 1000;
  if (words !== scPipSaid && due){
    scPipSaid = words; scPipSaidAt = now;
    live.textContent = words;
  }
}
/** Where the box lives, in words: "the E string, fret 5". */
function scAnchorWords(){
  return SC.anchor ? 'the ' + TUNING.names[SC.anchor.si] + ' string, fret ' + SC.anchor.fret : '';
}
/** The scale this chord wanted, named — only ever on the way OUT of a
    question (a burnt fuse, or Show me). Spelled the way the CHORD is spelled:
    a B♭7 chord does not want an "A♯ minor pentatonic". */
function scScaleName(){
  return dispSym(SC.chord.root || SCL.NAMES[SC.chord.rootPc]) + ' ' +
    (SC.chord.scaleKey === 'majPent' ? 'major pentatonic' : 'minor pentatonic');
}
/** Give the answer away: name the scale, say where the shape starts, and DRAW
    it into the compartment the chart was using. */
function scReveal(lead){
  if (!SC.chord) return '';
  const words = dispSym(SC.chord.symbol) + ' wants ' + scScaleName() +
    ' — start on ' + scAnchorWords() + '.';
  const v = document.getElementById('fVerdict');
  v.textContent = lead + words;
  v.className = 'verdict warn';
  scDrawBox();
  scShowMedia('box');
  return words;
}
/** WHICH WAY the run goes, in the words the caption and the reader both use. */
function scOrderWords(){
  return SC.shape === 'down' ? 'play them high to low, 6 → 1'
       : SC.shape === 'updown' ? 'play 1 → 6, then back down'
       : 'play them low to high, 1 → 6';
}
/** The box, drawn: three strings, the four or five frets it lives in, and the
    FINGER for every note on its dot.

    One visual language, both places. The study card's dots have always been
    fingers; this drawing used to number the same dots by PLAY ORDER, with
    nothing on either saying which — so "3" meant ring finger on one card and
    third note on the other. Fingers live in the dots now (they are the thing
    that never changes as the shape slides) and the ORDER lives in the caption
    under the board, which is also where an up-and-back run stops claiming to
    be six notes when the pips count eleven. */
function scDrawBox(){
  const cv = document.getElementById('gvBox');
  if (!cv || !SC.targets.length) return;
  /* The compartment's height answers the VIEWPORT (gvFitScene), so the canvas
     is sized to the space it actually gets rather than drawn big and squashed
     down to a blur by CSS. */
  const wrap = cv.parentElement;
  const availW = Math.max(180, Math.min(320, (wrap && wrap.clientWidth) || 300));
  const availH = Math.max(64, Math.min(150, (wrap && wrap.clientHeight) || 132));
  if (cv.width !== Math.round(availW)) cv.width = Math.round(availW);
  if (cv.height !== Math.round(availH)) cv.height = Math.round(availH);
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  /* One dot per POSITION. The FINGER comes from the shape itself (one finger
     per fret, counted from the lowest fret the shape touches), so it is the
     same number wherever the shape has slid to — which is the whole point. */
  const box = SCL.boxShape({ scaleKey:SC.chord.scaleKey, si:SC.anchor.si,
                             fret:SC.anchor.fret, tuning:TUNING });
  const fingers = SCL.boxFingers(SC.chord.scaleKey);
  const seen = new Map();
  box.forEach((t, i) => {
    const k = t.si + ':' + t.fret;
    if (!seen.has(k)) seen.set(k, { si:t.si, fret:t.fret, degree:t.degree, finger:fingers[i] });
  });
  const spots = [...seen.values()];
  const sis = [...new Set(spots.map(s => s.si))].sort((a, b) => a - b);
  const lo = Math.min.apply(null, spots.map(s => s.fret));
  const hi = Math.max.apply(null, spots.map(s => s.fret));
  const f0 = Math.max(0, lo - 1), f1 = hi + 1, cols = f1 - f0 + 1;
  const capH = 13;                       // the caption's own line, under everything
  const padL = 24, padR = 6, padB = 15 + capH;
  const colW = Math.floor((W - padL - padR) / cols);
  const rowH = Math.max(16, Math.min(30, Math.floor((H - padB - 12) / sis.length)));
  const r = Math.max(7, Math.min(12, Math.floor(rowH * 0.42)));
  const boardW = colW * cols;
  const half = Math.round(rowH / 2);     // half a string gap: the board's margin
  const top = Math.max(r + 2, Math.round((H - padB - (sis.length - 1) * rowH) / 2));
  const boardH = (sis.length - 1) * rowH + half * 2;
  const yOf = si => top + (sis.length - 1 - sis.indexOf(si)) * rowH;   // low string at the bottom
  const xOf = fret => padL + (fret - f0) * colW + Math.round(colW / 2);
  // the board
  ctx.fillStyle = '#2A1D17'; ctx.fillRect(padL, top - half, boardW, boardH);
  ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fillRect(padL, top - half, boardW, 2);
  // fret wires, and the nut if fret 0 is in view
  for (let f = f0; f <= f1; f++){
    const x = padL + (f - f0) * colW;
    ctx.fillStyle = f === 0 ? '#E8E2D4' : '#5C5A55';
    ctx.fillRect(x, top - half, f === 0 ? 3 : 2, boardH);
  }
  // strings, thickest at the bottom, and their names outside the board
  sis.forEach(si => {
    const y = yOf(si);
    const g = 3 - sis.indexOf(si);
    ctx.fillStyle = '#8A8078'; ctx.fillRect(padL, y - (g >> 1), boardW, Math.max(1, g));
    ctx.fillStyle = '#A79F94'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'right';
    ctx.fillText(TUNING.names[si], padL - 5, y + 4);
  });
  // fret numbers under the board — the anchor's own fret in the stage's amber
  ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
  for (let f = f0; f <= f1; f++){
    ctx.fillStyle = f === SC.anchor.fret ? '#F2A93B' : '#6E6A63';
    ctx.fillText(String(f), xOf(f), H - capH - 3);
  }
  // the notes: a disc per position — the roots brightest — its FINGER in it
  for (const s of spots){
    const x = xOf(s.fret), y = yOf(s.si);
    pxCircle(ctx, x, y, r + 1, '#14110F', null);
    pxCircle(ctx, x, y, r, s.degree === 'R' ? '#F2A93B' : '#C77F1F', null);
    ctx.fillStyle = '#14110F';
    ctx.font = 'bold ' + Math.max(10, r + 1) + 'px monospace'; ctx.textAlign = 'center';
    ctx.fillText(String(s.finger), x, y + Math.round(r * 0.38) + 1);
  }
  // the caption: what the numbers are, and which way to go
  ctx.fillStyle = '#A79F94'; ctx.textAlign = 'center';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('numbers = fingers · ' + scOrderWords(), Math.round(W / 2), H - 2);
  cv.setAttribute('aria-label', scScaleName() + ', starting on ' + scAnchorWords() +
    '. The number on each dot is the finger — 1 index to 4 pinky: ' +
    spots.map(s => TUNING.names[s.si] + ' string fret ' + s.fret + ', finger ' + s.finger).join('; ') +
    '. Then ' + scOrderWords() + '.');
}
/** Count this run into the session figures exactly once, however it ends. */
function scAsk(){
  /* …except the SECOND ask of a chord that was just given away. That is the
     player using the drawing, not being asked a question: it counts nowhere,
     or a reveal would inflate the session's own figures. */
  if (SC.asked || SC.second) return;
  SC.asked = true;
  sess.find.asked++;
}
/** A note arrived while a scale run is live. */
function scStableNote(reading, heardName){
  if (!SC.run) return;
  const expected = SC.run.expected();
  if (!expected) return;
  const vEl = document.getElementById('fVerdict');
  const verdict = C.checkAnswer(reading, expected.midi);
  if (verdict === 'out-of-tune'){
    /* The right note, badly stopped: the run does not advance and it is not a
       miss — the same fairness Notes mode gives, including the fuse hold. The
       first-try credit goes, because the position has now been confirmed. */
    vEl.textContent = tuneVerdict(reading, 'Right note!');
    vEl.className = 'verdict warn';
    outOfTuneThisQ = true;
    lastProgressAt = performance.now();
    SC.waived = true;
    return;
  }
  /* The note goes to the RUN to be judged — including the wrong ones, because
     the run is what knows whether this attempt was clean. Everything that is
     not the note it wants is a plain miss (a right note an octave out is,
     inside a box, simply a different note): the run parks where it is, the
     player tries again, and the run survives with its credit spent. */
  const miss = SCL.missKind({ targets:SC.targets, index:SC.run.index(), midi:reading.midi });
  const res = SC.run.push(reading.midi);
  if (res.status === 'retry'){
    scWrong(heardName, miss);
    return;
  }
  SC.landed = SC.run.index();
  scRenderPips();
  outOfTuneThisQ = false;
  lastProgressAt = performance.now();
  if (res.status === 'done'){ scComplete(); return; }
  gvCue('step');
  vEl.textContent = SC.landed + ' of ' + scRunLength() + ' — keep going.';
  vEl.className = 'verdict ok';
}
/** What a wrong note WAS, said in a way that teaches without answering.
    Three sentences, because one generic line covered the two cases that most
    need teaching — "I found an A, the game says my A isn't it" was the right
    note in the wrong octave, and a note two steps ahead got the same words as
    a note that is not in the shape at all. */
function scMissWords(heardName, miss){
  const at = 'Still on note ' + (SC.landed + 1) + ' of ' + scRunLength() + '.';
  const name = disp(heardName);
  if (miss && miss.kind === 'octave'){
    const where = miss.dir === 'high'
      ? 'that one is the top of the shape, not the bottom'
      : 'that one is the bottom of the shape, not the top';
    return { line: 'Right letter, wrong ' + (miss.octaves > 1 ? 'octaves' : 'octave') +
             ' — ' + where + '. ' + at,
             spoken: 'Right letter, wrong octave. ' + at };
  }
  if (miss && miss.kind === 'inbox'){
    const line = miss.at > miss.want
      ? 'That ' + name + ' is note ' + miss.at + ' of this shape — play note ' +
        miss.want + ' first. '
      : 'That ' + name + ' is note ' + miss.at + ' — you are past it, on note ' +
        miss.want + '. ';
    return { line: line + at, spoken: line };
  }
  return { line: 'That’s ' + article(name) + ' ' + name +
           ' — not one of this shape’s six notes. ' + at,
           spoken: 'Wrong note. ' + at };
}
/** A wrong note: buzz, park, retry. The run is never lost to one. */
function scWrong(heardName, miss){
  SC.wrong++;
  wrongThisQ++;
  lastProgressAt = performance.now();
  gvCue('buzz');
  outOfTuneThisQ = false;
  if (SC.wrong <= 2 && (!GV.fuseBudget || GV.fuseBudget.left('wrong') > 0)){
    GV.freezeUntil = performance.now() + 1000;
  }
  if (GV.bell) GV.bell.wobble = performance.now();
  if (GV.bell && !REDUCED){
    for (let i = 0; i < 4; i++)
      GV.fx.push({ kind:'d', x:GV.bx - 10 + i * 6, y:GV.by + 10 + (i % 2) * 3,
                   born:performance.now(), seed:i });
  }
  if (SC.wrong === 1){ scAsk(); sess.find.streak = 0; }
  gvJudge('wrong');                       // the combo breaks; the run does not
  const vEl = document.getElementById('fVerdict');
  /* The correction never names the note the run is waiting for: being shown
     the answer is what Show me is for, and it has a price. */
  const words = scMissWords(heardName, miss);
  vEl.textContent = words.line;
  vEl.className = 'verdict no';
  srAnnounce(words.spoken);
  updateFindStats();
}
/** How many wrong notes turn a run from "found it" into "hunted for it".
    Brute-forcing a six-note shape one fret at a time still finished the run
    and still bumped the RUNS and QUESTIONS tiles, so a Soundcheck player could
    farm the figures without knowing a thing. Past this many misses the run is
    still ASKED and still ends — it simply is not a find. */
function scHuntLimit(){ return scRunLength(); }
/** The whole box is in: the cannon fires. */
function scComplete(){
  const clean = SC.run.result().clean && !SC.waived && !SC.second;
  /* A second ask of a chord that was just given away is practice, not recall:
     it ends the question and draws no XP, no streak and no record. */
  const hunted = SC.wrong >= scHuntLimit();
  scAsk();
  if (!hunted && !SC.second) sess.find.score++;
  if (clean){ sess.find.clean++; sess.find.streak++; }
  else sess.find.streak = 0;
  const r = SC.second ? null : gvJudge(clean ? 'clean' : (hunted ? 'wrong' : 'dirty'));
  scRecord(clean);
  gvCue('ding');
  const sym = dispSym(SC.chord.symbol);
  const vEl = document.getElementById('fVerdict');
  vEl.textContent = clean
    ? 'FIRE! ' + sym + ' — all ' + scRunLength() + ', first time.'
    : hunted
      ? 'Found it the long way (' + SC.wrong + ' misses) — that one does not count as a find.'
      : SC.second
        ? 'That’s the shape — ' + sym + ' played back.'
        : 'The shape is in — ' + sym + ' done.';
  vEl.className = 'verdict ok';
  srAnnounce(sym + ': run complete, ' + scRunLength() + ' notes' +
    (clean ? ', clean' : hunted ? ', but hunted — not counted as a find' : '') + '.');
  gvZap();                                  // the cannon rings the bell
  updateFindStats();
  if (r && r.over) return;                  // the over screen owns the stage
  GV.nextQTimer = setTimeout(newQuestion, 1400);
}
/** The fuse burnt out with the run unfinished: a stage light, and the answer. */
function scBreach(){
  if (!SC.run) return;
  GV.phase = 'breach';
  GV.breachT = performance.now();
  scAsk();
  sess.find.streak = 0;
  const r = gvJudge('breach');
  /* PARTIAL CREDIT: four notes of a six-note run is four notes of work, and
     paying nothing for them taught the player that a run they cannot finish
     is worth abandoning. Paid at the 'dirty' rate, pro rata, and never for a
     second ask (that shape was already given away). */
  if (!SC.second && SC.landed > 0 && GV.run && !GV.run.state.over){
    gvJudge('partial', SC.landed / scRunLength());
  }
  scRecord(false);
  gvCue('phut');
  const lights = (r && r.hearts != null && GV.run)
    ? ' ' + r.hearts + ' of ' + GV.run.state.maxHearts + ' stage light' +
      (GV.run.state.maxHearts === 1 ? '' : 's') + ' left.'
    : '';
  const words = scReveal('Fuse out at ' + SC.landed + ' of ' + scRunLength() + '. ');
  srAnnounce('The fuse burnt out. ' + words + lights + ' Same chord again next.');
  updateFindStats();
  /* The run-ending correction has to SURVIVE the over screen (which wipes the
     verdict), so it rides into the overlay — phrased to sit mid-sentence
     there, not as its own headline. */
  if (r && r.over){
    gvGameOver('that last chord wanted ' + scScaleName() + ', from ' + scAnchorWords());
    return;
  }
  /* …and the chord comes straight back, with the shape still on screen: a
     reveal that teaches for three seconds and then asks something else is a
     lesson nobody got to use. */
  scBookRepose();
  GV.nextQTimer = setTimeout(newQuestion, 3400);
}
/** Ask the SAME chord again next — uncredited — and book it to come back
    later as well, so the shape that had to be shown gets two more goes. */
function scBookRepose(){
  SC.repose = true;
  if (SC.chord && SC.anchor) scReviewQ.add(scKeyFor(SC.chord, SC.anchor), qCount);
}

/* ---- the game's turn results ---- */
function gvSpawn(){
  if (GV.run && GV.run.state.over) return;   // the over screen owns the scene
  GV.bell = { wobble:0 };
  GV.phase = 'fight';
  GV.spawnAt = performance.now();
  GV.freezeUntil = 0;
  GV.fuseBudget = GAME.createFuseBudget();   // fresh fairness budget per question
  /* A skip carried its remaining fuse here: slide spawnAt back so the new
     question starts with the time the old one had left, not a full refill. */
  if (GV.carryFuseMs != null){
    const ms = gvFuseMs();
    if (ms != null) GV.spawnAt -= Math.max(0, ms - GV.carryFuseMs);
    GV.carryFuseMs = null;
  }
}
function gvZap(){
  GV.phase = 'zap';
  GV.zapT = performance.now();
  GV.zapHit = false;   // the spark burst waits for the ball to LAND (drawScene)
  if (!scaleMode() && GV.promptKind === 'staff'){
    drawStaff(document.getElementById('gvStaff'), q.midi, { showName:true, flat:qFlat });
    /* The answer is in: the picture the player should leave with is the
       named note on the page. */
    gvShowStaff(true);
  }
}
/** The fuse burnt out before the note came. A failed recall, banked
    exactly like a first-attempt miss (unless a miss already did). */
function gvBreach(){
  if (scaleMode()) return scBreach();
  if (!q) return;
  GV.phase = 'breach';
  GV.breachT = performance.now();
  reviewQ.add(q.sn + ':' + q.f, qCount);   // a burnt fuse is a miss: book a comeback
  if (wrongThisQ === 0){
    sess.find.streak = 0; sess.find.asked++;
    recordAnswer(false, q);
  }
  wrongThisQ++;          // the eventual find (next question) must not count clean
  const r = gvJudge('breach');
  gvCue('phut');
  const v = document.getElementById('fVerdict');
  // The correction carries the cost: how many stage lights are still lit.
  const lights = (r && r.hearts != null && GV.run)
    ? ' — ' + r.hearts + ' of ' + GV.run.state.maxHearts + ' stage light' +
      (GV.run.state.maxHearts === 1 ? '' : 's') + ' left'
    : '';
  /* A reading question's correction reads the PAGE as well as the neck — the
     written position is the thing being learned — and the staff redraws with
     the name shown, same as the zap path. */
  let pageRead = '';
  if (GV.promptKind === 'staff'){
    pageRead = ' — written ' + GAME.staffPosName(
      GAME.staffSpec(q.midi, qFlat ? { prefer:'flat' } : undefined).pos);
    drawStaff(document.getElementById('gvStaff'), q.midi, { showName:true, flat:qFlat });
    /* The answer is in: the picture the player should leave with is the
       named note on the page. */
    gvShowStaff(true);
  }
  v.textContent = 'The fuse burnt out — that was ' + dispQ() + ', ' +
    q.sn + ' string, fret ' + q.f + pageRead + lights + '.';
  v.className = 'verdict warn';
  updateFindStats();
  if (r && r.over){
    // The run-ending correction must SURVIVE the over screen — gvGameOver
    // wipes the verdict banner, so the teaching rides into the overlay's
    // facts and the "Lights out" announcement instead of dying in one tick.
    gvGameOver('that last one was ' + dispQ() + ', ' + q.sn + ' string fret ' + q.f);
    return;
  }
  // Long enough to actually READ the correction — this line is the teaching.
  GV.nextQTimer = setTimeout(newQuestion, 2600);
}
function gvGameOver(lastNote){
  GV.phase = 'over';
  GV.srToast = null;   // nothing may talk over the Lights-out announcement
  // The over screen owns the stage: any pending advance would repose a
  // question underneath LIGHTS OUT.
  if (GV.nextQTimer != null){ clearTimeout(GV.nextQTimer); GV.nextQTimer = null; }
  const s = GV.run.state;
  // Belt and braces: gvJudge banks live, but the final judgement must land too.
  const bk = GV.runBestKey || gvBestKey();
  if (s.cleanZaps > (GV.best[bk] || 0)){ GV.best[bk] = s.cleanZaps; gvSave(); }
  /* Two facts, phone-width: notes this set, best first-try run. The XP-survives
     sentence lives below the button at caption size (see #gvOverXp). "1st-try",
     not "clean" — "clean" is engine jargon no other player-facing line uses.
     `lastNote` is the run-ending correction ("that last one was F, E string
     fret 1") — the third breach's teaching, which must not be wiped with the
     verdict banner this function clears below. */
  const unit = scaleMode() ? ' run' : ' note';
  const best = GV.best[bk] || 0;
  const bestUnit = (scaleMode() ? ' run' : ' find') + (best === 1 ? '' : 's');
  const facts = s.zaps + (s.zaps === 1 ? unit : unit + 's') +
    ' · best ' + best + ' 1st-try' + bestUnit;
  const txt = document.getElementById('gvOverText');
  if (txt) txt.textContent = lastNote
    ? lastNote.charAt(0).toUpperCase() + lastNote.slice(1) + ' — ' + facts
    : facts;
  /* A zero-find set gets one warm line — the numbers alone read as a scolding. */
  const xpLine = (s.zaps === 0 ? 'Rough set — it happens. ' : '') +
    'Your XP stays with you — still ' + GAME.levelTitle(GAME.levelFor(GV.xp)) + '.';
  const xpEl = document.getElementById('gvOverXp');
  if (xpEl) xpEl.textContent = xpLine;
  const over = document.getElementById('gvOver');
  if (over) over.classList.remove('hidden');
  /* Spoken AFTER the overlay is up, and it replaces the stale "Next: …" in
     the live region — game over must be heard, not just seen. */
  srAnnounce('Lights out — ' + (lastNote ? lastNote + '. ' : '') + facts + '. ' + xpLine);
  /* The overlay owns the message — a second banner underneath it read as two
     competing game-over screens; the leftover verdict banner goes too. */
  /* The .gv-overon class gates the idle ♪ (a CSS ::before on the empty
     verdict) off while the overlay is up — a decorative quaver twinkling
     under LIGHTS OUT read as a stuck note. gvNewRun lifts it. */
  const secEl = document.getElementById('secFind');
  if (secEl) secEl.classList.add('gv-overon');
  document.getElementById('fQ').textContent = ' ';
  subWrite('');
  const v = document.getElementById('fVerdict');
  v.innerHTML = '&nbsp;'; v.className = 'verdict';
  // The staff slot empties with the question it belonged to.
  gvShowStaff(false);
  // A dead control reads as dead: Show me disables until the restart.
  document.getElementById('fSkip').disabled = true;
  updateBestNote();
  /* LIGHTS OUT is drawn inside a stage that has not moved since the run
     started, so there is nothing to bring into view — the scrollIntoView that
     used to sit here was compensating for a console the settings card had
     already pushed off the screen. */
  const restart = document.getElementById('gvRestart');
  /* Deferred ~400ms: focusing immediately made some screen readers interrupt
     the queued "Lights out —" announcement with the button's name. */
  if (restart) setTimeout(() => {
    if (GV.phase === 'over') restart.focus();
  }, 400);
}

/* ---- pixel scene ----
   One low-resolution canvas, scaled up by CSS with image-rendering:pixelated.
   Sprites are string grids — a char per pixel — so there are no assets to
   load and no build step. Drawn only while the game is on screen. */
function sprite(map, rows){ return { rows, map, h: rows.length }; }
function blit(ctx, sp, x, y, s){
  for (let r = 0; r < sp.rows.length; r++){
    const row = sp.rows[r];
    for (let c = 0; c < row.length; c++){
      const col = sp.map[row[c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
}
/* Stage props — objects, not characters. The bell carries the question,
   the cannon answers it, and the fire is your streak made visible. */
/* The bell: hanger loop, straight shoulder, flared skirt, dark mouth, clapper.
   The highlight is a HOOKED cluster following the shoulder's curve (a straight
   column read as a scratch, not a sheen), and the clapper hangs visibly dark
   below the mouth. */
const BELL = sprite({ b:'#F2A93B', B:'#C77F1F', d:'#8A5A14', h:'#F6E27A', k:'#3A2A12', K:'#170D03' },
  ['......Bhh.......',
   '......B.h.......',
   '.....hbbbbb.....',
   '....hhbbbbbB....',
   '....hbbbbbbB....',
   '....bhbbbbbB....',
   '....bbbbbbbB....',
   '....bbbbbbbB....',
   '...bbbbbbbbbB...',
   '...bbbbbbbbbB...',
   '..hbbbbbbbbbbB..',
   '.hbbbbbbbbbbbBB.',
   '.dBBBBBBBBBBBBd.',
   '....kkkkkkkk....',
   '.......KK.......',
   '......KKKK......']);
/* The cannon: tapered barrel raised toward the bell, muzzle ring with a dark
   bore, breech knob, and a spoked wheel on the near side. */
const CANNON = sprite({ c:'#262A31', C:'#3A3F46', h:'#4E555E', s:'#0C0D10', w:'#5C4630', W:'#3A2A12' },
  ['..............CC..',
   '............hhCCs.',
   '..........hhccCCs.',
   '........hhccccCCs.',
   '......hhccccccCC..',
   '....hhccWWWcccCC..',
   '.chhcccWcwcW......',
   'ccccccWccw..W.....',
   '.cccccWwwWwwW.....',
   '..ccccW..w..W.....',
   '..cc...W.w.W......',
   '........WWW.......']);
/* The tier-5 back rank: the same cannon as ONE flat near-black silhouette —
   a single-colour recolour of the sprite, blitted at 1× with no globalAlpha.
   An alpha-faded multi-tone blit read as four ghost cannons, not a rank in
   the dark. */
const CANNON_SIL = sprite(
  Object.keys(CANNON.map).reduce((m, k) => (m[k] = '#101116', m), {}),
  CANNON.rows);
/* The five stages — one per tier, each an era of the back catalogue.
   Deeper into the set list, darker the stage, harder the neck. Beyond the
   palette each stage carries ONE signature set-piece (props, no characters):
   a leaning pylon, a giant plug, a burning horizon, the bolt, the cannon
   rank — and its own amp-wall arrangement, so the five read structurally
   different, not just recoloured. */
const WORLDS = [
  { name:'High Voltage',    sky:'#221743', sky2:'#140D2B', spot:true,  embers:false, bolt:false,
    pylon:true,  amps:[62, 116] },
  { name:'Powerage',        sky:'#152130', sky2:'#0C131C', spot:true,  embers:false, bolt:false,
    plug:true,   amps:[46, 90, 134] },
  { name:'Highway to Hell', sky:'#451510', sky2:'#280C07', spot:false, embers:true,  bolt:false,
    burnhz:true, darkAmps:true, amps:[70, 114] },
  /* left amp at 64, not 40: the cannon (x14-50), its muzzle flash (x42-59),
     the breech sputter and the misfire puffs all live left of ~60 — parked at
     40 the cabinet sat in the middle of the gun's whole performance. */
  { name:'Back in Black',   sky:'#0D0D11', sky2:'#060608', spot:false, embers:false, bolt:true,
    amps:[64, 150] },
  { name:'For Those About to Rock', sky:'#221607', sky2:'#140D04', spot:true, embers:true, bolt:false,
    cannons:true, amps:[60, 100] },
];
function gvBurst(x, y, color){
  for (let i = 0; i < 12; i++){
    const a = (i / 12) * Math.PI * 2;
    GV.fx.push({ kind:'p', x, y, vx:Math.cos(a) * (18 + Math.random() * 26),
                 vy:Math.sin(a) * (18 + Math.random() * 26) - 20,
                 born:performance.now(), color });
  }
}
function gvToast(text){
  GV.fx.push({ kind:'t', text, born:performance.now() });
  /* The canvas is aria-hidden, so the payout is mirrored to the live region —
     BATCHED with what follows where possible: newQuestion folds a pending
     toast into its own announcement ("+10 XP. Next: play G on the E string"),
     one utterance instead of two writes 650ms apart fighting over one live
     region. If no question follows within ~1.5s the toast speaks on its own
     (still after the verdict, which paints in the judging tick). */
  GV.srToast = text;
  setTimeout(() => {
    if (GV.srToast === text){ GV.srToast = null; srAnnounce(text); }
  }, 1500);
}
/** How long THIS question's fuse burns.
    Notes mode: the pace's own figure, tightened a little by level.
    Scale mode: one fuse covers the WHOLE run — a constant "what does this
    chord want" term plus a small per-note term. The per-note term used to be
    0.3 of a whole note-question EACH, which made a Gig fuse 30 seconds for
    six notes a player can play in under two; it is 0.085 now, so a six-note
    run gets ~12s and an eleven-note run ~17s at Gig, ~6s and ~9s at Encore. */
function gvFuseMs(){
  const ms = GAME.approachMs(GV.pace, GAME.levelFor(GV.xp));
  if (ms == null || !scaleMode()) return ms;
  /* …and the ladder's own factor on top: the last rungs are the same shapes
     with less time to find them, which is what "faster" means up there. */
  return Math.round(ms * (0.35 + 0.085 * scRunLength()) * scStage().fuse);
}
/* The DOM fuse bar — the timer a player can actually read (the canvas cord is
   flavour). Driven from the rAF loop but writes style at most ~5×/s, and the
   aria seconds only when the whole second changes (1×/s). */
const FUSE = { lastStyleAt:0, lastAriaSec:null };
function updateFuseBar(){
  const bar = document.getElementById('gvFuseBar');
  if (!bar) return;
  const secEl = document.getElementById('gvFuseSec');
  const ms = gvFuseMs();
  const show = ms != null && GV.phase === 'fight' && GV.run && !GV.run.state.over;
  if (bar.classList.contains('hidden') !== !show) bar.classList.toggle('hidden', !show);
  if (!show){
    FUSE.lastAriaSec = null;
    if (secEl) secEl.classList.add('hidden');
    return;
  }
  const now = performance.now();
  if (now - FUSE.lastStyleAt < 200) return;
  FUSE.lastStyleAt = now;
  const left = Math.max(0, ms - (now - GV.spawnAt));
  bar.firstElementChild.style.width = (left / ms * 100).toFixed(1) + '%';
  bar.classList.toggle('low', left <= 2000);
  // The last two seconds get an audible nudge too — once per question.
  if (left <= 2000 && !tickedFuseThisQ){ tickedFuseThisQ = true; gvCue('tick'); }
  const sec = Math.ceil(left / 1000);
  // The visible countdown numeral, for the ENTIRE burn: dim grey while the
  // fuse is long (>5s), full contrast in the last five seconds (and red with
  // the bar's .low). It keeps a reserved flex slot beside the bar, so the
  // colour change never reflows anything — and at 18px it is readable at
  // arm's length, which is where a bass player's eyes are.
  if (secEl){
    secEl.classList.remove('hidden');
    secEl.textContent = sec + 's';
    secEl.classList.toggle('early', left > 5000);
  }
  if (left <= 5000 && !saidFiveThisQ){
    saidFiveThisQ = true;
    srAnnounce('5 seconds');   // ONE polite spoken warning per question
    gvCue('tick');             // the audible nudge lands WITH the numeral, not
  }                            // after 12 silent seconds (the 2s tick remains)
  if (sec !== FUSE.lastAriaSec){
    FUSE.lastAriaSec = sec;
    bar.setAttribute('aria-valuenow', sec);
    bar.setAttribute('aria-valuemax', Math.ceil(ms / 1000));
    bar.setAttribute('aria-valuetext', sec + ' second' + (sec === 1 ? '' : 's') + ' left');
  }
}
/** Is a reference card open on top of the game? The Scale card and the Note
    map are study, not play — the fuse waits for them. */
function gvStudyOpen(){
  const a = document.getElementById('gvScaleStudy');
  const b = document.getElementById('gvMap');
  return !!((a && a.open) || (b && b.open));
}
function gvFrame(t){
  GV.raf = null;
  if (mode !== 'find') return;    // the loop dies with the tab; setMode restarts it
  /* Out-of-tune fairness: while the player is being told their INSTRUMENT is
     the problem, the fuse holds — spawnAt slides forward by each frame's dt,
     so the remaining time stands still until the question moves on. The dt is
     clamped: a frame gap (tab hop, jank) must not smuggle in extra credit. */
  const dtRaw = GV.lastFrame ? t - GV.lastFrame : 0;
  GV.lastFrame = t;
  /* Wrong-verdict fairness rides the same rail: a 'no' verdict freezes the
     fuse for ~1s so reading the correction is not paid for in fuse time.
     BOTH holds are budgeted per question (BassGame.createFuseBudget): the
     out-of-tune hold expires after ~4s and wrong-verdict freezes cap at ~3s,
     after which consume() grants nothing and the fuse resumes — holding a
     wrong note (or spamming them) can no longer stall the fuse forever. */
  if (GV.phase === 'fight'){
    const dt = Math.max(0, Math.min(250, dtRaw));
    /* STUDYING IS NOT PLAYING. Opening the Scale card or the Note map
       mid-question used to cost clock: the fuse burnt while the player was
       reading the very thing that answers it. While a study card is open the
       fuse holds on the same spawnAt slide as the wrong-note freeze — and
       unbudgeted, because the card being open is a deliberate, visible state
       the player ends by closing it. */
    if (gvStudyOpen()){
      GV.spawnAt += dt;
    } else if (outOfTuneThisQ){
      GV.spawnAt += GV.fuseBudget ? GV.fuseBudget.consume('tune', dt) : dt;
    } else if (performance.now() < GV.freezeUntil){
      GV.spawnAt += GV.fuseBudget ? GV.fuseBudget.consume('wrong', dt) : dt;
    }
  }
  drawScene(t);
  updateFuseBar();
  if (GV.phase === 'fight' && GV.run && !GV.run.state.over){
    const ms = gvFuseMs();
    if (ms != null && performance.now() - GV.spawnAt >= ms) gvBreach();
  }
  GV.raf = requestAnimationFrame(gvFrame);
}
function gvLoop(on){
  if (on && !GV.raf){ GV.lastFrame = 0; GV.raf = requestAnimationFrame(gvFrame); }
  if (!on && GV.raf){ cancelAnimationFrame(GV.raf); GV.raf = null; }
}
/* The fuse pauses while the TAB is hidden — same principle as the existing
   tab-hop forgiveness: time the player could not see is not time served. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden){
    if (GV.hiddenAt == null) GV.hiddenAt = performance.now();
  } else if (GV.hiddenAt != null){
    if (mode === 'find' && GV.phase === 'fight') GV.spawnAt += performance.now() - GV.hiddenAt;
    GV.hiddenAt = null;
  }
});
/* ---- fitting the console to the screen ----
   The console's height must be CONSTANT while playing, and it must fit
   between the sticky header and the bottom nav (which is a left rail on a
   desktop, hence --nav-h:0 there). Two numbers are free to answer the
   VIEWPORT — never the game state — and this is where both are chosen:

     · the scene's integer pixel scale (1× / 2× / 3× of the 320×150 backing
       store: every game pixel must be a whole number of screen pixels, so
       the choice is which whole number, not whether);
     · --gv-media-h, the staff slot, on viewports too short to hold a
       full-size staff.

   Width alone used to pick the scale, which is how a 1280×800 laptop ended
   up with a 962×452 stage and a console 792px tall. Height is the other half
   of the answer now: walk a ladder of (staff slot, scene size) pairs, best
   first, and take the first rung whose whole console fits between the header
   and the nav. */
const GV_MEDIA_STEPS = [154, 138, 122, 106, 96, 84];
/* Scale mode's compartment holds a chord chart or a five-fret box drawing,
   neither of which needs a full staff's height — so its ladder starts lower.
   It also goes FURTHER down than Notes mode's, because scale mode carries two
   rows Notes mode does not (this compartment, which the Names prompt removes
   entirely, and the pip row): the rungs those two cost have to exist somewhere
   or a 414×736 phone puts Show me under the nav, which is exactly what it did.
   The box drawing sizes its own canvas to whatever it gets (scDrawBox), and
   the chart's type steps down with it (the CSS below), so the low rungs are
   small rather than clipped. */
const GV_MEDIA_STEPS_SCALE = [132, 118, 104, 96, 88, 80, 74, 66, 58, 52];
const GV_INFO_MIN = 300;    // the read column never squeezes below this
function gvNavH(){
  const v = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--nav-h'));
  return isNaN(v) ? 0 : v;
}
function gvFitScene(){
  const cv = document.getElementById('gvScene');
  const wrap = cv && cv.parentElement;
  const card = document.querySelector('#secFind .gv-card');
  const sec = document.getElementById('secFind');
  if (!wrap || !card || !sec) return;
  const cardW = card.clientWidth;
  if (!cardW) return;   // section hidden — setMode('find') calls again on entry
  const cs = getComputedStyle(card);
  const inner = cardW - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const wide = window.matchMedia('(min-width:1000px)').matches;
  /* On a desktop the stage shares the card with the read column, so the width
     it may claim is what is left after that column and the gap. */
  const forStage = wide ? inner - GV_INFO_MIN - parseFloat(cs.columnGap || 20) : inner;
  const maxScale = Math.floor((forStage - 2) / 320);      // 2 = the 1px borders

  /* A scene size is a whole multiple of the 320×150 backing store — every
     game pixel is exactly N screen pixels — except on screens too short to
     hold even 1×, where the last two rungs give up integer scaling rather
     than give up the console. `null` = fall back to the card's width, which
     is what a sub-320px phone has always done. */
  const setScene = (c) => {
    if (!c){
      cv.style.width = '100%'; cv.style.height = 'auto';
      wrap.style.width = ''; sec.style.removeProperty('--gv-stage-w');
      return;
    }
    cv.style.width = c.w + 'px';
    cv.style.height = c.h + 'px';
    wrap.style.width = (c.w + 2) + 'px';
    // The HUD and the fuse are the stage's own instruments: the column they
    // share is exactly the scene's width, so they line up with its edges.
    sec.style.setProperty('--gv-stage-w', (c.w + 2) + 'px');
  };
  const setMedia = (h) => {
    sec.style.setProperty('--gv-media-h', h + 'px');
    /* A compartment this short cannot hold the chart's header line as well as
       its bars and the rule under them, so the header goes — it is the one
       line whose content the chart's own aria-label repeats. A VIEWPORT
       answer, like every other number this function picks: nothing the player
       does inside the game can change it. */
    sec.classList.toggle('gv-tight', h < 70);
  };
  /* Fits = it sits above the bottom nav. Measured in DOCUMENT coordinates,
     because "fits" must mean "fits with the page at the top" — the whole point
     is that the page never has to move. Two targets: the whole console, and —
     for a screen too short for that — the PLAY area, HUD through the buttons.
     The session figures below them are a lookback, not part of the loop, and
     they are the one thing allowed off the bottom of a small phone. */
  const limit = () => window.innerHeight - gvNavH() - 4;
  const bottomOf = (el) => el.getBoundingClientRect().bottom + (window.scrollY || 0);
  const ctl = document.querySelector('#secFind .gv-controls');
  const fitsCard = () => bottomOf(card) <= limit();
  const fitsPlay = () => !ctl || bottomOf(ctl) <= limit();

  /* The ladder, best rung first. Full-size coach slot before a big scene — the
     staff's legibility is a floor, the scene's size is a preference — and both
     of those before giving up integer scaling, which is why the ladder is run
     twice: once over whole-numbered scenes, and only if not even the PLAY area
     (HUD through the buttons) can be shown that way, again over two fractional
     sizes. A phone that has to choose keeps its pixels square and lets the
     session figures sit below the fold; a phone too short even for that gets a
     softer stage instead of a console it has to chase down the page. */
  const steps = scaleMode() ? GV_MEDIA_STEPS_SCALE : GV_MEDIA_STEPS;
  const ladder = (scenes) => {
    let play = null;
    for (const h of steps){
      for (const c of scenes){
        setMedia(h); setScene(c);
        if (fitsCard()) return 'card';
        if (!play && fitsPlay()) play = [h, c];
      }
    }
    if (play){ setMedia(play[0]); setScene(play[1]); return 'play'; }
    return null;
  };
  const whole = [];
  for (let s = maxScale; s >= 1; s--) whole.push({ w:320 * s, h:150 * s });
  if (!whole.length) whole.push(null);      // narrower than 1×: card-width fit
  const soft = [120, 96, 82, 70, 60].map(px => ({ w: Math.round(px * 320 / 150), h: px }));
  if (!scaleMode()){
    if (ladder(whole)) return;
    ladder(soft);
    return;
  }
  /* ---- SCALE MODE'S OWN SEARCH ----
     This mode carries two rows Notes mode's Names prompt does not have at all:
     the compartment the chart lives in, and the pips. That room has to come
     from somewhere, and a phone that spends it all on the compartment ends up
     with a 132px chart above a postage-stamp stage — so here the SCENE is the
     outer loop (biggest first) and the compartment takes what is left, the
     opposite of the staff rule above. Two passes, because a legible chart is
     worth more than the last few pixels of stage: first with compartments big
     enough to hold the chart comfortably, then with the small ones. A desktop
     takes the first pair it tries; a 414×736 phone ends up in the second pass
     with a small chart and a small stage, and its whole console on screen —
     which is where Show me used to sit 13px UNDER the nav. */
  const scenes = whole.concat(soft);
  let play = null;
  const pass = (list) => {
    for (const c of scenes){
      for (const h of list){
        setMedia(h); setScene(c);
        if (fitsCard()) return true;
        if (!play && fitsPlay()) play = [h, c];
      }
    }
    return false;
  };
  if (pass(steps.filter(h => h >= 74))) return;
  if (pass(steps.filter(h => h < 74))) return;
  if (play){ setMedia(play[0]); setScene(play[1]); }
}
window.addEventListener('resize', gvFitScene);
/** A circle built from 2px blocks, optionally rim-only — bubbles, pixel-style. */
function pxCircle(ctx, cx, cy, r, fill, rim){
  for (let dy = -r; dy <= r; dy += 2){
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (fill){ ctx.fillStyle = fill; ctx.fillRect(cx - w, cy + dy, w * 2, 2); }
    if (rim){ ctx.fillStyle = rim; ctx.fillRect(cx - w, cy + dy, 2, 2);
              ctx.fillRect(cx + w - 2, cy + dy, 2, 2); }
  }
}
/** One pixel flame tongue: stacked 2px rows, ember red up to a pale tip.
    `wMax`/`cols` let one function draw both the deep back layer and the hot
    front layer of the wall. Tall tongues get a pale core near the base. */
const FLAME_HOT  = ['#6E1B12', '#A6281A', '#DE5226', '#F2A93B', '#F6E27A'];
/* Past the height cap the fire stops growing UP and starts burning WHITE:
   two hotter ramps the streak climbs through from 8 to 15 (item: growth
   must keep testifying even once the wall is as tall as it gets). */
const FLAME_HOT2 = ['#6E1B12', '#A6281A', '#DE5226', '#F6E27A', '#FBEFC0'];
const FLAME_HOT3 = ['#8E2A1F', '#DE5226', '#F2A93B', '#FBEFC0', '#FFFBEE'];
const FLAME_DEEP = ['#4A120C', '#6E1B12', '#8E2A1F', '#A83A24'];
function pxFlame(ctx, x, baseY, h, flick, wMax, cols, core, seed){
  const C = cols || FLAME_HOT, wm = wMax || 12;
  const sd = seed | 0;
  const skew = ((sd * 7 + 3) % 5) - 2;               // each tongue leans its own way
  for (let k = 0; k < h; k += 2){
    const f = k / Math.max(2, h);
    // irregular step widths — a per-row jitter breaks the symmetric pine
    const jag = ((k >> 1) * 5 + sd * 11) % 3 - 1;
    const w = Math.max(2, Math.round(wm * (1 - f * f)) + jag);
    const wob = (flick ? Math.round(Math.sin(flick + k) * (f * 2.5)) : 0)
              + Math.round(f * f * skew);            // the tip skews off-centre
    ctx.fillStyle = C[Math.min(C.length - 1, Math.floor(f * C.length))];
    ctx.fillRect(x - (w >> 1) + wob, baseY - k - 2, w, 2);
  }
  if ((!cols || core) && h > 10){
    const cc = core || ['#F6E27A', '#F2A93B'];
    const ch = Math.round(h * 0.45);
    for (let k = 0; k < ch; k += 2){
      const f = k / ch;
      const w = Math.max(2, Math.round((wm * 0.45) * (1 - f)));
      ctx.fillStyle = f < 0.55 ? cc[0] : cc[1];
      ctx.fillRect(x - (w >> 1), baseY - k - 2, w, 2);
    }
  }
}
/** A compact pixel accidental — ♯ or ♭ — about 5px wide, drawn beside a
    13px letter (the bell's name label). Cramming two glyphs of font text
    into the skirt turned the sharp into a smudge; a drawn glyph stays crisp. */
function pxAcc(ctx, x, y, glyph, color){
  ctx.fillStyle = color;
  if (glyph === '♯'){
    ctx.fillRect(x + 1, y, 1, 6); ctx.fillRect(x + 3, y, 1, 6);
    ctx.fillRect(x, y + 1, 5, 1); ctx.fillRect(x, y + 3, 5, 1);
  } else {
    ctx.fillRect(x, y - 1, 1, 7);              // stem
    ctx.fillRect(x + 1, y + 3, 2, 1);          // bowl top
    ctx.fillRect(x + 3, y + 4, 1, 1);          // bowl right
    ctx.fillRect(x + 1, y + 5, 2, 1);          // hook back to the stem
  }
}
/** A chord symbol across the bell's skirt: the root LETTER at full size (it is
    what the eye finds first), a drawn accidental beside it, and the quality
    ("m7", "5") smaller behind — all measured and centred as one word, because
    the skirt is 26 game-pixels wide and a symbol that runs off it is not a
    question. */
function drawChordOnBell(ctx, sym, cx, baseY, ink){
  if (!sym) return;
  const m = /^([A-G])([♯♭]?)(.*)$/.exec(sym);
  if (!m) return;
  const [, letter, acc, rest] = m;
  const wLetter = 8, wAcc = acc ? 5 : 0, wRest = rest.length * 5;
  let x = cx - Math.round((wLetter + wAcc + wRest) / 2);
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(letter, x, baseY);
  x += wLetter;
  if (acc){ pxAcc(ctx, x, baseY - 8, acc, ink); x += wAcc; }
  if (rest){
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = ink;
    ctx.fillText(rest, x, baseY);
  }
  ctx.textAlign = 'center';
}
/** A stepped thick line out of 2px rows — the lightning bolt is built from these. */
function pxLine(ctx, x0, y0, x1, y1, w, color){
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2));
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i++){
    const x = Math.round(x0 + (x1 - x0) * i / steps), y = Math.round(y0 + (y1 - y0) * i / steps);
    ctx.fillRect(x - (w >> 1), y, w, 2);
  }
}
function drawScene(t){
  const cv = document.getElementById('gvScene');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, FLOOR = 126;
  const world = WORLDS[Math.min(gvTier(), WORLDS.length - 1)];
  const now = performance.now();
  const drift = REDUCED ? 0 : 1;             // ambient motion switch
  ctx.clearRect(0, 0, W, H);
  // one 1px screen-shake frame the instant the cannon goes off — WITH the
  // bang: the shot's first ~80ms are pre-fire wind-up (fireAge < 0), and a
  // shake during the sputter made the stage flinch before anything fired
  const shakeAge = GV.phase === 'zap' ? (now - GV.zapT) - 80 : -1;
  const shake = !REDUCED && shakeAge >= 0 && shakeAge < 18;
  ctx.save();
  if (shake) ctx.translate(1, 0);

  // backdrop: banded sky, darker toward the boards, a faint horizon seam
  ctx.fillStyle = world.sky;  ctx.fillRect(0, 0, W, FLOOR);
  ctx.fillStyle = world.sky2; ctx.fillRect(0, 52, W, FLOOR - 52);
  ctx.fillStyle = world.sky;  ctx.globalAlpha = .5; ctx.fillRect(0, 52, W, 10); ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, FLOOR - 18, W, 18);
  // Highway to Hell: the sky itself burns low over the horizon
  if (world.embers){
    ctx.fillStyle = 'rgba(228,103,92,.14)'; ctx.fillRect(0, FLOOR - 34, W, 34);
    ctx.fillStyle = 'rgba(242,169,59,.10)'; ctx.fillRect(0, FLOOR - 16, W, 16);
  }
  // Back in Black: one huge white-hot bolt on the backdrop — the stage's whole
  // identity, so it GLOWS: a blue-grey band each side of the core, and (motion
  // permitting) a two-frame gutter of alpha now and then, like an arc lamp.
  if (world.bolt){
    // a barely-visible one-value noise dither, so the void reads as AIR
    // rather than dead flat fill (static — it is texture, not motion)
    ctx.fillStyle = 'rgba(232,226,212,.03)';
    for (let i = 0; i < 110; i++){
      const nx = (i * 53 + ((i * i) % 17)) % W;
      const nyv = (i * 89 + ((i * 7) % 23)) % (FLOOR - 16);
      if ((i * 31) % 5 < 2) continue;
      ctx.fillRect(nx, nyv, 1, 1);
    }
    // The final segment lands on the near amp's SHOULDER — where the scorch
    // sits — so the strike and its mark tell one story.
    const seg = [[184, 12], [172, 34], [180, 48], [158, 66], [166, 78], [151, 87]];
    // the arc lamp re-STRIKES: a couple of gutter frames every ~4 seconds
    const flicker = !REDUCED && Math.floor(t / 130) % 31 < 2;
    for (let i = 0; i < seg.length - 1; i++)
      pxLine(ctx, seg[i][0], seg[i][1], seg[i + 1][0], seg[i + 1][1], 9, 'rgba(232,226,212,.10)');
    for (let i = 0; i < seg.length - 1; i++)
      pxLine(ctx, seg[i][0], seg[i][1], seg[i + 1][0], seg[i + 1][1], 6, 'rgba(148,170,205,.20)');
    ctx.globalAlpha = flicker ? 0.72 : 1;
    for (let i = 0; i < seg.length - 1; i++)
      pxLine(ctx, seg[i][0], seg[i][1], seg[i + 1][0], seg[i + 1][1], 4, '#E8E2D4');
    ctx.globalAlpha = 1;
    pxLine(ctx, 172, 34, 190, 52, 5, 'rgba(232,226,212,.10)');
    pxLine(ctx, 172, 34, 189, 51, 3, 'rgba(148,170,205,.20)');
    pxLine(ctx, 172, 34, 188, 50, 2, 'rgba(232,226,212,.75)');
  }

  // Powerage: the giant plug not quite home in its socket, its slack cable
  // sagging right across the backdrop — drawn BEFORE the amp wall, because a
  // cable hangs behind the backline, not through it. The socket PLATE is
  // drawn later still, after the light cones — a solid plate must not let
  // the bell's beam bleed through it.
  if (world.plug){
    // The whole socket assembly sits 6px lower than it used to: the bell
    // hangs deeper on its full chain now, and the plate must clear its mouth.
    ctx.fillStyle = '#3A3F46'; ctx.fillRect(178, 70, 16, 14);               // plug body
    ctx.fillStyle = '#262A31'; ctx.fillRect(178, 70, 16, 3);
    ctx.fillStyle = '#4E555E'; ctx.fillRect(194, 73, 8, 2); ctx.fillRect(194, 79, 8, 2);  // prongs
    ctx.fillStyle = '#4A4136';                                              // the slack cable
    // Dense sampling — one 2px link per ~1.5px of run — so the cable reads
    // as one connected rope, never a dotted line.
    for (let i = 0; i <= 120; i++){
      const u = i / 120;
      const cx = 178 * (1 - u);
      const cy = (1 - u) * (1 - u) * 77 + 2 * u * (1 - u) * 120 + u * u * 82;
      ctx.fillRect(Math.round(cx), Math.round(cy), 2, 2);
    }
  }

  // Highway to Hell: the horizon itself is on fire — a fringe of low tongues
  // burning along the back of the stage under the ember bands. Drawn BEFORE
  // the amp wall: a horizon burns behind the backline, not in front of it.
  if (world.burnhz){
    for (let x = 0; x < W; x += 7){
      const hh = 3 + ((x * 13) % 6) + (drift ? Math.round(Math.sin(t / 380 + x * 0.7) * 1.5) : 0);
      // two-frame shimmer, per clump, motion-gated: the fire BREATHES
      const shim = drift && Math.floor(t / 240 + (x >> 3)) % 2 === 0;
      ctx.fillStyle = 'rgba(110,27,18,.40)'; ctx.fillRect(x, FLOOR - 16 - hh, 6, hh);   // deep base value
      ctx.fillStyle = shim ? 'rgba(222,82,38,.42)' : 'rgba(200,72,45,.38)';
      ctx.fillRect(x, FLOOR - 16 - hh, 5, hh);
      ctx.fillStyle = shim ? 'rgba(246,226,122,.24)' : 'rgba(242,169,59,.20)';
      ctx.fillRect(x + 1, FLOOR - 16 - (hh >> 1), 3, hh >> 1);
      // a 2px tapered tip, at a per-clump offset, so a still frame reads as
      // ragged flame — not a picket fence of flat-topped posts
      ctx.fillStyle = shim ? 'rgba(222,82,38,.38)' : 'rgba(200,72,45,.32)';
      ctx.fillRect(x + 1 + ((x * 7) % 3), FLOOR - 16 - hh - 2, 2, 2);
      if (((x * 11) % 4) === 0){                             // the odd taller lick
        ctx.fillStyle = 'rgba(242,169,59,.18)';
        ctx.fillRect(x + 2, FLOOR - 16 - hh - 4, 1, 2);
      }
    }
  }

  // the amp wall: Marshall-ish full stacks — head with knobs, two cabs.
  // Count and placement are per stage (see WORLDS), so the five backdrops
  // differ structurally; Highway to Hell pushes its wall into the dark.
  for (const ax of (world.amps || [62, 116])){
    ctx.fillStyle = '#0B0A08'; ctx.fillRect(ax + 1, FLOOR - 1, 30, 2);      // ground shadow
    ctx.fillStyle = '#14110F'; ctx.fillRect(ax, FLOOR - 37, 32, 37);
    ctx.fillStyle = '#241E18'; ctx.fillRect(ax + 2, FLOOR - 35, 28, 6);     // head panel
    ctx.fillStyle = '#F2A93B';
    for (let g = 0; g < 4; g++) ctx.fillRect(ax + 5 + g * 6, FLOOR - 33, 2, 2);  // knobs
    ctx.fillStyle = '#E4675C'; ctx.fillRect(ax + 27, FLOOR - 33, 2, 2);     // power lamp
    for (const cy of [FLOOR - 27, FLOOR - 14]){                             // two cabs
      ctx.fillStyle = '#1C1712'; ctx.fillRect(ax + 2, cy, 28, 11);
      ctx.fillStyle = '#332C24';
      for (let g = 0; g < 5; g++) ctx.fillRect(ax + 4 + g * 5, cy + 1, 2, 9);
      ctx.fillStyle = '#3A342E';                                            // corner caps
      ctx.fillRect(ax + 2, cy, 2, 2); ctx.fillRect(ax + 28, cy, 2, 2);
      ctx.fillRect(ax + 2, cy + 9, 2, 2); ctx.fillRect(ax + 28, cy + 9, 2, 2);
    }
    if (world.darkAmps){ ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(ax, FLOOR - 37, 32, 37); }
  }
  // Back in Black: the bolt EARTHS on the near amp — a scorch on its
  // shoulder, a glow at the strike point, and the amp itself LIT by it:
  // a lit top cap and blue-grey knob glints, solid pixels in the same
  // grammar the light cones use on their amps.
  if (world.bolt){
    ctx.fillStyle = '#060608';                                              // scorch pixels
    ctx.fillRect(148, FLOOR - 38, 6, 2); ctx.fillRect(150, FLOOR - 36, 3, 1);
    pxCircle(ctx, 151, FLOOR - 37, 8, 'rgba(148,170,205,.07)', null);
    pxCircle(ctx, 151, FLOOR - 37, 4, 'rgba(232,226,212,.08)', null);
    ctx.fillStyle = '#4A4136'; ctx.fillRect(150, FLOOR - 37, 32, 1);        // lit top cap
    ctx.fillStyle = '#94AACD';                                              // knob glints
    for (let g = 0; g < 4; g++) ctx.fillRect(155 + g * 6, FLOOR - 33, 1, 1);
  }

  // High Voltage: a leaning power pylon stage right, arc sparks jumping
  // between its insulators (behind the bell; the bell is drawn later).
  if (world.pylon){
    const px0 = 291, lean = 6;                                   // leans stage-left
    pxLine(ctx, px0 - 14, FLOOR, px0 - 4 - lean, 24, 3, '#332C24');
    pxLine(ctx, px0 + 14, FLOOR, px0 + 4 - lean, 24, 3, '#332C24');
    pxLine(ctx, px0 - 12, FLOOR - 16, px0 + 12, FLOOR - 32, 2, '#2A241E');  // lattice
    pxLine(ctx, px0 + 12, FLOOR - 16, px0 - 12, FLOOR - 32, 2, '#2A241E');
    pxLine(ctx, px0 - 10, FLOOR - 44, px0 + 10, FLOOR - 58, 2, '#2A241E');
    pxLine(ctx, px0 + 10, FLOOR - 44, px0 - 10, FLOOR - 58, 2, '#2A241E');
    ctx.fillStyle = '#332C24'; ctx.fillRect(px0 - 17 - lean, 29, 34, 3);    // crossarm
    ctx.fillStyle = '#4E555E';
    for (const ix of [-13, 0, 13]) ctx.fillRect(px0 + ix - lean - 1, 32, 3, 4);
    if (drift){                                                  // the arcs spit
      // a 1px ZIGZAG — three short segments stepping ±1y — because a real
      // arc jumps, and a dead-straight hair read as a scratch on the sky
      if (Math.floor(t / 130) % 6 === 0){
        ctx.fillStyle = '#BFD6F2';
        ctx.fillRect(px0 - 11 - lean, 33, 4, 1);
        ctx.fillRect(px0 - 7 - lean, 32, 4, 1);
        ctx.fillRect(px0 - 3 - lean, 33, 3, 1);
      }
      if (Math.floor(t / 170) % 7 === 0){
        ctx.fillStyle = '#BFD6F2';
        ctx.fillRect(px0 + 1 - lean, 34, 4, 1);
        ctx.fillRect(px0 + 5 - lean, 33, 4, 1);
        ctx.fillRect(px0 + 9 - lean, 34, 3, 1);
      }
    } else {
      ctx.fillStyle = 'rgba(191,214,242,.45)';
      ctx.fillRect(px0 - 11 - lean, 33, 3, 1);
      ctx.fillRect(px0 - 8 - lean, 32, 3, 1);
      ctx.fillRect(px0 - 5 - lean, 33, 2, 1);
    }
  }

  /* Light rig — ONE lighting grammar on every stage: each cone hangs from a
     visible lamp fixture on the truss. The bell gets its own rig lamp on ALL
     five stages (the bell never emits light of its own); the brighter
     drifting front-of-house cone is the spot-stages' extra. Each cone also
     LIGHTS WHAT IT TOUCHES: amps under a cone get lit-pixel tops and fronts,
     and the floor pool is a two-tone lit patch, not a wash. */
  const cones = [{ x0: 230, dim: world.spot ? 1 : 0.75, bell: true }];   // dead over the bell (bx = 230)
  if (world.spot) cones.unshift({ x0: Math.round(78 + (drift ? Math.sin(t / 3000) * 8 : 0)), dim: 1 });
  for (const cone of cones){
    const x0 = cone.x0;
    ctx.fillStyle = '#14110F'; ctx.fillRect(x0 - 5, 11, 10, 6);           // the fixture
    ctx.fillStyle = '#0B0A08'; ctx.fillRect(x0 - 5, 11, 10, 1);           // housing cap
    // the lens hot-pixels go dark on the over screen — lights out means out
    if (GV.phase !== 'over'){ ctx.fillStyle = '#F6E27A'; ctx.fillRect(x0 - 2, 16, 4, 2); }
    if (GV.phase === 'over') continue;                                    // no beams either
    for (const [spread, a] of [[0.30, .04], [0.19, .05], [0.09, .06]]){
      ctx.fillStyle = 'rgba(242,169,59,' + (a * cone.dim).toFixed(3) + ')';
      for (let y = 18; y < FLOOR; y += 3){
        const half = 2 + Math.round((y - 18) * spread);
        /* The bell blocks its own lamp: below the bell's skirt (y≈58) the
           beam's centre ±14px is the bell's shadow — the cone rows there are
           drawn as two wings, or not at all where the cone is narrower than
           the bell. Only the bell's own rig lamp casts this shadow. */
        if (cone.bell && y >= 58){
          const inner = Math.min(half, 14);
          const wing = half - inner;
          if (wing > 0){
            ctx.fillRect(x0 - half, y, wing, 3);
            ctx.fillRect(x0 + inner, y, wing, 3);
          }
          continue;
        }
        ctx.fillRect(x0 - half, y, half * 2, 3);
      }
    }
    const half = 2 + Math.round((FLOOR - 18) * 0.30);                     // the pool
    ctx.fillStyle = 'rgba(242,169,59,.10)'; ctx.fillRect(x0 - half, FLOOR, half * 2, 3);
    ctx.fillStyle = 'rgba(246,226,122,.08)'; ctx.fillRect(x0 - (half >> 1), FLOOR, half, 2);
    // amps inside the footprint catch the light: lit top caps, warmer head
    // panel, brighter knobs — solid lit-variant pixels, not another wash
    for (const ax of (world.amps || [62, 116])){
      const halfTop = 2 + Math.round(((FLOOR - 37) - 18) * 0.30);
      const o0 = Math.max(ax, x0 - halfTop), o1 = Math.min(ax + 32, x0 + halfTop);
      if (o1 - o0 < 4) continue;
      ctx.fillStyle = '#4A4136'; ctx.fillRect(o0, FLOOR - 37, o1 - o0, 1);  // lit top cap
      ctx.fillStyle = '#332A20'; ctx.fillRect(Math.max(o0, ax + 2), FLOOR - 35, Math.min(o1, ax + 30) - Math.max(o0, ax + 2), 2);
      ctx.fillStyle = '#F6E27A';                                            // knobs catch it
      for (let g = 0; g < 4; g++){
        const kx = ax + 5 + g * 6;
        if (kx >= o0 && kx + 2 <= o1) ctx.fillRect(kx, FLOOR - 33, 2, 2);
      }
      ctx.fillStyle = 'rgba(246,226,122,.10)';                              // cab fronts
      ctx.fillRect(o0, FLOOR - 27, o1 - o0, 24);
    }
  }
  // Powerage's socket plate, over the beams: solid, outlined, screwed on.
  if (world.plug){
    ctx.fillStyle = '#0A0F16'; ctx.fillRect(205, 61, 28, 34);               // 1px dark outline
    ctx.fillStyle = '#2E3F52'; ctx.fillRect(206, 62, 26, 32);               // solid plate
    ctx.fillStyle = '#0C131C'; ctx.fillRect(213, 72, 4, 9); ctx.fillRect(221, 72, 4, 9);
    ctx.fillStyle = '#4E555E'; ctx.fillRect(218, 64, 2, 2); ctx.fillRect(218, 90, 2, 2);  // screws
    // A solid plate CASTS: a soft 2px dark band directly beneath it, so the
    // bell-lamp's beam does not read as passing straight through the metal.
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(205, 95, 28, 1);
    ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(205, 96, 28, 1);
  }
  // Highway to Hell (and the cannons' stage): embers climbing off the fire
  if (world.embers){
    for (let i = 0; i < 14; i++){
      // never into the top 12px — embers die before the truss
      const span = FLOOR - 20;
      const ey = (i * 41 + (drift ? t / (48 + (i % 3) * 15) : 0)) % span;
      const ex = (i * 71 + 19 + (drift ? Math.round(Math.sin(t / 700 + i) * 3) : 0)) % W;
      // two-frame twinkle, per ember, staggered so they never blink as one
      const tw = drift ? (Math.floor(t / 170 + i * 3) % 2 ? 1 : 0.5) : 1;
      ctx.fillStyle = 'rgba(242,169,59,' + ((0.25 + (i % 3) * 0.15) * tw).toFixed(2) + ')';
      const sz = i % 3 === 2 ? 2 : 1;      // mostly 1px motes, the odd 2px coal
      ctx.fillRect(ex, FLOOR - 8 - ey, sz, sz);
    }
  }
  // the rig beam the bell hangs from
  ctx.fillStyle = '#241E18'; ctx.fillRect(0, 8, W, 4);
  ctx.fillStyle = '#3A342E'; ctx.fillRect(0, 8, W, 1);

  // stage floor: dark boards, a lip of light at the edge
  ctx.fillStyle = '#2A1D17'; ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.fillStyle = '#1C1310';
  for (let x = 10; x < W; x += 26) ctx.fillRect(x, FLOOR + 2, 2, H - FLOOR - 2);
  ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fillRect(0, FLOOR + 1, W, 1);      // board shadow line
  ctx.fillStyle = 'rgba(246,242,236,.10)'; ctx.fillRect(0, FLOOR, W, 2);

  // For Those About to Rock: a rank of cannon silhouettes at the back,
  // with their ammunition stacked in pyramids beside them
  if (world.cannons){
    // The back rank blits at 1× — INTEGER scale only, like every sprite —
    // and as TRUE silhouettes: one flat near-black recolour (CANNON_SIL),
    // no globalAlpha. Silhouette first; the fade came second and lost.
    for (const cx of [152, 188, 224, 260]) blit(ctx, CANNON_SIL, cx, FLOOR - 12, 1);
    const ball = (x, y) => {
      ctx.fillStyle = '#101114'; ctx.fillRect(x, y, 5, 5);
      ctx.fillStyle = '#4E555E'; ctx.fillRect(x + 1, y + 1, 2, 2);   // glint
    };
    for (const [bx0, n] of [[138, 3], [268, 4]]){
      for (let row = 0; row < n; row++)                              // pyramid
        for (let i = 0; i < n - row; i++)
          ball(bx0 + row * 3 + i * 6, FLOOR - 5 - row * 5);
    }
  }

  // the fuse: a twisted rope burning right to left toward the cannon,
  // ash where it has already burnt, a hot spark head spitting sparks.
  // Drawn BEFORE the fire block: the streak's wall of fire stands at the
  // stage front, and the cord must never paint over it.
  const fuseMsNow = gvFuseMs();
  if (fuseMsNow != null && GV.phase === 'fight'){
    const p = Math.min(1, (now - GV.spawnAt) / fuseMsNow);
    /* x0 22, not 46: the cord's tail climbs to the BREECH — the back of the
       gun (x≈14–22) — not to bare boards under the muzzle. */
    const x0 = 22, x1 = 150, fy = FLOOR + 9;
    const sparkX = Math.round(x1 - (x1 - x0) * p);
    ctx.fillStyle = 'rgba(0,0,0,.35)';                       // seats it on the boards —
    ctx.fillRect(x0, fy + 3, Math.max(0, sparkX - x0), 1);   // under the REMAINING cord only
    /* the cord's last ~6px CURVE UP toward the breech, so the rope visibly
       connects to the gun instead of starting from bare boards */
    const TAIL = [[-2, -2], [-4, -4], [-5, -6], [-6, -8]];
    for (const [tx, ty] of TAIL){
      ctx.fillStyle = '#3A2A12'; ctx.fillRect(x0 + tx, fy + ty - 1, 2, 4);
    }
    for (const [tx, ty] of TAIL){
      ctx.fillStyle = '#EED25E'; ctx.fillRect(x0 + tx, fy + ty, 2, 2);
    }
    // the unburnt cord: a cream core in a dark outline — readable at arm's
    // length, unlike the old brown-on-brown twist
    for (let x = x0; x < sparkX; x += 2){
      const dy = (x >> 2) & 1;
      ctx.fillStyle = '#3A2A12'; ctx.fillRect(x, fy - 1 + dy, 2, 4);   // outline
    }
    for (let x = x0; x < sparkX; x += 2){
      const dy = (x >> 2) & 1;
      ctx.fillStyle = ((x >> 1) & 1) ? '#F6E27A' : '#EED25E';          // cream core
      ctx.fillRect(x, fy + dy, 2, 2);
    }
    // the burnt side leaves a short ASH STUB at the spark — 4px of grey,
    // then nothing: enough residue to say "burnt", none to misread as
    // cord left to burn.
    ctx.fillStyle = '#575044'; ctx.fillRect(sparkX + 2, fy, 3, 1);
    ctx.fillStyle = '#3E3931'; ctx.fillRect(sparkX + 3, fy + 1, 3, 1);
    // One tight halo only: the old 6px pair read as a second light source.
    pxCircle(ctx, sparkX, fy, 3, 'rgba(246,226,122,.40)', null);
    /* the burn point: an IRREGULAR 3-5px flicker cluster that reshapes
       every ~70ms — never a neat outlined square — over a 1px floor halo */
    const ph = drift ? Math.floor(t / 70) % 4 : 1;
    ctx.fillStyle = 'rgba(242,169,59,.30)';                            // floor halo
    ctx.fillRect(sparkX - 3, fy + 3, 7, 1);
    ctx.fillStyle = '#E4675C';
    ctx.fillRect(sparkX - 1, fy - 1 + (ph & 1), 3, 2);
    ctx.fillRect(sparkX + (ph & 1) - 2, fy + 1, 2, 1);
    if (ph !== 2) ctx.fillRect(sparkX + 1, fy - 2 + (ph >> 1), 1, 2);
    ctx.fillStyle = '#F6E27A';
    ctx.fillRect(sparkX - (ph & 1), fy, 2, 1);
    if (ph === 1) ctx.fillRect(sparkX - 2, fy - 1, 1, 1);
    if (drift){                                              // it spits as it burns
      if (Math.floor(t / 90) % 2){ ctx.fillStyle = '#F2A93B'; ctx.fillRect(sparkX + 1, fy - 4, 2, 2); }
      if (Math.floor(t / 70) % 3 === 0){ ctx.fillStyle = '#F6E27A'; ctx.fillRect(sparkX - 3, fy - 6, 1, 1); }
    }
  }

  /* THE FIRE — the streak made visible. Embers when cold; every consecutive
     first-try note feeds it, a miss drops it back to embers. Front of stage,
     Highway-to-Hell style. */
  const streak = GV.run ? GV.run.state.combo : 0;
  const fh = streak === 0 ? 5 : Math.min(10 + streak * 5, 52);
  /* Past the height cap the wall whitens instead: 0 at streak ≤8, 1 at 15. */
  const heat = Math.max(0, Math.min(1, (streak - 8) / 7));
  const hotCols = heat <= 0 ? FLAME_HOT : (heat < 0.5 ? FLAME_HOT2 : FLAME_HOT3);
  const hotCore = heat <= 0 ? null : (heat < 0.5 ? ['#FBEFC0', '#F6E27A'] : ['#FFFBEE', '#FBEFC0']);
  if (streak > 0){
    const hazeA = Math.min(0.12, 0.025 * streak), glowA = Math.min(0.10, 0.02 * streak);
    // the heat haze behind the wall of fire, brighter the longer the streak —
    // its left edge FADES over ~16px so the cannon is not parked against a
    // cold rectangle seam
    ctx.fillStyle = 'rgba(242,169,59,' + hazeA.toFixed(3) + ')';
    ctx.fillRect(48, H - fh - 12, W - 52, fh + 12);
    ctx.fillStyle = 'rgba(242,169,59,' + glowA.toFixed(3) + ')';
    ctx.fillRect(48, FLOOR, W - 48, H - FLOOR);
    for (let s = 0; s < 4; s++){                        // the 16px feather
      const a = ((hazeA + glowA) / 2) * (1 - (s + 1) / 5);
      ctx.fillStyle = 'rgba(242,169,59,' + a.toFixed(3) + ')';
      ctx.fillRect(44 - s * 4, FLOOR, 4, H - FLOOR);
    }
    if (streak > 3){                                    // the heat reaches the barrel
      ctx.fillStyle = 'rgba(242,169,59,.045)';
      ctx.fillRect(0, FLOOR - 6, 48, H - FLOOR + 6);
    }
    /* The fire CASTS light: a 1-2px warm rim on the surfaces that face it —
       the floor lip, the amp bottoms, the cannon-stage ammunition — with the
       intensity riding the flame flicker (held steady under reduced motion). */
    const rimF = drift ? (0.75 + 0.25 * Math.sin(t / 140)) : 1;
    const rimA = Math.min(0.4, 0.05 + 0.03 * streak) * rimF;
    ctx.fillStyle = 'rgba(242,169,59,' + rimA.toFixed(3) + ')';
    ctx.fillRect(40, FLOOR, W - 40, 2);                                  // floor lip
    ctx.fillStyle = 'rgba(242,169,59,' + (rimA * 0.7).toFixed(3) + ')';
    for (const ax of (world.amps || [62, 116]))                          // amp bottoms
      ctx.fillRect(ax, FLOOR - 3, 32, 2);
    if (world.cannons){                                                  // ammo pyramids
      ctx.fillStyle = 'rgba(242,169,59,' + (rimA * 0.9).toFixed(3) + ')';
      for (const bx0 of [138, 268]) ctx.fillRect(bx0 - 1, FLOOR - 6, 26, 1);
    }
  }
  if (streak === 0){
    // cold stage: scattered embers glowing in the coals, no tongues yet.
    // Each carries a coal-dark pixel beneath it, so it reads as an OBJECT
    // sitting on the boards, not a stray bright pixel. The stride VARIES
    // (11px base plus a per-ember scatter) and a few embers are simply
    // missing — a constant 12px beat read as a picket fence, not coals.
    for (let j = 0; j < 22; j++){
      if (j % 7 === 0) continue;                     // the gaps in the coals
      const ex = 52 + j * 11 + ((j * 29) % 13);
      const ey = H - 4 + (j % 2);
      const on = drift ? (Math.sin(t / 260 + j * 2.1) > -0.35) : (j % 3 !== 0);
      ctx.fillStyle = '#1A0D06'; ctx.fillRect(ex, Math.min(H - 1, ey + 2), 2, 1);   // the coal
      ctx.fillStyle = on ? (j % 3 ? '#C7402F' : '#F2A93B') : '#6E1B12';
      ctx.fillRect(ex, ey, 2, 2);
      if (on && j % 4 === 0){ ctx.fillStyle = 'rgba(242,169,59,.25)'; ctx.fillRect(ex - 1, H - 6, 4, 4); }
    }
  } else {
    // back layer: deep-red wide tongues, then the hot layer over them
    for (let j = 0; j < 13; j++){
      const fx = 54 + j * 21 + ((j * 13) % 7);
      const jh = Math.max(4, Math.round(fh * 1.12 * (0.7 + 0.3 * Math.sin(j * 3.9))
                 * (drift ? (0.88 + 0.12 * Math.sin(t / 170 + j * 2.3)) : 1)));
      pxFlame(ctx, fx, H - 2, jh, drift ? t / 190 + j * 2 : 0, 17, FLAME_DEEP, null, j);
    }
    for (let j = 0; j < 17; j++){
      const fx = 52 + j * 16 + ((j * 13) % 9);
      const jh = Math.max(3, Math.round(fh * (0.66 + 0.34 * Math.sin(j * 2.7))
                 * (drift ? (0.84 + 0.16 * Math.sin(t / 130 + j * 1.9)) : 1)));
      pxFlame(ctx, fx, H - 2, jh, drift ? t / 150 + j : 0, 9 + ((j * 11) % 5), hotCols === FLAME_HOT ? null : hotCols, hotCore, j * 3 + 1);
    }
    /* Past streak 15 the wall's height and heat have both capped — growth
       keeps testifying anyway: a white-hot band along the base, and (motion
       permitting) two or three tongues that PIERCE the height cap on a slow
       cycle. Under reduced motion the piercers stand still. */
    if (streak > 15){
      ctx.fillStyle = 'rgba(255,251,238,' + Math.min(0.85, 0.45 + (streak - 15) * 0.05).toFixed(2) + ')';
      ctx.fillRect(54, H - 5, W - 62, 3);                              // white-hot base band
      ctx.fillStyle = 'rgba(251,239,192,.55)';
      ctx.fillRect(60, H - 7, W - 74, 1);
      for (const j of [2, 8, 14]){                                     // the piercers
        const cyc = drift ? Math.sin(t / 900 + j * 2.1) : 0.8;         // slow cycle; static when reduced
        if (cyc <= 0.15) continue;
        const fx = 52 + j * 16 + ((j * 13) % 9);
        // A piercer is a WHOLE tongue rooted on the boards (H-2) that burns
        // past the height cap — based at the cap's top it floated over the
        // wall with sky underneath, a flame blob with no fire under it.
        pxFlame(ctx, fx, H - 2, fh + Math.round(8 + 8 * cyc),
                drift ? t / 160 + j : 0, 5, FLAME_HOT3, null, j + 2);
      }
    }
    // sparks breaking off the top of the wall. The wall's height and heat
    // both cap out around streak 12 — past that the SPARK RATE keeps
    // climbing, so a 25-streak inferno still out-crackles a 15.
    if (drift){
      const n = streak > 12 ? Math.min(20, 10 + (streak - 12)) : Math.min(3 + streak, 10);
      for (let i = 0; i < n; i++){
        const sx = 60 + (i * 97) % (W - 90) + Math.round(Math.sin(t / 300 + i * 5) * 3);
        const sy = H - 4 - ((t / (34 + (i % 4) * 9) + i * 43) % (fh + 30));
        ctx.fillStyle = 'rgba(246,226,122,' + (0.2 + 0.5 * ((sy - (H - 34 - fh)) / 34)).toFixed(2) + ')';
        ctx.fillRect(sx, Math.round(sy), i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
      }
    }
  }

  // the cannon, stage left, waiting for the right note. The shot has ORDER:
  // pre-fire sputter is the anticipation (drawn at the bore, below), the
  // RECOIL kicks at the moment of fire and decays over ~110ms, and a
  // burnt-out fuse gets a 1px cough. A skip's hold phase is no misfire —
  // the barrel just settles 1px. All stillness under reduced motion.
  let cnX = 14, cnY = FLOOR - 24;
  if (!REDUCED){
    if (GV.phase === 'zap'){
      const fa = (now - GV.zapT) - 80;              // fireAge: <0 is pre-fire
      if (fa >= 0 && fa < 110){
        const k = 1 - fa / 110;                     // decaying kick
        cnX -= Math.round(3 * k);
        if (fa < 60) cnY += 1;
      }
    } else if (GV.phase === 'breach' && now - GV.breachT < 140) cnY += 1;
    else if (GV.phase === 'hold' && now - GV.breachT < 320) cnY += 1;
  }
  blit(ctx, CANNON, cnX, cnY, 2);

  // a pluck settling: one quiet quaver rising by the cannon — canvas, no reflow
  if (now < GV.hearingUntil){
    ctx.fillStyle = 'rgba(246,242,236,.6)';
    ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText('♪', 52, 92 - (drift ? (t % 600) / 60 : 0));
  }

  /* THE BELL — the question, hung from the rig. A wrong answer shivers it;
     the right one sends a cannonball up and RINGS it. On timed paces the
     fuse below the cannon burns down; burnt out = the miss. */
  const bell = GV.bell;
  if (bell && GV.phase !== 'over'){
    const bx = 230;
    const zapAge = GV.phase === 'zap' ? now - GV.zapT : -1;
    /* The shot has a wind-up: the first ~80ms are pre-fire — fuse sputter at
       the bore, the barrel settling — and only THEN the flash. Everything
       flash-and-after runs on fireAge = zapAge - 80. */
    const fireAge = zapAge < 0 ? -1 : zapAge - 80;
    let sway = drift ? Math.sin(t / 1500) * 2 : 0;
    if (fireAge > 160 && !REDUCED)
      sway += Math.sin((fireAge - 160) / 90) * 8 * Math.exp(-(fireAge - 160) / 500);
    if (bell.wobble && now - bell.wobble < 340 && !REDUCED){
      const wp = (now - bell.wobble) / 340;
      sway += Math.sin(wp * Math.PI * 4) * 4 * (1 - wp);   // a hard rattle that dies out
    }
    sway = Math.round(sway);
    /* by 24, not 14: the bell hangs on a REAL chain now — four extra rows of
       links between the rig lamp and the hanger loop, instead of a 4px stub
       that read as the bell glued to the truss. */
    const by = 24;
    // one bright frame as the cannon goes off: the whole stage catches the flash
    if (fireAge >= 0 && fireAge < 70 && !REDUCED){
      ctx.fillStyle = 'rgba(246,226,122,.16)'; ctx.fillRect(0, 0, W, H);
    }
    // chain links from the rig lamp's underside down to the bell's hanger
    // loop — alternating link tones every 2px so it reads as chain, not a
    // rod. Starts at y18, clear of the lamp's lens (the fixture sits at the
    // bell's x now, so the bell visibly hangs from the rig point above it).
    const chx = bx - 1 + Math.round(sway / 2);
    for (let cy = 18; cy <= by + 2; cy += 2){
      ctx.fillStyle = (cy >> 1) & 1 ? '#4E463C' : '#3A342E';
      ctx.fillRect(chx, cy, 2, 2);
    }
    // the bell rings: a two-tone AMBER halo swells around it while the note
    // lands — hot amber core, ember-red outer wash, no grey-cream
    if (fireAge >= 160 && fireAge < 560 && !REDUCED){
      const p = (fireAge - 160) / 400;
      pxCircle(ctx, bx + sway, by + 18, 24 + Math.round(p * 8),
        'rgba(222,82,38,' + (0.10 * (1 - p)).toFixed(3) + ')', null);
      pxCircle(ctx, bx + sway, by + 18, 17 + Math.round(p * 6),
        'rgba(242,169,59,' + (0.22 * (1 - p)).toFixed(3) + ')', null);
    }
    blit(ctx, BELL, bx - 16 + sway, by + 2, 2);
    /* THE BELL'S LABEL — the question itself. A note name in Notes mode, and
       in scale mode the CHORD SYMBOL and nothing else: which scale it wants
       is the thing being asked. */
    if (scaleMode()){
      const ink = (!REDUCED && fireAge >= 160 && fireAge < 520) ? '#7E1F16' : '#14110F';
      drawChordOnBell(ctx, SC.chord ? dispSym(SC.chord.symbol) : '', bx + sway, by + 24, ink);
      GV.bx = bx; GV.by = by + 16;
    }
    const label = scaleMode() ? '' : (GV.promptKind === 'staff' ? '♪?' : (q ? disp(q.name) : ''));
    if (label){
      ctx.textAlign = 'center';
      // the label ignites at IMPACT (fireAge 160 is when the ball lands),
      // not while the shot is still in the air — and not at all under
      // reduced motion, where a colour flip is still a flash
      const ink = (!REDUCED && fireAge >= 160 && fireAge < 520) ? '#7E1F16' : '#14110F';
      ctx.fillStyle = ink;
      const acc = label.length === 2 && (label[1] === '♯' || label[1] === '♭') ? label[1] : null;
      if (acc){
        // the LETTER keeps the full 13px; the accidental is a compact drawn
        // glyph beside it — two font characters at 11px crammed the skirt
        ctx.font = 'bold 13px monospace';
        ctx.fillText(label[0], bx + sway - 3, by + 24);
        pxAcc(ctx, bx + sway + 3, by + 16, acc, ink);
      } else {
        ctx.font = 'bold ' + (label.length > 1 ? 11 : 13) + 'px monospace';
        ctx.fillText(label, bx + sway, by + 24);
      }
    }
    GV.bx = bx; GV.by = by + 16;

    // the cannonball on its way up: muzzle → bell. The trail is CONNECTED —
    // a 1px streak joins the spark samples — and the leading edge carries a
    // cream rim-light. Under reduced motion the flight is skipped entirely;
    // the impact at the bell still lands (below).
    if (fireAge >= 0 && fireAge < 160 && !REDUCED){
      const p = fireAge / 160;
      const at = (u) => [47 + (bx - 47) * u,
        (FLOOR - 22) - (FLOOR - 22 - (by + 28)) * u - Math.sin(u * Math.PI) * 9];
      const [cbx, cby] = at(p);
      // the 1px streak from the oldest sample to the ball
      const back = Math.max(0, p - 4 * 0.06);
      ctx.fillStyle = 'rgba(246,226,122,.30)';
      for (let s = 0; s <= 14; s++){
        const [sx, sy] = at(back + (p - back) * (s / 14));
        ctx.fillRect(Math.round(sx) + 2, Math.round(sy) + 2, 1, 1);
      }
      for (let i = 1; i <= 4; i++){
        const [tx, ty] = at(Math.max(0, p - i * 0.06));
        ctx.fillStyle = 'rgba(246,226,122,' + (0.65 - i * 0.14).toFixed(2) + ')';
        const ts = i < 3 ? 3 : 2;
        ctx.fillRect(Math.round(tx) + 1, Math.round(ty) + 1, ts, ts);
      }
      ctx.fillStyle = '#14110F'; ctx.fillRect(Math.round(cbx) - 1, Math.round(cby) - 1, 6, 6);
      ctx.fillStyle = '#4E555E'; ctx.fillRect(Math.round(cbx) - 1, Math.round(cby) - 1, 2, 2);
      // cream rim-light on the leading (up-and-right) edge
      ctx.fillStyle = '#F6E27A';
      ctx.fillRect(Math.round(cbx) + 4, Math.round(cby) - 1, 1, 3);
      ctx.fillRect(Math.round(cbx) + 2, Math.round(cby) - 1, 2, 1);
    }
    // pre-fire: two frames of fuse-sputter at the BREECH — where the cord
    // actually ends (its tail climbs to the back of the gun, x≈14-22) — while
    // the barrel settles: the shot ANNOUNCES itself from the touch hole, not
    // from a muzzle the cord never reaches. Skipped under reduced motion,
    // where the flash below still lands.
    if (zapAge >= 0 && fireAge < 0 && !REDUCED){
      const ph = Math.floor(zapAge / 40) % 2;
      ctx.fillStyle = '#F6E27A';
      ctx.fillRect(16 + ph, FLOOR + 1, 2, 2);
      ctx.fillRect(19 - ph, FLOOR - 1 + ph, 1, 1);
      ctx.fillStyle = '#F2A93B';
      ctx.fillRect(14 + ph * 2, FLOOR + 4, 1, 1);
    }
    // muzzle flash: a hot star off the bore with a blast ring, slow-decay
    // core. NOT under reduced motion — a bright star popping in is a flash
    // whether or not it moves; the calm path gets the static wisp below.
    if (fireAge >= 0 && fireAge < 110 && !REDUCED){
      const fa = 1 - (fireAge / 110) * (fireAge / 110);
      pxCircle(ctx, 50, FLOOR - 22, 12, 'rgba(242,169,59,' + (0.35 * fa).toFixed(2) + ')', null);
      pxCircle(ctx, 49, FLOOR - 22, 7, 'rgba(246,226,122,' + (0.95 * fa).toFixed(2) + ')', null);
      ctx.fillStyle = 'rgba(246,226,122,' + (0.95 * fa).toFixed(2) + ')';
      ctx.fillRect(42, FLOOR - 23, 17, 2); ctx.fillRect(49, FLOOR - 30, 2, 17);
      ctx.fillRect(45, FLOOR - 27, 2, 2); ctx.fillRect(54, FLOOR - 27, 2, 2);
      ctx.fillRect(45, FLOOR - 17, 2, 2); ctx.fillRect(54, FLOOR - 17, 2, 2);
      const rp = fireAge / 110;
      pxCircle(ctx, 50, FLOOR - 22, 6 + Math.round(rp * 12), null,
        'rgba(242,169,59,' + (0.5 * fa).toFixed(2) + ')');
    }
    // after the ball leaves: a muzzle wisp drifts up and thins for ~300ms.
    // Under reduced motion the wisp is the WHOLE muzzle event — static,
    // from the moment of fire.
    if (fireAge >= (REDUCED ? 0 : 110) && fireAge < 440){
      const wp = Math.max(0, (fireAge - 110) / 330);
      const move = REDUCED ? 0.4 : wp;
      const a = 0.30 * (1 - wp);
      pxCircle(ctx, 52 + Math.round(move * 10), FLOOR - 26 - Math.round(move * 12),
        3 + Math.round(move * 4), 'rgba(160,152,140,' + a.toFixed(3) + ')', null);
      pxCircle(ctx, 48 + Math.round(move * 6), FLOOR - 23 - Math.round(move * 8),
        2 + Math.round(move * 3), 'rgba(196,189,177,' + (a * 0.8).toFixed(3) + ')', null);
    }
    // impact: the ring blooms WHERE THE BALL LANDS — its flight ends at
    // by+28 (the bell's mouth), so the ring and burst centre there, not
    // 8px up the skirt where nothing arrived
    if (fireAge >= 160 && !GV.zapHit){
      GV.zapHit = true;
      if (!REDUCED) gvBurst(bx + sway, by + 27, '#F6E27A');
    }
    if (fireAge >= 160 && fireAge < 380){
      const p = (fireAge - 160) / 220;
      // reduced motion still gets the IMPACT — a fading ring that does not fly
      pxCircle(ctx, bx + sway, by + 27, REDUCED ? 10 : 5 + Math.round(p * 15), null,
        'rgba(246,226,122,' + (0.8 * (1 - p)).toFixed(2) + ')');
    }
    // breach: the fuse died — three grey puffs crawl off the muzzle and thin
    // out. Two-tone (light core inside a darker body, dark rim), each puff on
    // its own drift vector so they shear apart instead of rising as one blob.
    // Under reduced motion the puffs hold position and simply fade.
    if (GV.phase === 'breach'){
      const age = now - GV.breachT;
      /* Every puff SEEDS AT THE MUZZLE BORE (≈50, FLOOR−22) and drifts UP,
         each on its own vector so they shear apart instead of rising as one
         blob. Under reduced motion the puffs hold position and simply fade. */
      const VEC = [[-6, -26], [5, -34], [-2, -19]];          // staggered drift, all upward
      for (let i = 0; i < 3; i++){
        const a0 = age - i * 90;
        if (a0 < 0) continue;
        const p = Math.min(1, a0 / 620);
        const move = REDUCED ? 0.35 : p;                     // static-ish when reduced
        const r = 4 + Math.round((REDUCED ? 0.5 : p) * (8 + i * 2));
        const cx = 50 + (i - 1) * 2 + Math.round(move * VEC[i][0]);
        const cy = FLOOR - 23 - i * 2 + Math.round(move * VEC[i][1]);
        pxCircle(ctx, cx, cy, r, 'rgba(120,113,103,' + (0.48 * (1 - p)).toFixed(3) + ')',
          'rgba(74,69,62,' + (0.55 * (1 - p)).toFixed(3) + ')');
        pxCircle(ctx, cx - (r >> 2), cy - (r >> 1), Math.max(3, r >> 1),
          'rgba(196,189,177,' + (0.42 * (1 - p)).toFixed(3) + ')', null);
      }
      // the first 120ms: 2-3 dark flecks bridging bore → first puff, so the
      // smoke visibly COMES FROM the barrel rather than appearing beside it
      if (age < 120 && !REDUCED){
        const p0 = Math.min(1, age / 620);
        const fx0 = 48 + Math.round(p0 * VEC[0][0]), fy0 = FLOOR - 23 + Math.round(p0 * VEC[0][1]);
        ctx.fillStyle = 'rgba(74,69,62,.7)';
        for (let k = 1; k <= 3; k++){
          const u = k / 4;
          ctx.fillRect(Math.round(50 + (fx0 - 50) * u), Math.round(FLOOR - 22 + (fy0 - (FLOOR - 22)) * u), 1, 1);
        }
      }
    }
  }

  // particles (bell sparks rise with the heat) and floating toasts
  const keep = [];
  for (const f of GV.fx){
    const age = now - f.born;
    if (f.kind === 'p' && age < 700){
      const s = age / 1000;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 1 - age / 700;
      ctx.fillRect(f.x + f.vx * s, f.y + f.vy * s - 26 * s, 2, 2);
      ctx.globalAlpha = 1;
      keep.push(f);
    } else if (f.kind === 't' && age < 1300){
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, 2 - (age / 650));
      ctx.fillStyle = '#F2A93B';
      // x=120: clear of the bell (bx 230) and its ring halo at every sway.
      // From y≈60 UP to ~44 — never into the canvas's top rows, which sit
      // under the sticky header whenever the scene is part-scrolled.
      ctx.fillText(f.text, 120, 60 - (REDUCED ? 0 : age / 80));
      ctx.globalAlpha = 1;
      keep.push(f);
    } else if (f.kind === 'd' && age < 600 && !REDUCED){
      // wrong-shiver dust: 2px clumps shaken off the bell, falling on small
      // arcs (none at all under reduced motion)
      const pp = age / 600;
      ctx.fillStyle = '#8A7A5E';
      ctx.globalAlpha = 0.7 * (1 - pp);
      ctx.fillRect(Math.round(f.x + Math.sin(age / 90 + f.seed * 2.1) * 3),
                   Math.round(f.y + pp * pp * 22), 2, 2);
      ctx.globalAlpha = 1;
      keep.push(f);
    }
  }
  GV.fx = keep;
  ctx.restore();   // undo the screen-shake translate
}

/* ---- bass-clef staff (the reading mode) ----
   Drawn pixel-style on its own canvas. Bass guitar is written an octave
   above where it sounds; BassGame.staffSpec owns that arithmetic. */
const STAFF_INK = '#E8E2D4';
function staffGeo(cv){
  // hs = half a line-space; baseY = the bottom line (written G2). The low B
  // sits at pos -5 — 30px below the base line — so the bottom margin must
  // hold that head plus, on the reference card, its name label under it.
  return { hs:6, baseY:cv.height - 50, x0:40, x1:cv.width - 12 };
}
/* The F-clef as a sprite: the head dot ON the F line, the arc bulging right,
   the tail sweeping down-left — 12×22 at scale 2 spans the staff like the
   engraved glyph does. Drawn from a grid so it reads as ONE shape. */
const CLEF = sprite({ c:STAFF_INK },
  ['...ccccc....',
   '..ccccccc...',
   '.cc.....cc..',
   'cc.......cc.',
   'cc........cc',
   'cc........cc',
   'cc........cc',
   'ccc.......cc',
   'cccc......cc',
   'ccc.......cc',
   '..........cc',
   '.........cc.',
   '.........cc.',
   '........cc..',
   '.......ccc..',
   '......ccc...',
   '.....ccc....',
   '....ccc.....',
   '...ccc......',
   '..ccc.......',
   '.cc.........',
   'cc..........']);
function paintStaff(ctx, g){
  ctx.fillStyle = STAFF_INK;
  for (let pos = 0; pos <= 8; pos += 2)
    ctx.fillRect(g.x0, g.baseY - pos * g.hs - 1, g.x1 - g.x0, 2);
  // Head row 8 of the sprite must sit on the F line (pos 6).
  const fy = g.baseY - 6 * g.hs;
  blit(ctx, CLEF, g.x0 - 32, fy - 16, 2);
  // The two dots that bracket the F line, right of the clef body.
  ctx.fillStyle = STAFF_INK;
  ctx.fillRect(g.x0 - 4, g.baseY - 7 * g.hs - 1, 3, 3);
  ctx.fillRect(g.x0 - 4, g.baseY - 5 * g.hs - 1, 3, 3);
}
function paintNote(ctx, g, midi, nx, opts){
  const spec = GAME.staffSpec(midi, opts && opts.flat ? { prefer:'flat' } : undefined);
  const ny = g.baseY - spec.pos * g.hs;
  ctx.fillStyle = STAFF_INK;
  // Ledger lines share the staff lines' y-convention, so a note ON a ledger
  // (open E) has the line running through the head's centre row.
  for (const lp of spec.ledgers)
    ctx.fillRect(nx - 10, g.baseY - lp * g.hs - 1, 20, 2);
  // note head: a clean pixel oval — no tails, symmetric top and bottom
  ctx.fillStyle = (opts && opts.color) || '#F2A93B';
  ctx.fillRect(nx - 4, ny - 3, 8, 2);
  ctx.fillRect(nx - 6, ny - 1, 12, 3);
  ctx.fillRect(nx - 4, ny + 2, 8, 2);
  /* stem: up from low notes (right side), down from high ones (left side),
     joining at the head's CENTRE row — starting below it gave the head a
     droopy bottom-left tail. Engraved length ~2.5-3 line-spaces (32px);
     notes far outside the staff extend their stems back toward the middle
     line, the way engraving pulls far-ledger notes home. */
  const midY = g.baseY - 4 * g.hs;
  if (spec.pos < 4){
    let top = ny - 32;
    if (spec.pos <= -2) top = Math.min(top, midY);
    top = Math.max(3, top);
    ctx.fillRect(nx + 4, top, 2, ny - top);
  } else {
    let bottom = ny + 32;
    if (spec.pos >= 10) bottom = Math.max(bottom, midY);
    bottom = Math.min(g.baseY + 44, bottom);
    ctx.fillRect(nx - 6, ny, 2, bottom - ny);
  }
  if (spec.acc === '#'){
    const ax = nx - 17, ay = ny - 6;
    ctx.fillRect(ax + 1, ay, 2, 13);
    ctx.fillRect(ax + 6, ay, 2, 13);
    ctx.fillRect(ax - 2, ay + 3, 12, 2);
    ctx.fillRect(ax - 2, ay + 8, 12, 2);
  } else if (spec.acc === 'b'){
    /* A pixel ♭: tall stem, hooked bowl closing back onto it. */
    const ax = nx - 16, ay = ny - 11;
    ctx.fillRect(ax, ay, 2, 15);            // the stem
    ctx.fillRect(ax + 2, ay + 8, 4, 2);     // bowl top
    ctx.fillRect(ax + 5, ay + 9, 2, 3);     // bowl right
    ctx.fillRect(ax + 2, ay + 12, 4, 2);    // the hook back to the stem
  }
  return spec;
}
function drawStaff(cv, midi, opts){
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const g = staffGeo(cv);
  paintStaff(ctx, g);
  const nx = Math.round((g.x0 + g.x1) / 2) + 6;
  const spec = paintNote(ctx, g, midi, nx, { flat: !!(opts && opts.flat) });
  if (opts && opts.showName && q){
    // right beside the head it names — not off in a corner the eye has to
    // travel to and associate back. 13px: this label is the zap's TEACHING,
    // and 11px was the smallest text on the screen at the moment it mattered.
    const ny = g.baseY - spec.pos * g.hs;
    ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#F2A93B';
    ctx.fillText(dispQ(), nx + 13, ny + 4);
  }
}
/** The reference card: the five open strings on one staff, named. */
function drawClefRef(){
  const cv = document.getElementById('gvClefRef');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const g = staffGeo(cv);
  paintStaff(ctx, g);
  const opens = [[23,'B'], [28,'E'], [33,'A'], [38,'D'], [43,'G']];
  ctx.font = 'bold 11px monospace';
  opens.forEach(([midi, name], i) => {
    const nx = g.x0 + 28 + i * Math.floor((g.x1 - g.x0 - 44) / (opens.length - 1));
    paintNote(ctx, g, midi, nx, {});
    ctx.fillStyle = '#A79F94'; ctx.textAlign = 'center';
    ctx.fillText(name, nx, cv.height - 4);
  });
}

/* ================= the note map =================
   The whole neck, named: 5 strings × frets 0–12, every position carrying the
   note that lives there. It is REFERENCE, not help — a collapsed card below
   the console, the same standing as the staff guide beside it. Nothing in the
   play loop reads it, opens it or points at it; the player opens it when they
   want to study the neck, and closes it when they want to be asked.

   Three display options, because one map cannot be right for everyone:
     · Names — Naturals only (the seven letters a beginner is building),
       Sharps (C♯) or Flats (D♭). Same fret, same sound, two spellings; the
       reading mode asks in both, so the map can teach in both.
     · This stage — dims everything the current stage never asks (other
       strings, frets past its ceiling, the accidentals below stage 5), so the
       map matches the questions instead of overwhelming them.
     · My weak spots — the positions your own misses are piling up on, drawn
       in the miss colour ON TOP of their names. BOTH games feed it: the note
       game's per-position heat and rolling record, and the positions inside a
       scale box that was fumbled — a player who keeps missing one shape
       should see it here, not just hear about it. */
function mapMarkers(){
  const st = loadShared().stats || {};
  const heat = st.heat || {}, recent = st.noteRecent || {};
  const scHeat = st.scaleHeat || {};
  /* "What this stage asks" is not re-derived here: pool() IS that answer, and
     it already carries the string focus and the fret window as well as the
     stage. A second copy of the rule would drift from the questions. */
  const askable = new Set(pool().map(it => it.sn + ':' + it.f));
  const markers = [];
  let weakSeen = 0;
  for (let si = 0; si < TUNING.names.length; si++){
    const sn = TUNING.names[si];
    for (let f = 0; f <= 12; f++){
      const name = C.NAMES[(((TUNING.midi[si] + f) % 12) + 12) % 12];
      const isNat = NATURALS.has(name);
      if (!isNat && GV.map.spell === 'natural') continue;   // naturals-only: draw nothing there
      const key = sn + ':' + f;
      const weak = (heat[key] | 0) > 0 || (recent[key] || []).indexOf(0) >= 0
                || (scHeat[key] | 0) > 0;
      if (weak) weakSeen++;
      markers.push({
        si, fret:f,
        kind: (GV.map.weak && weak) ? 'heat' : (isNat ? 'tone' : 'ghost'), heat:1,
        label: isNat ? name : (GV.map.spell === 'flat' ? FLAT_DISP[name] : disp(name)),
        /* Not a marker property the renderer knows — read back below to dim
           what this stage never asks. */
        out: GV.map.stage && !askable.has(key),
      });
    }
  }
  return { markers, weakSeen, askable };
}
/** The askable set, in words: "E A strings, frets 0–5, naturals only" — read
    off the pool itself, so the sentence can never describe a different neck
    than the one the dimming drew. */
function askableWords(askable){
  const strs = TUNING.names.filter(sn => [...askable].some(k => k.split(':')[0] === sn));
  const frets = [...askable].map(k => +k.split(':')[1]);
  const lo = Math.min.apply(null, frets), hi = Math.max.apply(null, frets);
  const anyAcc = [...askable].some(k => {
    const si = TUNING.names.indexOf(k.split(':')[0]);
    return !NATURALS.has(C.NAMES[(((TUNING.midi[si] + +k.split(':')[1]) % 12) + 12) % 12]);
  });
  return strs.join(' ') + (strs.length === 1 ? ' string' : ' strings') +
    ', frets ' + lo + '–' + hi + (anyAcc ? ', sharps included' : ', naturals only');
}
function renderNoteMap(){
  const card = document.getElementById('gvMap');
  const host = document.getElementById('gvMapBoard');
  if (!card || !host) return;
  // Collapsed is the default and the resting state: nothing to draw, and a
  // <details> that is shut has no width to lay a board out in anyway.
  if (!card.open){ host.innerHTML = ''; return; }
  const { markers, weakSeen, askable } = mapMarkers();
  const scale = matchMedia('(min-width:1000px)').matches ? 'desk'
              : matchMedia('(min-width:760px)').matches ? 'readbig' : 'read';
  const spellWord = GV.map.spell === 'natural' ? 'naturals only'
                  : GV.map.spell === 'flat' ? 'flat names' : 'sharp names';
  BassNeck.render(host, {
    strings: TUNING.names, fromFret:0, toFret:12, scale, markers,
    title: 'Note map: the five strings B E A D G, frets 0 to 12, ' + spellWord,
  });
  /* The renderer dims what falls outside a WINDOW; this map's "outside" is a
     stage — some of it strings, some of it frets, some of it the accidentals a
     stage below the fifth never asks for. Same visual language, applied after
     the draw rather than bent into a window the board does not have. */
  markers.forEach(m => {
    if (!m.out) return;
    const g = host.querySelector('.neck-marker[data-s="' + m.si + '"][data-f="' + m.fret + '"]');
    if (g) g.classList.add('is-outside');
  });
  const note = document.getElementById('gvMapNote');
  if (note){
    const bits = [];
    if (GV.map.stage){
      const scope = askableWords(askable);
      /* Nothing dimmed is a fact worth saying: a caption explaining a dimming
         the player cannot see reads as a bug in the map. */
      /* The dimming describes the NOTE game's stage; in scale mode the same
         stage number means a rung of the scale ladder, so the caption says
         which game it is talking about rather than quietly lying. */
      const where = scaleMode() ? '</b> in Notes mode' : '</b>';
      bits.push(markers.some(m => m.out)
        ? 'Dimmed = not asked on <b>Stage ' + (tier + 1) + where + ' (' + scope + ').'
        : '<b>Stage ' + (tier + 1) + where + ' asks all of these — ' + scope + ' — so nothing is dimmed.');
    }
    if (GV.map.weak){
      bits.push(weakSeen
        ? '<b class="gv-map-weakkey">Red</b> = positions you have missed — ' + weakSeen +
          ' of them so far.'
        : 'No misses on record yet, so nothing is marked red — play a set and come back.');
    }
    if (GV.map.spell !== 'natural'){
      bits.push('Every ♯ has a ♭ name for the same fret: <b>C♯ = D♭</b>.');
    }
    note.innerHTML = bits.join(' ');
    note.classList.toggle('hidden', !bits.length);
  }
  const now = document.getElementById('gvMapNow');
  if (now){
    now.textContent = (GV.map.spell === 'natural' ? 'Naturals' :
                       GV.map.spell === 'flat' ? 'Flats ♭' : 'Sharps ♯') +
      (GV.map.stage ? ' · this stage' : ' · whole neck') +
      (GV.map.weak ? ' · weak spots' : '');
  }
}
function updateFindStats(){
  document.getElementById('fScore').textContent = sess.find.score;
  document.getElementById('fClean').textContent = sess.find.clean;
  document.getElementById('fStreak').textContent = sess.find.streak;
  document.getElementById('fAsked').textContent = sess.find.asked;
}

/** The whole out-of-tune verdict, and it ESCALATES inside one question.
    A first bad reading is usually a finger a millimetre off the fret, so the
    first line keeps both hypotheses open. A second one on the same question —
    after the player has already adjusted — is usually the string itself, and
    that is a Tuner job. That sentence used to arrive through the Hint button
    ("it is your tuning that is off — open the Tuner tab"); with the hint gone
    it rides the verdict here, or a player with a flat string would be told to
    move their finger forever.
    The escalation REPLACES the line rather than extending it: the verdict has
    a reserved height, and a second sentence bolted onto the first overflowed
    it at every viewport (measured: 110px of text in a 72px slot). Plain text —
    the verdict is written with textContent. */
function tuneVerdict(reading, lead){
  outOfTuneCount++;
  const c = Math.abs(Math.round(reading.cents));
  const dir = reading.cents < 0 ? 'flat' : 'sharp';
  return outOfTuneCount >= 2
    ? 'Still ' + c + ' cents ' + dir + ' — that is the string, not your finger. Open the Tuner tab.'
    : lead + ' But it is ' + c + ' cents (nearly half a fret) ' + dir +
      ' — check your finger placement, or that string may need tuning.';
}

function onStableNote(reading){
  const heardName = C.hzToNote(reading.hz).name;
  if (mode === 'find'){
    if (scaleMode() ? !SC.run : !q) return;
    /* The heard line updates on EVERY fresh attack — including during the
       breach/skip hold windows: players replay the taught note there, and a
       dead heard line reads as a dead microphone. Plain words lead; the
       number rides behind in parens. One mono line. */
    const hEl = document.getElementById('fHeard');
    const heardCents = Math.round(reading.cents);
    const tuneWords = Math.abs(heardCents) <= 15 ? 'in tune'
      : (Math.abs(heardCents) <= 30 ? 'a touch ' : 'well ') + (heardCents < 0 ? 'flat' : 'sharp');
    hEl.textContent = 'heard ' + dispHeard(heardName) + C.hzToNote(reading.hz).octave +
      ' — ' + tuneWords + ' (' + reading.hz.toFixed(1) + ' Hz)';
    /* Committed turns: while a zap or a breach animation is settling, the
       verdict on screen is the verdict — a stray attack in that window is
       neither judged against the dying question nor allowed to flip the
       banner. The window is ~1.2s; the next question re-opens judging. */
    if (GV.phase === 'zap' || GV.phase === 'breach' || GV.phase === 'hold') return;
    if (GV.run && GV.run.state.over) return;   // the restart button owns the screen
    /* Scale mode judges a RUN, not a note: one chord's box, in order, parked
       on whatever step you missed. Everything below is the note game. */
    if (scaleMode()){ scStableNote(reading, heardName); return; }
    const verdict = C.checkAnswer(reading, q.midi);
    const vEl = document.getElementById('fVerdict');
    /* One shared path for every accepted answer (dead-on, or the octave twin).
       One stored answer per QUESTION, graded on the first attempt — the rule
       the heat map and the "in under 2 seconds" checkpoint already assume.
       Hunting used to bank a wrong AND then a correct, so four questions all
       answered right came out as 50% of 8. countWrong() has already banked
       this question if the first attempt missed. CLEAN is simply: first
       attempt, and no tuning waiver. */
    const acceptCorrect = (label, playedFret) => {
      /* And not after an out-of-tune reading on the target fret: that verdict
         already confirmed the position, so the eventual in-tune correct is a
         dirty find, not a first-try recall. */
      const clean = wrongThisQ === 0 && !tuneWaivedThisQ;
      /* Octave twins are ACCEPTED at another fret — the record must follow the
         fret actually played, or the picker trains the wrong position. */
      const played = (playedFret != null && playedFret !== q.f)
        ? Object.assign({}, q, { f: playedFret }) : q;
      const playedKey = played.sn + ':' + played.f;
      vEl.textContent = label;
      vEl.className = 'verdict ok';
      sess.find.score++;
      if (clean){
        sess.find.clean++; sess.find.streak++; sess.find.asked++;
        recordAnswer(true, played);
      } else if (wrongThisQ === 0){
        /* No miss, but no first-try credit either — an out-of-tune reading on
           the target fret already confirmed the position. The question was
           asked and the streak is gone; the position books a quiet comeback
           (review only — no heat, no recent-miss write), because a note that
           needed two goes is a note worth asking again. */
        sess.find.asked++; sess.find.streak = 0;
        reviewQ.add(playedKey, qCount);
      }
      gvJudge(clean ? 'clean' : 'dirty');
      if (GV.promptKind === 'staff') staffAnswered = true;   // the pointer's job is done
      if (clean) gvCue('ding');
      gvZap();
      updateFindStats();
      GV.nextQTimer = setTimeout(newQuestion, 900);
    };
    if (verdict === 'correct'){
      const dn = dispQ();
      /* 25–40¢ out is still a clean find — but worth a gentle word, because
         above 40¢ the same finger placement stops counting at all. */
      const near = Math.abs(heardCents) >= 25
        ? ' (a touch ' + (heardCents < 0 ? 'flat' : 'sharp') + ', but it counts)'
        : '';
      acceptCorrect((wrongThisQ === 0 && !tuneWaivedThisQ
        ? (near ? 'FIRE! ' + dn + ' rings the bell.'   // "dead on" would argue with the tail
           : ['FIRE! ' + dn + ' rings the bell.', dn + ' — dead on.',
              'BOOM — that was ' + dn + '.', dn + '. The bell tolls.'][Math.floor(Math.random()*4)])
        : 'There it is — ' + dn + '.') + near);
    } else if (verdict === 'out-of-tune'){
      vEl.textContent = tuneVerdict(reading, 'Right note!');
      vEl.className = 'verdict warn';
      outOfTuneThisQ = true;   // holds the fuse (~4s budget)
      /* Fighting intonation IS progress — the stall nudge must not fire over
         a player mid-adjustment. */
      lastProgressAt = performance.now();
      /* The position is confirmed now — the verdict named it right. The
         in-tune correct that follows scores as found, never first-try. */
      tuneWaivedThisQ = true;
    } else if (verdict === 'wrong-octave'){
      const twinF = q.f + (reading.midi - q.midi);   // the same note's other home on this string
      const dirWord = reading.midi > q.midi ? 'higher' : 'lower';
      const octGap = GAME.octaveWords(reading.midi - q.midi);
      if (GV.promptKind === 'name' && Math.abs(reading.midi - q.midi) === 12
          && twinF >= 0 && twinF <= tierNow().maxFret){
        /* NAME mode asked for "G on the E string" — and fret 3 and fret 15
           are both exactly that. Reading mode stays strict: the octave is
           written on the page. The record follows the fret actually played.
           The twin passes the SAME tuning gate as the asked-for fret: an
           out-of-tune twin gets the out-of-tune verdict, not a free accept. */
        if (Math.abs(reading.cents) <= C.CENTS_TOLERANCE){
          acceptCorrect(dispQ() + ' — that’s the other one: it also lives at fret ' + twinF + '. Both count.', twinF);
        } else {
          vEl.textContent = tuneVerdict(reading,
            'Right note — that’s the other ' + dispQ() + ', at fret ' + twinF + '!');
          vEl.className = 'verdict warn';
          outOfTuneThisQ = true;
          lastProgressAt = performance.now();   // same rule: intonation work is progress
          tuneWaivedThisQ = true;
        }
      } else if (GV.promptKind === 'name' && (reading.midi - q.midi) % 12 === 0
                 && twinF > tierNow().maxFret){
        /* The genuine twin, past this stage's ceiling: SOFT reject. The
           verdict lands and the streak breaks, but nothing is banked against
           the position (no heat, no recent-miss write) — the prompt was
           ambiguous, and the ceiling is a game rule, not the neck. The copy
           hedges the wrong-string reading and counts its octaves honestly. */
        /* Tightened to three lines at phone width: measured at 380×800 this
           was the one verdict in the game that overflowed its reserved slot
           (73px of text in 56px), and a correction the player cannot read in
           full is not a correction. Every fact survives — the octave count,
           the direction, the reason, the different-string hedge, the answer. */
        vEl.textContent = 'That’s the same ' + dispQ() + ' ' + octGap + ' ' + dirWord +
          ' — past this stage’s frets, or on another string. You want the ' +
          q.sn + ' string, fret ' + q.f + '.';
        vEl.className = 'verdict no';
        countWrong({ soft:true });
      } else if (GV.promptKind === 'staff'){
        /* Reading mode teaches NOTATION, so the correction reads the page,
           not the neck: no fret number — Show me is where a fret number comes
           from — and ledger-line advice only where ledger lines exist. */
        const flatOpt = qFlat ? { prefer:'flat' } : undefined;
        const hasLedgers = GAME.staffSpec(q.midi, flatOpt).ledgers.length > 0
          || GAME.staffSpec(reading.midi, flatOpt).ledgers.length > 0;
        vEl.textContent = 'That’s ' + article(dispHeard(heardName)) + ' ' + dispHeard(heardName) +
          ' — right note, wrong octave. ' +
          (hasLedgers
            ? 'Count the ledger lines: this one sits ' +
              (reading.midi > q.midi ? 'lower' : 'higher') + ' than the one you played.'
            : 'Look how ' + (reading.midi > q.midi ? 'low' : 'high') +
              ' on the staff it sits — yours rang an octave ' +
              (reading.midi > q.midi ? 'high' : 'low') + '.');
        vEl.className = 'verdict no';
        countWrong();
      } else {
        /* Name mode, non-twin octave miss: direction only — Show me remains
           the only place the fret is shown. The octave count is honest: a
           two-octave slip is not "an octave". */
        /* Same hedge as the upward sibling above: a downward octave slip on a
           five-string is very often a DIFFERENT string, not the same one. */
        vEl.textContent = 'That’s ' + article(dispHeard(heardName)) + ' ' + dispHeard(heardName) +
          ' — right note, wrong octave. You want the one ' + octGap + ' ' +
          (reading.midi > q.midi ? 'lower' : 'higher') +
          ', on the same string — or you may be on a different string.';
        vEl.className = 'verdict no';
        countWrong();
      }
    } else {
      /* dispHeard, not disp: a flat-spelled staff question must never read
         "That was A♯ — looking for A♭" about the very same pitch class family
         — the heard note spells the way the question spells. */
      vEl.textContent = 'That was ' + dispHeard(heardName) + ' — looking for ' + dispQ() + '.';
      vEl.className = 'verdict no';
      countWrong();
    }
  } else if (mode === 'songs'){
    // A play-along, not a test: this notes whether you were on the section's
    // root and says so quietly. It never halts and never buzzes. A running
    // setlist owns the floor; otherwise the single-song roadmap does.
    if (ST.run && ST.t0 != null && !ST.finished) setPush(reading.midi);
    else songPush(reading.midi);
  }
}
/** One wrong-note judgement. `opts.soft` (the out-of-range octave twin) keeps
    the verdict, the streak break and the fuse hold, but banks NOTHING against
    the position — no stored answer, no heat, no recent-miss, no comeback. */
function countWrong(opts){
  const soft = !!(opts && opts.soft);
  wrongThisQ++;
  lastProgressAt = performance.now();
  gvCue('buzz');                                         // a dull thud with the 'no' verdict
  /* A wrong note supersedes the tuning theory: the stale "it is your tuning"
     reading must not keep holding the fuse for a note that simply missed. */
  outOfTuneThisQ = false;
  /* Fuse fairness on timed paces: reading the correction is not fuse time.
     The freeze rides the same spawnAt-slide the out-of-tune hold uses — but
     it is BUDGETED: only the first two wrongs renew it, and the per-question
     budget (~3s) caps the total, so wrong-note spam cannot stall the fuse. */
  if (wrongThisQ <= 2 && (!GV.fuseBudget || GV.fuseBudget.left('wrong') > 0)){
    GV.freezeUntil = performance.now() + 1000;
  }
  if (GV.bell) GV.bell.wobble = performance.now();       // it shivers; no text flips
  if (GV.bell && !REDUCED){                              // and shakes off a little dust
    for (let i = 0; i < 4; i++)
      GV.fx.push({ kind:'d', x:GV.bx - 10 + i * 6, y:GV.by + 10 + (i % 2) * 3,
                   born:performance.now(), seed:i });
  }
  gvJudge('wrong');                                      // the streak breaks
  if (wrongThisQ === 1){
    sess.find.streak = 0; sess.find.asked++;
    if (!soft){
      recordAnswer(false, q);
      reviewQ.add(q.sn + ':' + q.f, qCount);   // a recorded miss books a comeback
    }
  }
  updateFindStats();
}
/** Bank a judged note against the position it was asked at — the only two
    things the game remembers about you, and the only two it reads back:
    `heat` paints the note map's weak-spot overlay, `noteRecent` tells the
    adaptive picker which positions to bring round again sooner.

    It used to bank six more figures — running accuracy, best streak,
    per-string tallies, day-stamped counts, per-tier windows, answer speed —
    for a Note quiz screen and a practice plan that read them. Both are
    retired; the writes went with them. */
function recordAnswer(ok, question){
  saveStats(st => {
    const key = question.sn + ':' + question.f;
    if (!ok) st.heat[key] = (st.heat[key] || 0) + 1;
    /* Rolling last-6 per POSITION. Bounded: ≤65 positions × 6 entries. */
    const nr = st.noteRecent[key] || (st.noteRecent[key] = []);
    nr.push(ok ? 1 : 0);
    if (nr.length > 6) nr.shift();
  });
}

/* The app's own voice — the scale card's "Hear it" plays the box back
   through it. It was written for Ear training, which is retired; the
   synth outlived the mode that needed it. */
function playNote(midi){
  if (!A.ctx) return;
  // Ignore the microphone until our own note has died away, so the app
  // cannot "hear itself" and score before the player has touched the bass.
  A.muteUntil = performance.now() + 1750;
  const t = A.ctx.currentTime, f = C.midiToHz(midi);
  const out = A.ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  const lp = A.ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = Math.min(2400, f * 14);
  const o1 = A.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
  const o2 = A.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = f * 2;
  const g2 = A.ctx.createGain(); g2.gain.value = 0.32;
  o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(out); out.connect(A.ctx.destination);
  o1.start(t); o2.start(t); o1.stop(t + 1.5); o2.stop(t + 1.5);
}

/* ================= ui wiring ================= */
/* Three Live modes, three of the app's five nav destinations, so the nav is
   what shows which one is on. `find` is the game; the nav calls it Play and
   the router translates — see the note on MODE_OF in index.html. */
const MODES = {
  tuner: { title:'Tuner', cta:'Start listening & tune up' },
  find:  { title:'Play',  cta:'Start listening & play' },
  songs: { title:'Songs', cta:'Start listening & follow the song' }
};
function highlightNav(m){
  /* The nav button for the game says `play`; every other mode's nav name and
     internal name are the same word. */
  const nav = m === 'find' ? 'play' : m;
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === nav));
}
/** What THIS mode keeps, in one sentence under the mic card. It is not only a
    per-tab fact: the game's two modes bank differently, so switching the mode
    strip re-states it too. */
function gvFeedNote(m){
  const feed = document.getElementById('feedNote');
  if (!feed) return;
  feed.textContent = m === 'tuner'
    ? 'The tuner keeps nothing — you turn pegs, and the app only tells you which way.'
    : m === 'songs'
    ? 'Songs keep their own record — plays and best root accuracy live with the song, apart from the game’s levels.'
    : scaleMode()
    ? 'Scale runs bank their own XP, their own best run and their own stage — separately from Notes, because a six-note run and a single note are not the same achievement.'
    : 'Every note you find banks XP toward the next level, and the ones you fumble come back sooner.';
}
function setMode(m){
  mode = m;
  highlightNav(m);
  document.getElementById('secTuner').classList.toggle('hidden', m !== 'tuner');
  document.getElementById('secFind').classList.toggle('hidden', m !== 'find');
  document.getElementById('secSongs').classList.toggle('hidden', m !== 'songs');
  // Say what this mode actually keeps, in the vocabulary of the screen you
  // are on — the game's levels, the song's own record, or nothing at all.
  gvFeedNote(m);
  tracker.reset();
  /* The mute window stops the app hearing its own voice — the scale card's
     "Hear it" sets one. Left set across a tab switch, the Tuner opened saying
     "playing the note — listen…" about a note it never played. */
  A.muteUntil = 0;
  if (m === 'find' && !(scaleMode() ? SC.run : q)) newQuestion();
  /* The scene animates only while it is on screen; the pace clock lives in
     the same loop, so leaving the tab also freezes the fuse honestly. */
  gvLoop(m === 'find');
  if (m === 'find'){
    GV.spawnAt = performance.now();   // returning ≠ time served
    // A note already ringing on arrival is never judged — it dies unjudged.
    GV.graceUntil = performance.now() + 600;
    gvFitScene();                     // the section just unhid: sizes are real now
  }
  // Leaving Songs stops its clock and its click.
  // (setMode is not called while a song is running, so this never cuts one off.)
  if (m !== 'songs') songTeardown();
  if (m === 'songs') enterSongs();
}
/* The Learn half used to hand this a spec just before navigating, so a
   practice-plan link could land CONFIGURED — a named song scrolled to and
   ringed, the drill picker pre-picked, the memory toggle pre-flipped. The plan
   that wrote those links is retired and no markup carries a data-live rider
   any more, so the whole mechanism went with it. The stub stays because the
   shell still hands BassLive a `preset` in its published surface, and a
   half-removed API is worse than an honest no-op. */
function preset(){ /* nothing configures a mode from outside any more */ }
/** The stage and string settings, wherever they are shown. Ear training kept a
    second copy of these two controls outside the console; with that mode
    retired the game's own settings card is the only place they live, so this
    is the tuner's string list plus a re-render of the console. */
function renderTierUI(){
  document.getElementById('tStrings').textContent = TUNING.names.join(' ');
  const t2 = document.getElementById('tStrings2');
  if (t2) t2.textContent = TUNING.names.join(' ');
  renderGameUI();
}
/* Stage labels the width of a phone <select>: the fret range must SURVIVE
   truncation, so the option is short and the band-stage name lives in the
   always-visible caption below instead. */
const STAGE_SHORT = ['E+A, frets 0–5', 'E+A, frets 0–12', 'E A D G, frets 0–12',
                     '+ low B, frets 0–12', 'all strings + ♯, frets 0–12'];
/** "Best <pace> set: N clean" — the run metric is clean zaps now, banked live,
    so this caption moves during play, not only at lights-out. */
function updateBestNote(){
  const el = document.getElementById('gvBestNote');
  if (!el) return;
  const n = GV.best[gvBestKey()] || 0;
  el.textContent = 'Best ' + GAME.PACES[GV.pace].label + ' set at this difficulty: ' +
    n + ' 1st-try ' + (scaleMode() ? 'run' : 'find') + (n === 1 ? '' : 's');
}
/** The whole setup in one line, on the closed settings summary: the panel is
    shut during play, so what you are playing has to be readable without
    opening it. Stage · pace · how the note is written · which strings · which
    frets — the five things that change what the game asks of you. */
function updateSetupNow(){
  const el = document.getElementById('gvSetupNow');
  if (!el) return;
  /* Scale mode's setup is two things — which rung of the ladder, and how much
     time pressure. The other three axes are Notes-mode axes and are not in
     the panel there, so they are not in its summary either. */
  const bits = scaleMode()
    ? ['Scales', 'Stage ' + (GV.scaleTier + 1), GAME.PACES[GV.pace].label,
       GV.strings5 ? '5-string' : '4-string']
    : ['Notes', 'Stage ' + (tier + 1), GAME.PACES[GV.pace].label,
       GAME.PROMPTS[GV.prompt].label,
       focus ? focus + ' string only' : 'all strings'];
  if (!scaleMode() && GV.frets !== 'all') bits.push('frets ' + FRET_WINS[GV.frets].label);
  el.textContent = bits.join(' · ');
}
/** Sync one segment's pressed state IN PLACE — rebuilding buttons with
    innerHTML on every change dropped keyboard focus mid-settings. */
function syncSeg(host, attr, isOn){
  if (!host) return;
  host.querySelectorAll('button').forEach(b => {
    const on = isOn(b.getAttribute(attr));
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
/** The game's settings card: world (the shared tier), pace, prompt, strings.
    Buttons are BUILT ONCE (options re-render only when their content really
    changes — the string list follows the tier); everything else is synced in
    place so the clicked button keeps keyboard focus. */
function renderGameUI(){
  const ws = document.getElementById('gvWorld');
  if (!ws) return;
  renderModeStrip();
  /* Short, range-always-visible option labels — no phone truncates the half a
     player needs to pick a stage. The five stages are one control with two
     meanings: how much NECK in Notes mode, and how much of the SCALE LADDER
     in scale mode — so the option text follows the mode. */
  const sig = GV.gameMode;
  if (ws.dataset.sig !== sig){
    ws.dataset.sig = sig;
    ws.innerHTML = TIERS.map((t,i) =>
      '<option value="' + i + '">Stage ' + (i+1) + ' — ' +
      (scaleMode() ? SCL.STAGES[i].name : STAGE_SHORT[i]) + '</option>').join('');
  }
  ws.value = String(gvTier());
  /* The one stage control has two meanings, so it says which one it is
     wearing: how much NECK in Notes mode, how far up the SCALE LADDER here. */
  const stLabel = document.getElementById('gvStageLabel');
  if (stLabel) stLabel.textContent = scaleMode()
    ? 'Stage — how far up the scale ladder' : 'Stage — how much of the neck is in play';
  const nowEl = document.getElementById('gvStageNow');
  if (nowEl) nowEl.textContent = scaleMode()
    ? SCL.stage(GV.scaleTier).blurb
    : 'Now playing: ' + WORLDS[Math.min(gvTier(), WORLDS.length - 1)].name;
  const ps = document.getElementById('gvPaceSeg');
  if (ps && !ps.dataset.built){
    ps.dataset.built = '1';
    ps.innerHTML = GAME.PACE_ORDER.map(p =>
      '<button data-p="' + p + '">' + GAME.PACES[p].label + '</button>').join('');
    ps.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.p === GV.pace) return;
      GV.pace = b.dataset.p; gvSave();
      renderGameUI();
      gvNewRun();          // stage lights are a per-set idea; a new pace is a new set
      newQuestion();
    }));
  }
  syncSeg(ps, 'data-p', k => k === GV.pace);
  document.getElementById('gvPaceNote').textContent = GAME.PACES[GV.pace].detail;
  const rs = document.getElementById('gvPromptSeg');
  if (rs && !rs.dataset.built){
    rs.dataset.built = '1';
    rs.innerHTML = GAME.PROMPT_ORDER.map(p =>
      '<button data-r="' + p + '">' + GAME.PROMPTS[p].label + '</button>').join('');
    rs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.r === GV.prompt) return;
      GV.prompt = b.dataset.r; gvSave();
      renderGameUI();
      // The prompt is a difficulty axis: changing it starts a new run, the
      // same way the pace handler does — no mid-run key drift.
      gvNewRun();
      newQuestion();
    }));
  }
  syncSeg(rs, 'data-r', k => k === GV.prompt);
  /* The string seg's OPTIONS follow the tier, so it re-renders only when the
     string list actually changes; focus is restored to the equivalent button. */
  const gs = document.getElementById('gvFocusSeg');
  if (gs){
    const strs = tierNow().strings;
    const sig = strs.join(',');
    if (gs.dataset.sig !== sig){
      const hadFocus = document.activeElement && gs.contains(document.activeElement)
        ? document.activeElement.getAttribute('data-f') : null;
      gs.dataset.sig = sig;
      gs.innerHTML = '<button data-f="">All strings</button>' +
        strs.map(s => '<button data-f="' + s + '">' + s + ' only</button>').join('');
      gs.querySelectorAll('button').forEach(b =>
        b.addEventListener('click', () => { focus = b.dataset.f || null; renderTierUI(); gvNewRun(); newQuestion(); }));
      if (hadFocus != null){
        const back = gs.querySelector('button[data-f="' + hadFocus + '"]') || gs.firstElementChild;
        if (back) back.focus();
      }
    }
    syncSeg(gs, 'data-f', k => (k || null) === focus);
  }
  // Fret-region focus: which stretch of the neck the questions come from.
  // Windows that miss this stage's fret range entirely are DISABLED, not
  // silently remapped — a lit-but-dead button teaches distrust.
  const frs = document.getElementById('gvFretSeg');
  if (frs){
    if (!frs.dataset.built){
      frs.dataset.built = '1';
      frs.innerHTML = FRET_ORDER.map(k =>
        '<button data-fr="' + k + '">' + FRET_WINS[k].label + '</button>').join('');
      frs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.fr === GV.frets || b.getAttribute('aria-disabled') === 'true') return;
        GV.frets = b.dataset.fr; gvSave();
        renderGameUI();
        // The fret window is a difficulty axis too: a new window is a new run,
        // banked under its own best-run key.
        gvNewRun();
        newQuestion();
      }));
    }
    /* A window is dead when it intersects fewer than 4 positions on this
       stage — not only when it misses the stage entirely: a one-fret sliver
       asks the same two notes forever. Dead buttons stay FOCUSABLE
       (aria-disabled, not disabled) and point at the visible reason below —
       title tooltips do not exist on touch. */
    const deadLabels = [];
    frs.querySelectorAll('button').forEach(b => {
      const r = FRET_WINS[b.dataset.fr] && FRET_WINS[b.dataset.fr].range;
      const dead = fretWinPositions(r) < 4;
      b.setAttribute('aria-disabled', String(dead));
      if (dead){
        b.setAttribute('aria-describedby', 'gvFretNote');
        deadLabels.push(FRET_WINS[b.dataset.fr].label);
      } else b.removeAttribute('aria-describedby');
    });
    const fretNote = document.getElementById('gvFretNote');
    if (fretNote){
      fretNote.textContent = deadLabels.length
        ? deadLabels.join(' and ') + (deadLabels.length === 1 ? ' needs' : ' need') +
          ' a later stage — too few notes there on this one.'
        : '';
      fretNote.classList.toggle('hidden', !deadLabels.length);
    }
    // If the stage shrank under the current window, snap to All — visibly.
    const cur = FRET_WINS[GV.frets] && FRET_WINS[GV.frets].range;
    if (cur && fretWinPositions(cur) < 4){ GV.frets = 'all'; gvSave(); }
    syncSeg(frs, 'data-fr', k => k === GV.frets);
  }
  // Effects: Full / Calm — Calm forces the reduced-motion path regardless of
  // the OS setting. Sound: the WebAudio cues. Both persist with the prefs.
  const fx = document.getElementById('gvFxSeg');
  if (fx && !fx.dataset.built){
    fx.dataset.built = '1';
    fx.innerHTML = [['full','Full'], ['calm','Calm']].map(([k, label]) =>
      '<button data-fx="' + k + '">' + label + '</button>').join('');
    fx.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.calm = b.dataset.fx === 'calm';
      updateReduced(); gvSave(); renderGameUI();
    }));
  }
  syncSeg(fx, 'data-fx', k => (k === 'calm') === GV.calm);
  const snd = document.getElementById('gvSndSeg');
  if (snd && !snd.dataset.built){
    snd.dataset.built = '1';
    snd.innerHTML = [['true','On'], ['false','Off']].map(([k, label]) =>
      '<button data-snd="' + k + '">' + label + '</button>').join('');
    snd.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.sound = b.dataset.snd === 'true';
      gvSave(); renderGameUI();
    }));
  }
  syncSeg(snd, 'data-snd', k => (k === 'true') === GV.sound);
  /* How many strings the bass has. Scale mode's top rung anchors shapes on the
     low B; a four-string player had no way out of a third of its questions. */
  const strs = document.getElementById('gvStringsSeg');
  if (strs && !strs.dataset.built){
    strs.dataset.built = '1';
    strs.innerHTML = [['4','4 strings'], ['5','5 strings (low B)']].map(([k, label]) =>
      '<button data-str="' + k + '">' + label + '</button>').join('');
    strs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const five = b.dataset.str === '5';
      if (five === GV.strings5) return;
      GV.strings5 = five; gvSave(); renderGameUI();
      gvNewRun(); newQuestion();     // a different neck is a different set
    }));
  }
  syncSeg(strs, 'data-str', k => (k === '5') === GV.strings5);
  /* The ladder, where the stage select can see it: this rung, and what the
     next one adds. */
  const ladder = document.getElementById('gvScaleLadder');
  if (ladder){
    const next = GV.scaleTier + 1 < SCL.STAGES.length
      ? ' Next: ' + SCL.STAGES[GV.scaleTier + 1].name.toLowerCase() + '.' : ' This is the last rung.';
    ladder.textContent = SCL.STAGES.map((s, i) => (i + 1) + ' ' + s.name).join(' · ') + '.' + next;
  }
  /* Both notes below the panel describe the payout and the combo, and both
     mean something different in a mode where one question is six notes. */
  const xpNote = document.getElementById('gvXpNote');
  if (xpNote) xpNote.textContent = scaleMode()
    ? 'A run pays by its length: six notes are worth six notes. Bigger stages and faster paces pay more again.'
    : 'Bigger stages, sheet music and faster paces pay more XP.';
  const comboNote = document.getElementById('gvComboNote');
  if (comboNote) comboNote.textContent = scaleMode()
    ? 'One RUN = one chord\'s shape played through. One SET = until the stage lights go out. COMBO counts runs nailed first try in a row this set; the tiles under the console count the whole session (since the page loaded).'
    : 'COMBO = 1st-try finds in a row this set; the streak tile under the question is your whole session.';
  syncPromptLayout();
  updateSetupNow();
  updateBestNote();
  drawClefRef();
  renderNoteMap();   // the map follows the stage it is dimming against
  gvFitScene();   // entering/re-rendering the game: keep the pixels integer
}

/** Whether this console reserves room for a staff at all.

    The constant-height contract is per PROMPT MODE, not across them: its job
    is that nothing moves WHILE YOU PLAY, and changing the prompt is a settings
    change that already restarts the run. So:
      · Sheet music reserves the staff slot — it is the question.
      · Mixed reserves it too: the prompt flips per QUESTION there, and a
        console that changed height every other question would be the exact
        defect this whole design exists to prevent.
      · Names reserves NOTHING. The slot is removed, not emptied — 154px of
        held-open air in the middle of the mode most people play is a third of
        the card doing nothing.
    Read from GV.prompt (the setting), never GV.promptKind (this question's
    coin flip), or Mixed would jump. */
function syncPromptLayout(){
  const sec = document.getElementById('secFind');
  if (!sec) return;
  const scale = scaleMode();
  /* Scale mode is a mode of its own, with its own constant height: it never
     draws a staff, it always uses the reserved compartment (the chart while
     you play, the box once the answer is out), and it adds the pip row. */
  sec.classList.toggle('gv-scales', scale);
  sec.classList.toggle('gv-nostaff', !scale && GV.prompt === 'name');
  /* The compartment has one occupant at a time, and its occupants belong to
     different modes: leaving scale mode takes the chart and the box with it,
     or a staff question would land beside a chord chart. */
  if (!scale) scShowMedia(null);
  /* The verdict banner is Notes mode's spoken channel — one note, one verdict.
     A six-note run would make it chatter, so in scale mode it goes quiet and
     #gvLive speaks instead: the chord, a wrong note, and the outcome. */
  const v = document.getElementById('fVerdict');
  if (v) v.setAttribute('aria-live', scale ? 'off' : 'polite');
  /* The session tiles count the same things in both games, but the first one
     counts questions FOUND — and in scale mode a question is a whole run. */
  const found = document.querySelector('#fScore + span');
  if (found) found.textContent = scale ? 'runs' : 'found';
  /* The clef guide teaches a staff scale mode never draws: it is reference for
     the OTHER game, and a card offering to explain something not on screen is
     one more thing to wade past. It goes away here (and shuts, so it cannot
     come back open in a mode that has no use for it). */
  const clef = document.getElementById('gvClefHelp');
  if (clef){
    if (scale) clef.open = false;
    clef.classList.toggle('hidden', scale);
  }
}
/** The mode strip: what the game asks for. Built once, synced in place — the
    same rule the settings segments follow, so a click never costs its focus. */
function renderModeStrip(){
  const host = document.getElementById('gvModes');
  if (!host) return;
  if (!host.dataset.built){
    host.dataset.built = '1';
    host.querySelectorAll('button[data-gm]').forEach(b =>
      b.addEventListener('click', () => setGameMode(b.dataset.gm)));
    /* The "soon" entries are not controls. They stay focusable so a screen
       reader can find out what is coming, and they do nothing when pressed. */
    host.querySelectorAll('button[data-soon]').forEach(b =>
      b.addEventListener('click', e => e.preventDefault()));
  }
  host.querySelectorAll('button[data-gm]').forEach(b => {
    const on = b.dataset.gm === GV.gameMode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
/** Switch what the game asks for. A different question is a different set, so
    it starts a new run — exactly like changing the pace or the stage. */
function setGameMode(m){
  if (m !== 'notes' && m !== 'scales') return;
  if (m === GV.gameMode) return;
  GV.gameMode = m;
  gvSave();
  gvFeedNote(mode);
  syncPromptLayout();
  renderModeStrip();
  renderGameUI();
  gvNewRun();
  /* Spoken as the lead of the next question's announcement, so a mode switch
     is one utterance ("Scales. Next chord: A minor 7…") instead of two
     fighting over the live region. */
  GV.srToast = m === 'scales' ? 'Scales — a chord, and you play its box'
                              : 'Notes — one note at a time';
  newQuestion();
  /* WHAT A BOX IS, once, the first time this mode is entered — the word was
     load-bearing and undefined, and a beginner cannot ask a game what a word
     means. newQuestion has just written the standing instruction, so this
     lands after it and stands until the next question replaces it. */
  if (m === 'scales' && !SC.saidBox){
    SC.saidBox = true;
    /* In the VERDICT slot, not the instruction line: the instruction line is
       one line tall by contract and this is three. The first verdict of the
       first run replaces it, which is exactly how long it should last. */
    const v = document.getElementById('fVerdict');
    if (v){
      v.textContent = 'A box is a shape you can put your hand on: six notes ' +
        'across three strings, four frets wide — learn it once and slide it.';
      v.className = 'verdict teach';
    }
  }
  gvFitScene();
}

/** The note map's own controls. Built once, synced in place — same rule as the
    difficulty panel's segments, so a click never costs the button its focus. */
function renderMapUI(){
  const sp = document.getElementById('gvMapSpellSeg');
  if (sp && !sp.dataset.built){
    sp.dataset.built = '1';
    sp.innerHTML = [['natural','Naturals only'], ['sharp','Sharps ♯'], ['flat','Flats ♭']]
      .map(([k, label]) => '<button data-sp="' + k + '">' + label + '</button>').join('');
    sp.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.map.spell = b.dataset.sp; gvSave(); renderMapUI(); renderNoteMap();
    }));
  }
  syncSeg(sp, 'data-sp', k => k === GV.map.spell);
  const sc = document.getElementById('gvMapScopeSeg');
  if (sc && !sc.dataset.built){
    sc.dataset.built = '1';
    sc.innerHTML = [['stage','This stage'], ['all','Whole neck']]
      .map(([k, label]) => '<button data-sc="' + k + '">' + label + '</button>').join('');
    sc.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.map.stage = b.dataset.sc === 'stage'; gvSave(); renderMapUI(); renderNoteMap();
    }));
  }
  syncSeg(sc, 'data-sc', k => (k === 'stage') === GV.map.stage);
  const wk = document.getElementById('gvMapWeakSeg');
  if (wk && !wk.dataset.built){
    wk.dataset.built = '1';
    wk.innerHTML = [['off','Off'], ['on','Show']]
      .map(([k, label]) => '<button data-wk="' + k + '">' + label + '</button>').join('');
    wk.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.map.weak = b.dataset.wk === 'on'; gvSave(); renderMapUI(); renderNoteMap();
    }));
  }
  syncSeg(wk, 'data-wk', k => (k === 'on') === GV.map.weak);
}
/* ================= THE SCALE CARD =================
   Scale mode's reference, standing beside the note map: a root, a scale, and
   two ways to look at it —

     · THE BOX — the moveable shape, with the FINGER for every note on its
       dot. For the two pentatonics this is exactly the six notes the game
       grades (BassScales.boxShape), so what you study is what you are asked
       for; for the fuller scales it is the four-fret window the hand covers
       at that position, which is what the old Scale explorer drew.
     · THE WHOLE NECK — every place that scale lives between frets 0 and 12.

   …and one more switch: dots say note NAMES or scale DEGREES. Everything here
   is display; nothing in it is read by the game. */
const SC_STUDY_VIEWS = [['box', 'The hand shape'], ['neck', 'Whole neck']];
/* One scale vocabulary for this half of the app. `iv` is the interval
   recipe, `deg` is what the dots say when the card is showing degrees.
   It was the pattern drills' table too, until they were retired. */
const SCALES = {
  minPent:{ name:'Minor pentatonic', iv:[0,3,5,7,10],       deg:['R','b3','4','5','b7'] },
  natMinor:{ name:'Natural minor',   iv:[0,2,3,5,7,8,10],   deg:['R','2','b3','4','5','b6','b7'] },
  majPent:{ name:'Major pentatonic', iv:[0,2,4,7,9],        deg:['R','2','3','5','6'] },
  major:{ name:'Major scale',        iv:[0,2,4,5,7,9,11],   deg:['R','2','3','4','5','6','7'] },
  blues:{ name:'Blues scale',        iv:[0,3,5,6,7,10],     deg:['R','b3','4','b5','5','b7'] }
};
function studyScale(){ return SCALES[GV.study.type] || SCALES.minPent; }
/** The name of the study card's root, spelled the way the rest of this half
    spells notes (sharps; the caption names the flat twin). */
function studyRootName(){ return disp(C.NAMES[GV.study.root]); }
/** Which of the game's two boxes this scale IS, or null when the scale is
    bigger than a box (the fuller scales get a window instead). */
function studyBoxKey(){
  return GV.study.type === 'minPent' ? 'minPent'
       : GV.study.type === 'majPent' ? 'majPent' : null;
}
/** Where a window-style box sits for a root: the lowest fret from 1 up, on
    the lowest string that can host the whole span. Same rule the game's
    anchorFor uses, applied to a scale that has no six-note shape. */
function studyWindowAnchor(span){
  for (let f = 1; f + span <= 12; f++){
    for (let si = 0; si <= 2; si++){
      if (((TUNING.midi[si] + f) % 12 + 12) % 12 === GV.study.root) return { si, fret:f };
    }
  }
  return { si:0, fret:1 };
}
function renderScaleStudyUI(){
  const rs = document.getElementById('gvScRootSeg');
  if (rs && !rs.dataset.built){
    rs.dataset.built = '1';
    rs.innerHTML = C.NAMES.map((n, i) =>
      '<button data-sr="' + i + '">' + disp(n) + '</button>').join('');
    rs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.study.root = +b.dataset.sr; gvSave(); renderScaleStudyUI(); renderScaleStudy();
    }));
  }
  syncSeg(rs, 'data-sr', k => +k === GV.study.root);
  const ts = document.getElementById('gvScTypeSeg');
  if (ts && !ts.dataset.built){
    ts.dataset.built = '1';
    ts.innerHTML = STUDY_TYPES.map(k =>
      '<button data-st="' + k + '">' + SCALES[k].name + '</button>').join('');
    ts.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.study.type = b.dataset.st; gvSave(); renderScaleStudyUI(); renderScaleStudy();
    }));
  }
  syncSeg(ts, 'data-st', k => k === GV.study.type);
  const vs = document.getElementById('gvScViewSeg');
  if (vs && !vs.dataset.built){
    vs.dataset.built = '1';
    vs.innerHTML = SC_STUDY_VIEWS.map(([k, label]) =>
      '<button data-sv="' + k + '">' + label + '</button>').join('');
    vs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.study.view = b.dataset.sv; gvSave(); renderScaleStudyUI(); renderScaleStudy();
    }));
  }
  syncSeg(vs, 'data-sv', k => k === GV.study.view);
  const ls = document.getElementById('gvScLabelSeg');
  if (ls && !ls.dataset.built){
    ls.dataset.built = '1';
    ls.innerHTML = [['names', 'Note names'], ['degrees', 'Step numbers']].map(([k, label]) =>
      '<button data-sl="' + k + '">' + label + '</button>').join('');
    ls.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      GV.study.labels = b.dataset.sl; gvSave(); renderScaleStudyUI(); renderScaleStudy();
    }));
  }
  syncSeg(ls, 'data-sl', k => k === GV.study.labels);
  updateScaleNow();
}
function updateScaleNow(){
  const el = document.getElementById('gvScaleNow');
  if (!el) return;
  el.textContent = studyRootName() + ' ' + studyScale().name.toLowerCase() + ' · ' +
    (GV.study.view === 'box' ? 'box' : 'whole neck') +
    (GV.study.labels === 'degrees' ? ' · step numbers' : '');
}
/** The notes of the current pick, as positions on the neck. */
function studyMarkers(){
  const sc = studyScale();
  const rootPc = GV.study.root;
  const inScale = new Set(sc.iv.map(i => (rootPc + i) % 12));
  const degOf = {};
  sc.iv.forEach((i, k) => degOf[(rootPc + i) % 12] = sc.deg[k]);
  const pcAt = (si, f) => (((TUNING.midi[si] + f) % 12) + 12) % 12;
  const labelFor = p => GV.study.labels === 'degrees' ? degOf[p] : disp(C.NAMES[p]);
  if (GV.study.view === 'box'){
    const boxKey = studyBoxKey();
    if (boxKey){
      /* THE SHAPE THE GAME GRADES — the same six notes, in the same place,
         with the fingering the box is taught with. */
      const a = SCL.anchorFor({ rootPc, scaleKey:boxKey, tuning:TUNING, maxFret:12 });
      const shape = SCL.boxShape({ scaleKey:boxKey, si:a.si, fret:a.fret, tuning:TUNING });
      const fingers = SCL.boxFingers(boxKey);
      const frets = shape.map(t => t.fret);
      return {
        markers: shape.map((t, i) => ({
          si:t.si, fret:t.fret, kind: t.degree === 'R' ? 'root' : 'tone',
          label: labelFor(pcAt(t.si, t.fret)), finger: String(fingers[i]),
        })),
        window: [Math.min.apply(null, frets), Math.max.apply(null, frets)],
        anchor: a, graded: true,
      };
    }
    /* A scale too big for a box: the four (or five) frets the hand covers at
       that position, every scale note in them — the Scale explorer's box. */
    const span = sc.iv.length > 5 ? 4 : 3;
    const a = studyWindowAnchor(span);
    const markers = [];
    for (let si = 0; si < TUNING.names.length; si++){
      for (let f = a.fret; f <= a.fret + span; f++){
        const p = pcAt(si, f);
        if (!inScale.has(p)) continue;
        markers.push({ si, fret:f, kind: p === rootPc ? 'root' : 'tone',
                       label: labelFor(p), finger: String(Math.min(4, f - a.fret + 1)) });
      }
    }
    return { markers, window:[a.fret, a.fret + span], anchor:a, graded:false };
  }
  const markers = [];
  for (let si = 0; si < TUNING.names.length; si++){
    for (let f = 0; f <= 12; f++){
      const p = pcAt(si, f);
      if (!inScale.has(p)) continue;
      markers.push({ si, fret:f, kind: p === rootPc ? 'root' : 'tone', label: labelFor(p) });
    }
  }
  return { markers, window:null, anchor:null, graded:false };
}
function renderScaleStudy(){
  const card = document.getElementById('gvScaleStudy');
  const host = document.getElementById('gvScBoard');
  if (!card || !host) return;
  if (!card.open){ host.innerHTML = ''; return; }
  const sc = studyScale();
  const { markers, window: win, anchor, graded } = studyMarkers();
  const box = GV.study.view === 'box';
  const wide = matchMedia('(min-width:1000px)').matches;
  /* The box view needs a scale that DRAWS FINGERS (the renderer drops the
     badge on boards too small to read it), so it never uses the reference
     sizes — it is the one board here you are meant to put your hand on. */
  const scale = box ? (wide ? 'desk' : 'play')
              : (wide ? 'desk' : matchMedia('(min-width:760px)').matches ? 'readbig' : 'read');
  const from = box ? Math.max(0, win[0] - 1) : 0;
  const to = box ? Math.min(12, win[1] + 1) : 12;
  /* In box view the strings the shape never touches are drawn muted: the box
     is a HAND POSITION, and three lit strings out of five say so at a glance. */
  const used = new Set(markers.map(m => m.si));
  BassNeck.render(host, {
    strings: TUNING.names, fromFret: from, toFret: to, scale, markers,
    dimStrings: box ? TUNING.names.map((_, i) => i).filter(i => !used.has(i)) : [],
    window: box ? win : null,
    windowLabel: box ? 'BOX · FRET ' + win[0] : false,
    title: studyRootName() + ' ' + sc.name.toLowerCase() +
      (box ? ', the hand shape at fret ' + win[0] + ', with a finger number on every note'
           : ', every place it sits between frets 0 and 12'),
  });
  const chips = document.getElementById('gvScChips');
  if (chips){
    chips.innerHTML = sc.iv.map((i, k) => {
      const p = (GV.study.root + i) % 12;
      return '<span class="' + (k === 0 ? 'root' : '') + '">' + disp(C.NAMES[p]) +
        '<small>' + String(sc.deg[k]).replace(/^b(?=[0-9])/, '♭') + '</small></span>';
    }).join('');
  }
  const note = document.getElementById('gvScNote');
  if (note){
    note.innerHTML = box
      ? (graded
        ? 'This is the shape the game asks for: six notes, low to high, starting on <b>the ' +
          TUNING.names[anchor.si] + ' string at fret ' + anchor.fret + '</b>. The number on each dot is the ' +
          '<b>finger</b> — 1 index, 2 middle, 3 ring, 4 pinky — one finger per fret. Slide the whole ' +
          'shape up or down and the finger numbers never change: that is the point of it.'
        : 'The four frets your hand covers at fret ' + anchor.fret + ', with every ' + studyRootName() + ' ' +
          sc.name.toLowerCase() + ' note in them. The number on each dot is the <b>finger</b> — one per fret.')
      : 'Every <b>' + studyRootName() + ' ' + sc.name.toLowerCase() + '</b> note between frets 0 and 12. ' +
        'The same shape keeps coming back — that is the hand shape, in every place it fits.';
    note.classList.remove('hidden');
  }
  const recipe = document.getElementById('gvScRecipe');
  if (recipe){
    const steps = [];
    for (let i = 1; i < sc.iv.length; i++) steps.push('+' + (sc.iv[i] - sc.iv[i - 1]));
    steps.push('+' + (12 - sc.iv[sc.iv.length - 1]) + ' → R');
    recipe.textContent = 'Frets between the notes: start ' + steps.join(' ') +
      ' — the same jumps from any starting note.';
  }
  updateScaleNow();
}
/** Play the picture: the notes on the board, low to high and back. */
function studyPlay(){
  const { markers } = studyMarkers();
  const seq = markers.map(m => TUNING.midi[m.si] + m.fret)
    .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const one = seq.filter(m => m >= seq[0] && m <= seq[0] + 12);
  stopStudyPlay();
  one.forEach((midi, i) => studyTimers.push(setTimeout(() => playNote(midi), i * 520)));
}
let studyTimers = [];
function stopStudyPlay(){ studyTimers.forEach(clearTimeout); studyTimers = []; }
(function wireScaleCard(){
  const card = document.getElementById('gvScaleStudy');
  if (!card) return;
  card.addEventListener('toggle', () => {
    if (!card.open){ stopStudyPlay(); return; }
    renderScaleStudyUI();
    renderScaleStudy();
  });
  window.addEventListener('resize', () => { if (card.open) renderScaleStudy(); });
  const play = document.getElementById('gvScPlay');
  if (play) play.addEventListener('click', studyPlay);
  /* The summary's status line names the current pick before the card has ever
     been opened — and reading it needs the scale table, which is declared
     further down this file, so it lands after this script has finished. */
  setTimeout(updateScaleNow, 0);
})();

/* Opening the map is when it gets drawn: a shut <details> has no width to lay
   a fretboard out in, and a board nobody has asked for is work nobody wanted. */
(function wireMap(){
  const card = document.getElementById('gvMap');
  if (!card) return;
  renderMapUI();
  card.addEventListener('toggle', () => { if (card.open) renderNoteMap(); });
  // The board's size follows the viewport (desk / readbig / read), so a
  // rotated phone or a resized window redraws it — only while it is open.
  window.addEventListener('resize', () => { if (card.open) renderNoteMap(); });
})();

/* One button, one click: it grants the mic AND starts what you came for. The
   mode is set BEFORE the panel is shown, so the panel never appears for a
   frame with the wrong mode — or no mode — on it. */
document.getElementById('startBtn').addEventListener('click', async () => {
  const want = pendingMode || mode;
  if (!await startListening()) return;
  setMode(want);
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  /* Only now is #app visible, so only now do the scene's sizes read real —
     setMode's own gvFitScene saw clientWidth 0 on this first-entry path,
     which is exactly how phones ended up with a 320×151.06 canvas. */
  gvFitScene();
});
document.getElementById('deviceSel').addEventListener('change', e => startListening(e.target.value));

/* The stage is a difficulty axis of the game: changing it starts a new run,
   exactly like the pace handler — the best-run key was snapshotted at run
   start and must never drift mid-run. */
document.getElementById('gvWorld').addEventListener('change', e => {
  /* ONE control, TWO ladders. In scale mode this moves the scale rung and
     leaves the Notes tier exactly where it was — the two are stored apart,
     so neither game can drag the other up its own ladder. */
  if (scaleMode()){
    GV.scaleTier = Math.min(SCL.STAGES.length - 1, Math.max(0, +e.target.value | 0));
    gvSave(); renderGameUI(); gvNewRun(); newQuestion();
    return;
  }
  tier = +e.target.value; focus = null; persistTier(); renderTierUI(); gvNewRun(); newQuestion();
});
document.getElementById('fSkip').addEventListener('click', () => {
  if (GV.run && GV.run.state.over) return;   // Play again is the only door now
  if (scaleMode() ? !SC.run : !q) return;
  if (GV.phase === 'zap' || GV.phase === 'breach' || GV.phase === 'hold') return;   // a verdict is settling
  /* SCALE MODE's Show me is the same door with the same price: it names the
     scale the chord wanted, draws the box, breaks the streak and moves on —
     and, like a burnt fuse, it does not refill the clock. */
  if (scaleMode()){
    const leftMs = gvFuseMs();
    if (leftMs != null && GV.phase === 'fight'){
      /* A carry has a FLOOR here. Show me late in a fuse could hand the next
         chord ~150ms, which burnt a stage light on a chord the player never
         touched: whatever is left, the next run gets at least 40% of a full
         one. (Nothing is refilled — a skip is still never free time.) */
      const left = Math.max(0, leftMs - (performance.now() - GV.spawnAt) - 1000);
      GV.carryFuseMs = Math.max(left, Math.round(leftMs * 0.4));
    }
    scAsk();
    sess.find.streak = 0;
    gvJudge('skip');
    scRecord(false);
    const shown = scReveal('');
    srAnnounce(shown + ' The shape is drawn under the chord. Same chord again next.');
    GV.phase = 'hold';
    GV.breachT = performance.now();
    updateFindStats();
    /* The same chord comes back immediately, uncredited, with the shape still
       on screen — otherwise the drawing teaches for three seconds and the
       game asks something else. */
    scBookRepose();
    GV.nextQTimer = setTimeout(newQuestion, 3400);
    return;
  }
  /* SHOW ME is the only "I don't know" the game has, and it is a teaching
     door, not a trapdoor: it names the note, the string and the fret (and the
     written position in reading mode), breaks the session streak, banks a SOFT
     miss (position heat + recent, but not the shared accuracy — asking to be
     shown is not a wrong answer), books the comeback, and holds the correction
     as long as a burnt fuse does so it can actually be read. */
  const v = document.getElementById('fVerdict');
  /* A reading question's correction reads the page too, and shows the named
     staff — the same teaching the breach and zap paths give. */
  let skipPage = '';
  if (GV.promptKind === 'staff'){
    skipPage = ' — written ' + GAME.staffPosName(
      GAME.staffSpec(q.midi, qFlat ? { prefer:'flat' } : undefined).pos);
    drawStaff(document.getElementById('gvStaff'), q.midi, { showName:true, flat:qFlat });
    /* The answer is in: the picture the player should leave with is the
       named note on the page. */
    gvShowStaff(true);
  }
  /* A skip must not refill the fuse: whatever was left is what the next
     question starts with (gvSpawn consumes the carry) — MINUS a ~1s toll,
     so skipping is never free time on the clock. The verdict says the carry
     out loud, or the shorter next fuse reads as a broken timer. */
  const msLeft = gvFuseMs();
  const carrying = msLeft != null && GV.phase === 'fight';
  if (carrying){
    GV.carryFuseMs = Math.max(0, msLeft - (performance.now() - GV.spawnAt) - 1000);
  }
  v.textContent = 'That one was ' + dispQ() + ' — ' + q.sn + ' string, fret ' + q.f +
    skipPage + (carrying ? ' — the fuse carries over.' : '. It will come back.');
  v.className = 'verdict warn';
  sess.find.streak = 0;
  sess.find.asked++;                         // a skipped question was still posed
  const key = q.sn + ':' + q.f;
  /* Bank the soft miss ONLY if no miss is banked yet: a skip after a recorded
     wrong answer was double-writing this question into heat + noteRecent.
     The comeback booking and the streak break stand either way. */
  if (wrongThisQ === 0){
    saveStats(st => {
      st.heat[key] = (st.heat[key] || 0) + 1;
      st.noteRecent = st.noteRecent || {};
      const nr = st.noteRecent[key] || (st.noteRecent[key] = []);
      nr.push(0);
      if (nr.length > 6) nr.shift();
    });
  }
  reviewQ.add(key, qCount);
  gvJudge('skip');                           // shown, not found: the combo goes
  /* A distinct HOLD phase, not a fake breach: no smoke, no misfire fiction —
     the cannon just settles (drawScene dips the barrel 1px) while the
     correction line shows. Judging stays closed until the next question. */
  GV.phase = 'hold';
  GV.breachT = performance.now();
  updateFindStats();
  // The correction line IS the teaching — hold it as long as a breach holds.
  GV.nextQTimer = setTimeout(newQuestion, 2600);
});
/* The staff pointer in #fSub is a real link: it opens the clef teaching card
   and goes there. Delegated, because #fSub is rewritten per question. */
document.getElementById('fSub').addEventListener('click', e => {
  /* Two teaching links live in this line, one per game: the clef card for a
     staff question, and the Scale card for the word "box". Same door either
     way — open the card and go to it. */
  const a = e.target.closest('.gv-staffhelp-link, .gv-boxhelp-link');
  if (!a) return;
  e.preventDefault();
  const card = document.getElementById(a.classList.contains('gv-boxhelp-link')
    ? 'gvScaleStudy' : 'gvClefHelp');
  if (!card) return;
  if (!card.open){
    card.open = true;
    card.dispatchEvent(new Event('toggle'));   // the card draws on open
  }
  card.scrollIntoView({ block:'start', behavior: REDUCED ? 'auto' : 'smooth' });
});
document.getElementById('gvRestart').addEventListener('click', () => {
  gvNewRun();
  newQuestion();
  /* The overlay that held focus is gone — send focus somewhere real (Show me,
     just re-enabled: the only control the play area has) instead of letting it
     fall to <body>, which strands a screen reader at the top of the document. */
  const s = document.getElementById('fSkip');
  if (s) s.focus();
});
renderTierUI();
gvNewRun();   // XP loaded, stage lights on, before the first question can spawn

// Offer help when the player stops making progress — whether that is silence,
// or being stuck holding one wrong note (which fires only a single verdict).
// Once they've already missed, help arrives sooner.
setInterval(() => {
  if (mode !== 'find' || (scaleMode() ? !SC.run : !q)) return;
  // Not while a verdict settles, and never over the game-over screen.
  if (GV.phase === 'zap' || GV.phase === 'breach' || GV.phase === 'hold') return;
  if (GV.run && GV.run.state.over) return;
  const stalledFor = performance.now() - lastProgressAt;
  /* The pre-miss nudge halves when the pace's fuse is shorter than it —
     Encore's 7s fuse outran the 10s nudge, so the nudge never existed there. */
  const fuseMs = gvFuseMs();
  const nudgeAt = (fuseMs != null && fuseMs < 10000) ? 5000 : 10000;
  if (stalledFor <= (wrongThisQ > 0 ? 4500 : nudgeAt)) return;
  /* Silence is often DELIBERATE work — reading the neck, counting frets,
     thinking down a 14-second fuse — so this is a pointer, once per question,
     and never a spoiler: the answer stays behind a button the player presses.
     It names what Show me actually does, because the honest price (a soft
     miss, and the note comes back) is what makes it worth pressing. */
  if (!nudgedThisQ){
    nudgedThisQ = true;
    /* Two doors, not one: the free card below shows every shape and costs
       nothing, and pointing only at the paid button read as a shakedown. */
    subWrite(scaleMode()
      ? 'Stuck? The <a href="#" class="gv-boxhelp-link">Scale card</a> below is free — ' +
        'or <b>Show me</b> draws this one.'
      : 'Stuck? <b>Show me</b> names it and moves you on — it comes back later.');
  }
}, 700);

/* ---------------- metronome (Web Audio, no assets) ----------------
   Written for the pattern drills, which graded a run against the click; they
   are retired and the click outlived them, because a play-along still needs a
   grid to sit on. Nothing measures a note's distance from a beat any more, so
   the detection-latency constant that scoring depended on went with it. */
const MET = { timer:null, next:0, beat:0, bpm:null, firstPerf:0, accentEvery:4 };
function metStop(){ if (MET.timer){ clearInterval(MET.timer); MET.timer = null; } MET.bpm = null; }
/**
 * Start the click at `bpm` (Songs runs at the song's own tempo); returns the
 * performance.now() of the FIRST click, so a play-along can put its beat 1 on
 * the click grid instead of guessing.
 */
function metStart(bpm, accentEvery){
  if (!A.ctx) return null;
  metStop();
  MET.bpm = bpm || null;
  MET.accentEvery = accentEvery || 4;
  MET.next = A.ctx.currentTime + 0.2; MET.beat = 0;
  MET.firstPerf = performance.now() + (MET.next - A.ctx.currentTime) * 1000;
  // Lookahead scheduling: setInterval alone drifts audibly within a few bars.
  MET.timer = setInterval(() => {
    const period = 60 / (MET.bpm || 60);
    while (MET.next < A.ctx.currentTime + 0.15){
      metClick(MET.next, MET.beat % MET.accentEvery === 0);
      MET.next += period; MET.beat++;
    }
  }, 25);
  return MET.firstPerf;
}
function metClick(at, accent){
  // ~1.4 kHz and 50 ms: far above the 27–420 Hz the pitch detector looks at,
  // so the click cannot be mistaken for a played note.
  const o = A.ctx.createOscillator(), g = A.ctx.createGain();
  o.type = 'square'; o.frequency.value = accent ? 2000 : 1400;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(accent ? 0.20 : 0.12, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  o.connect(g); g.connect(A.ctx.destination);
  o.start(at); o.stop(at + 0.06);
}

/* ==================================================================
   SONGS — playing along, either with the record or with the app's own
   click. The roadmaps and the judging live in shared/songs.js; this is
   only its interface. Its state is kept in its OWN localStorage key:
   plays and best root accuracy belong to the song, and the game's own
   memory is never touched.
   ================================================================== */
const SGE = window.BassSongs;
const SONG_KEY = 'bassTrainer.songs.v1';
const SG = {
  song:null, play:null,            // play: 'record' | 'click'
  t0:null, run:null, timer:null, boardApi:null,
  // startAt: when the SONG starts (after the count-in). t0: the virtual origin
  // of song time, which is startAt minus however much of the roadmap is being
  // skipped when a play begins part-way in.
  startAt:null, startSection:0, seen:null,
  rootShown:null, resyncs:0, finished:false,
  // memory: what the arm-screen toggle says. memoryRun: what THIS run is —
  // pinned at arm time, so flipping the toggle mid-run cannot re-label a play
  // that spent half its length with the roadmap showing.
  memory:false, memoryRun:false,
  tally:{ correct:0, wrong:0 }, last:null
};
/* A memory day is banked from a full-tempo, full-roadmap memory play at this
   bar — and gig-ready is two of them on distinct days (BassSongs.songReadiness). */
const MEMORY_BAR = 0.9;

function loadSongStore(){
  try { return JSON.parse(localStorage.getItem(SONG_KEY)) || {}; } catch(e){ return {}; }
}
function saveSongPlay(song, accuracy, bankable, cov, memory){
  const all = loadSongStore();
  const rec = all[song.id] || { id:song.id, plays:0, bestAccuracy:0, lastPlayed:null };
  rec.id = song.id;
  rec.plays = (rec.plays || 0) + 1;
  rec.lastPlayed = todayISO();
  // Only the click can grade: with a record playing, the app cannot know the
  // record was where you tapped, and a phone mic may be hearing the record.
  // And a "best" is a claim about the WHOLE roadmap, so only a play that
  // actually covered the roadmap may bank one — two of five sections used to.
  if (bankable && accuracy > (rec.bestAccuracy || 0)){
    rec.bestAccuracy = accuracy;
    rec.bestSections = (cov && cov.sections) || 0;
    rec.bestOf = (cov && cov.of) || song.sections.length;
    rec.bestFull = !!(cov && cov.full);
    rec.bestDate = todayISO();
  }
  // Memory-mode bests are ADDITIVE fields only: an old store must load
  // unchanged, and nothing above may move to accommodate these.
  if (bankable && memory){
    rec.memoryBest = Math.max(Number(rec.memoryBest) || 0, accuracy);
    if (accuracy >= MEMORY_BAR){
      // Distinct DAYS: a second 90%+ play tonight is a better evening, not a
      // second day of proof.
      rec.memoryDays = Array.isArray(rec.memoryDays) ? rec.memoryDays : [];
      if (rec.memoryDays.indexOf(todayISO()) < 0) rec.memoryDays.push(todayISO());
    }
  }
  all[song.id] = rec;
  try { localStorage.setItem(SONG_KEY, JSON.stringify(all)); } catch(e){}
  return rec;
}
function songById(id){
  return SGE.SONGS.filter(s => s.id === id)[0] || null;
}
function setTxt(id, s){
  const el = document.getElementById(id);
  if (el && el.textContent !== s) el.textContent = s;
}

/* ---------------- the list of five ---------------- */
function songStrip(song){
  return '<div class="sg-strip">' + song.sections.map(s =>
    '<span class="sg-seg"><b>' + s.name + '</b> <i>' + s.root + '</i> <span class="t-data">' +
    s.bars + ' bars</span></span>').join('') + '</div>';
}
function renderSongList(){
  const store = loadSongStore();
  renderSetStatus(store);
  document.getElementById('sgList').innerHTML = SGE.SONGS.map(song => {
    const rec = store[song.id];
    // The coverage travels with the best, so "best 100%" can never again mean
    // "100% of the twelve seconds I played".
    const best = rec && rec.bestAccuracy
      ? '<span class="pill good">best ' + Math.round(rec.bestAccuracy * 100) + '% on the root · ' +
        (rec.bestFull === false && rec.bestOf
          ? rec.bestSections + ' of ' + rec.bestOf + ' sections'
          : 'full play') + '</span>' : '';
    const plays = rec && rec.plays
      ? '<span class="pill num">' + rec.plays + ' play' + (rec.plays === 1 ? '' : 's') + '</span>' : '';
    // Readiness is the engine's rule, not this screen's: one bar everywhere.
    const status = SGE.songReadiness(rec, song);
    const memDays = rec && Array.isArray(rec.memoryDays) ? new Set(rec.memoryDays).size : 0;
    const ready = '<span class="pill' + (status === 'gig-ready' ? ' good' : '') + '">' + status +
      (status === 'learning' && memDays ? ' · memory day ' + memDays + ' of 2' : '') + '</span>';
    return '<div class="sg-item">' +
      '<div class="row between">' +
        '<div><b class="t-title3">' + song.title + '</b>' +
          '<div class="t-caption">' + song.artist + '</div></div>' +
        '<div class="row"><span class="pill num">' + song.bpm + ' bpm</span>' + ready + best + plays + '</div>' +
      '</div>' +
      '<p class="t-caption">' + song.why + '</p>' +
      songStrip(song) +
      '<div class="row" style="margin-top:var(--sp3)">' +
        /* The app's click leads. It is the mode that needs nothing you do not
           already have and the only one that can grade you, so making "Play with
           the record" — which wants a tab player with the bass track muted — the
           orange primary pointed a beginner at the option he could not do tonight. */
        '<button class="btn primary" data-song="' + song.id + '" data-play="click">Play with the app’s click</button>' +
        '<button class="btn" data-song="' + song.id + '" data-play="record">Play with a record or tab player</button>' +
        '<a class="btn small ghost" href="' + song.tab + '" target="_blank" rel="noopener">Open in Songsterr ↗</a>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* The set at a glance: every song against the one gig-ready bar. */
function renderSetStatus(store){
  const host = document.getElementById('sgSetStatus');
  if (!host) return;
  const rows = SGE.SONGS.map(song => {
    const rec = store[song.id];
    return { song, status: SGE.songReadiness(rec, song),
             days: rec && Array.isArray(rec.memoryDays) ? new Set(rec.memoryDays).size : 0,
             // Week 10 sends the player here to find "lowest scores", so the
             // score sits on the board. No memory run shows NOTHING: 0% would
             // read as a terrible run rather than no run.
             memBest: rec && Number(rec.memoryBest) > 0 ? Math.round(Number(rec.memoryBest) * 100) : null };
  });
  const ready = rows.filter(r => r.status === 'gig-ready').length;
  host.innerHTML = '<div class="t-eyebrow">The set · ' + ready + ' of ' + rows.length + ' gig-ready</div>' +
    '<div class="row" style="margin-top:var(--sp2)">' + rows.map(r =>
      '<span class="pill' + (r.status === 'gig-ready' ? ' good' : '') + '">' + r.song.title +
      ' · ' + (r.status === 'gig-ready' ? '✓' : r.status) +
      (r.memBest != null ? ' · ' + r.memBest + '% from memory' : '') + '</span>').join('') + '</div>' +
    // The full bar, where gig-ready first becomes tappable: full tempo and the
    // whole roadmap are conditions the shorter caption used to leave implicit.
    '<p class="t-caption" style="margin:var(--sp2) 0 0"><b>Gig-ready</b> = two memory days: the <b>whole roadmap</b> ' +
    'at <b>full tempo</b> with the app’s click, ' + Math.round(MEMORY_BAR * 100) +
    '%+ <b>from memory</b>, on two <b>separate days</b>.</p>';
}

/* ---------------- the neck: the root, and the same note an octave up ----------------
   Aimed at the E and A strings — the two a beginner learns first — so the
   root lands where he has been taught to look for it. The octave is the
   +2 strings / +2 frets shape, which is why the same finger pattern works. */
function songRootSpots(rootName){
  const T = TUNING;
  let rpc = C.NAMES.indexOf(rootName);
  if (rpc < 0) rpc = C.NAMES.indexOf(String(rootName).replace('b', '#'));
  if (rpc < 0) return null;
  let best = null;
  for (let si = 0; si < T.names.length; si++){
    if (T.names[si] !== 'E' && T.names[si] !== 'A') continue;
    const fret = ((rpc - pcOf(T.midi[si])) % 12 + 12) % 12;
    if (!best || fret < best.fret) best = { si, fret };
  }
  if (!best) return null;
  const octave = (best.si + 2 < T.names.length && best.fret + 2 <= 12)
    ? { si:best.si + 2, fret:best.fret + 2 } : null;
  return { root:best, octave };
}
function songBoard(rootName){
  if (SG.rootShown === rootName) return;
  SG.rootShown = rootName;
  const host = document.getElementById('sgBoard');
  const spots = songRootSpots(rootName);
  if (!spots){ host.innerHTML = ''; return; }
  const T = TUNING;
  const markers = [{ si:spots.root.si, fret:spots.root.fret, kind:'root', label:rootName }];
  if (spots.octave) markers.push({ si:spots.octave.si, fret:spots.octave.fret, kind:'tone', label:rootName });
  const used = markers.map(m => m.si);
  const dimStrings = [];
  for (let si = 0; si < T.names.length; si++) if (used.indexOf(si) < 0) dimStrings.push(si);
  const frets = markers.map(m => m.fret);
  const lo = Math.min.apply(null, frets), hi = Math.max.apply(null, frets);
  const wide = window.matchMedia('(min-width:1000px)').matches;
  SG.boardApi = BassNeck.render(host, {
    strings:T.names,
    fromFret: wide ? 0 : Math.max(0, lo - 1),
    toFret:   wide ? 12 : Math.min(12, Math.max(hi + 1, lo + 4)),
    scale: wide ? 'desk' : 'play',
    markers, dimStrings, scrollToFret: lo, animate:true,
    title: rootName + ' — the root of this section, and the same note an octave up'
  });
}

/* ---------------- the roadmap ---------------- */
function renderBeats(bpb, active, counting){
  const host = document.getElementById('sgBeats');
  const sig = bpb + '/' + active + '/' + (counting ? 'c' : 'p');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  let h = '';
  for (let i = 1; i <= bpb; i++){
    h += '<span class="sg-beat' + (i === 1 ? ' one' : '') + (counting ? ' count' : '') +
         (i === active ? ' on' : '') + '">' + i + '</span>';
  }
  host.innerHTML = h;
}
function renderSongNext(change, bpb, currentRoot){
  const el = document.getElementById('sgNext');
  if (!change){ el.classList.add('hidden'); el.dataset.sig = ''; return; }
  const bars = Math.floor(change.beatsToGo / bpb);
  const when = (change.beatsToGo % bpb === 0 && bars >= 1)
    ? bars + ' bar' + (bars === 1 ? '' : 's')
    : change.beatsToGo + ' beat' + (change.beatsToGo === 1 ? '' : 's');
  // A new section is not always a new note: telling someone to "move" to the
  // note they are already on is the fastest way to make them play a wrong one.
  const same = currentRoot != null && change.root === currentRoot;
  const html = 'Next: <b>' + change.name + ' · ' + change.root + '</b> — in ' + when + '. ' +
    (same ? '<b>Same root — keep going.</b>' : 'Move when the count comes round.');
  if (el.dataset.sig !== html){ el.innerHTML = html; el.dataset.sig = html; }
  el.classList.remove('hidden');
}
function renderSongJudge(){
  const j = document.getElementById('sgJudge'), r = SG.last;
  if (!r){ j.className = 'pill'; j.textContent = 'nothing played yet'; }
  else if (r.verdict === 'correct'){
    j.className = 'pill good';
    j.textContent = '✓ on the root · ' + r.expectedRoot;
  } else {
    // Outline and a mark, never a filled red block: this is a play-along.
    j.className = 'pill off';
    j.textContent = '✕ you played ' + r.playedName + ' · ' + r.section + ' wants ' + r.expectedRoot;
  }
  const t = SG.tally, total = t.correct + t.wrong;
  document.getElementById('sgTally').textContent = 'on the root ' + t.correct + ' of ' + total +
    (total ? ' · ' + Math.round(t.correct / total * 100) + '%' : '');
}
function songTick(){
  const song = SG.song;
  if (!song || SG.t0 == null || SG.finished) return;
  const bpb = song.beatsPerBar || 4, beatMs = 60000 / song.bpm;
  const now = performance.now();
  const prog = document.getElementById('sgProg');

  if (SG.startAt != null && now < SG.startAt){        // the count-in bar
    // A 4-beat count-in has 4 beats in it: the click is scheduled a fraction of
    // a beat ahead, and ceil() of that used to announce "5 beats to go".
    const left = Math.min(bpb, Math.max(1, Math.ceil((SG.startAt - now) / beatMs)));
    const first = song.sections[SG.startSection] || song.sections[0];
    setTxt('sgSection', 'Count in');
    // In memory mode even the count-in keeps the first root to itself — being
    // told where to enter is exactly what "from memory" claims you don't need.
    setTxt('sgRoot', SG.memoryRun ? '?' : first.root);
    setTxt('sgBar', (SG.memoryRun ? 'The song' : first.name) + ' starts on the next 1 — ' + left + ' beat' + (left === 1 ? '' : 's') + ' to go');
    renderBeats(bpb, bpb - left + 1, true);
    if (!SG.memoryRun) songBoard(first.root);
    renderSongNext(null, bpb);
    // Nothing is running yet, so any "section N of M" is last run's number.
    prog.classList.add('hidden');
    return;
  }
  const elapsed = now - SG.t0;
  const p = SGE.positionAt(song, elapsed);
  if (p.finished){ songFinish('finished'); return; }
  // From memory: the beat/bar position and the click are all you get — the
  // section name and root ARE the roadmap, so they stay hidden.
  setTxt('sgSection', SG.memoryRun ? 'From memory' : p.section.name);
  setTxt('sgRoot', SG.memoryRun ? '?' : p.section.root);
  if (SG.memoryRun){
    /* From memory the position must not leak the map: "bar 3 of 4" resets AT
       every section change, which tells the player exactly when sections turn
       over — so only the ABSOLUTE bar across the whole roadmap is shown, and
       the "section N of M" counter stays hidden. */
    setTxt('sgBar', 'bar ' + (Math.floor(p.beat / bpb) + 1) + ' of ' +
      Math.ceil(SGE.totalBeats(song) / bpb) + ' · beat ' + p.beatInBar);
    prog.classList.add('hidden');
  } else {
    setTxt('sgBar', 'bar ' + p.barInSection + ' of ' + p.barsInSection + ' · beat ' + p.beatInBar);
    setTxt('sgProg', 'section ' + (p.section.index + 1) + ' of ' + song.sections.length);
    prog.classList.remove('hidden');
  }
  renderBeats(bpb, p.beatInBar, false);
  if (!SG.memoryRun) songBoard(p.section.root);
  // Two bars of notice, so the warning is never later than one full bar out.
  renderSongNext(SG.memoryRun ? null : SGE.upcomingChange(song, elapsed, 2), bpb, p.section.root);
}

/* ---------------- starting, re-syncing, stopping ---------------- */
function songTeardown(){
  if (SG.timer){ clearInterval(SG.timer); SG.timer = null; }
  metStop();
  // One clock at a time: opening or arming a single song while a set is
  // mid-run stops the set honestly (verdict and bank) instead of leaving two
  // roadmaps fighting over the same microphone.
  setTeardownIfRunning();
}
function songOpen(id, play){
  const song = songById(id);
  if (!song) return;
  songTeardown();
  SG.song = song; SG.play = play === 'click' ? 'click' : 'record';
  SG.t0 = null; SG.startAt = null; SG.startSection = 0; SG.seen = null;
  SG.run = null; SG.finished = false; SG.rootShown = null;
  SG.tally = { correct:0, wrong:0 }; SG.last = null; SG.resyncs = 0; SG.sawSignal = false;
  // Every song starts with the roadmap shown: memory is a choice made per
  // song, not a mode that silently follows you from the last one.
  SG.memory = false; SG.memoryRun = false;
  /* …except when a "Play it from memory" plan link armed it for this song —
     then the mode the link named is one press away instead of two. Never for
     a record play (memory is not offered there), and consumed by this first
     open either way, so it cannot configure a later, unrelated visit. The run
     still waits for the tap: nothing auto-starts. */
  renderMemSeg();
  document.getElementById('sgListCard').classList.add('hidden');
  // The set cards step aside too: an armed song is one job on the screen.
  document.getElementById('sgSetStatus').classList.add('hidden');
  document.getElementById('sgSetCard').classList.add('hidden');
  document.getElementById('sgPlay').classList.remove('hidden');
  document.getElementById('sgRoad').classList.add('hidden');
  document.getElementById('sgArm').classList.remove('hidden');
  document.getElementById('sgProg').classList.add('hidden');
  document.getElementById('sgSummary').innerHTML = '';
  document.getElementById('sgPlayTitle').textContent = song.title + ' · ' + song.artist;
  document.getElementById('sgPlayBpm').textContent = song.bpm + ' bpm';
  songArmHeader();
  /* "Start the click" read as a metronome toggle, so the press that begins the
     SONG looked like a second setup step and nothing seemed to start. The
     button now says what the press actually does: count-in, then the song.
     Record mode keeps "Tap on beat 1" — there the tap IS beat 1. */
  document.getElementById('sgTap').textContent =
    SG.play === 'click' ? '▶ Start — one bar count-in, then the song' : 'Tap on beat 1';
  document.getElementById('sgArmWhy').innerHTML = (SG.play === 'click'
    ? 'The app’s own click at <b>' + song.bpm + ' bpm</b> drives the roadmap, starting after one bar of count-in — ' +
      'no record and no tapping. This is the mode that can actually grade you, so a best score is only kept from here, ' +
      'and only from a play that covers the whole roadmap.'
    : 'Set the record up first — in a tab player, <b>mute the bass track</b> and <b>drop the tempo</b> so the part is ' +
      'playable; loop one section if it is fighting you. Then start it and tap on <b>beat 1</b>. No player, streaming ' +
      'or otherwise, exposes a playhead this can read — reported positions jitter by up to a second against a beat of ' +
      'about half that — so the app keeps its own clock from your tap, and only listens to your bass.') +
    // Both hands are on the bass: a key you can hit with a thumb beats a button.
    '<br>Use the button <b>or press Space</b> — and once it is running, Space re-syncs.';
  document.getElementById('sgBoardNote').innerHTML =
    'The amber dot is this section’s root; the teal dot is the same note an octave up — two strings across, two frets along. ' +
    'Both move when the section does.';
}
/* The memory toggle, offered where the run is armed — and only for click
   plays: a record play is ungraded anyway, so "from memory" there would be a
   claim with nothing measuring it. */
function renderMemSeg(){
  const row = document.getElementById('sgMemRow');
  const note = document.getElementById('sgMemNote');
  if (!row) return;
  const offer = SG.play === 'click';
  row.classList.toggle('hidden', !offer);
  note.classList.toggle('hidden', !offer);
  if (!offer) return;
  document.querySelectorAll('#sgMemSeg button').forEach(b =>
    b.classList.toggle('on', (b.dataset.m === 'memory') === SG.memory));
  note.innerHTML = SG.memory
    // "the bar position" used to be ambiguous — the run showed bar-in-SECTION,
    // which leaks exactly when sections turn over. It is the bar count across
    // the whole song, and the explainer says so.
    ? '<b>From memory</b>: the run hides the roots, the neck and the section warnings — you get the count, your bar ' +
      'number across the <b>whole song</b> (never within a section: that would say when sections change) and the ' +
      'click, which is the closest this app gets to no tab on stage. Grading is unchanged. A full ' +
      'play at ' + Math.round(MEMORY_BAR * 100) + '%+ banks a <b>memory day</b>; two separate days is gig-ready.'
    : 'Roadmap shown: roots, neck and section warnings stay up. Flip to <b>From memory</b> when the map is in your head.';
}
document.getElementById('sgMemSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  SG.memory = b.dataset.m === 'memory';
  renderMemSeg();
});

/** The arm screen's eyebrow says you are one press from the song; while it is
    running the eyebrow goes back to naming the mode alone. */
function songArmHeader(){
  setTxt('sgPlayMode', SG.play === 'click'
    ? 'Play with the app’s click · one press away'
    : 'Play with the record');
}
/** @param fromSection optional section index to start from (3b: "run that bit again"). */
function songArm(fromSection){
  const song = SG.song;
  if (!song) return;
  songTeardown();
  SG.run = SGE.createSongRun(song);
  SG.tally = { correct:0, wrong:0 }; SG.last = null; SG.sawSignal = false;
  SG.rootShown = null; SG.finished = false; SG.resyncs = 0;
  SG.seen = [];
  const bpb = song.beatsPerBar || 4, beatMs = 60000 / song.bpm;
  const tl = SGE.timeline(song);
  const from = (fromSection != null && tl[fromSection]) ? fromSection : 0;
  SG.startSection = from;
  const skipMs = tl[from].startBeat * beatMs;   // how much roadmap is being skipped
  if (SG.play === 'click'){
    const firstClick = metStart(song.bpm, bpb);
    // Beat 1 of the song is the click AFTER a whole bar of count-in.
    SG.startAt = (firstClick == null ? performance.now() + 200 : firstClick) + bpb * beatMs;
  } else {
    SG.startAt = performance.now();     // the tap IS beat 1
  }
  SG.t0 = SG.startAt - skipMs;
  // A play-along is a new intent, so detection is re-armed: a note still
  // ringing from before must not be counted as the song's first note.
  tracker = C.createTracker({ stableMs:150 });
  /* Pinned for this run: flipping the toggle mid-run must not re-label a play
     that spent half its length with the roadmap showing. Memory hides the
     three things that ARE the roadmap — the root display, the neck board and
     the "Next: …" warning — plus the live judge pill, which names the
     expected root on every miss and would hand half the map back. */
  SG.memoryRun = SG.memory && SG.play === 'click';
  document.getElementById('sgBoard').classList.toggle('hidden', SG.memoryRun);
  document.getElementById('sgBoardNote').classList.toggle('hidden', SG.memoryRun);
  document.getElementById('sgJudgeRow').classList.toggle('hidden', SG.memoryRun);
  document.getElementById('sgArm').classList.add('hidden');
  document.getElementById('sgRoad').classList.remove('hidden');
  document.getElementById('sgProg').classList.remove('hidden');
  // Running now, so "one press away" would be stale.
  setTxt('sgPlayMode', SG.play === 'click' ? 'Play with the app’s click' : 'Play with the record');
  document.getElementById('sgSummary').innerHTML = '';
  document.getElementById('sgResync').classList.toggle('hidden', SG.play !== 'record');
  document.getElementById('sgResyncNote').innerHTML = SG.play === 'record'
    ? 'Drifting? <b>Re-sync</b> on any beat 1 — or press <b>Space</b>, which is the one you can hit without letting go of the bass. ' +
      'It snaps the roadmap to the bar line nearest your tap, so you keep your place in the song.'
    : 'The click is the clock here, so there is nothing to re-sync.';
  renderSongJudge();
  songTick();
  SG.timer = setInterval(songTick, 50);
}
function songResync(){
  const song = SG.song;
  if (!song || SG.t0 == null) return;
  const bpb = song.beatsPerBar || 4, barMs = bpb * 60000 / song.bpm;
  const now = performance.now(), elapsed = now - SG.t0;
  // Snap the phase to the bar line nearest the tap: drift is corrected without
  // losing his place in the song, which restarting from the top would.
  SG.t0 = elapsed <= 0 ? now : now - Math.max(0, Math.round(elapsed / barMs)) * barMs;
  SG.resyncs++;
  document.getElementById('sgResyncNote').innerHTML =
    'Re-synced — beat 1 is now where you tapped (' + SG.resyncs + ' so far). Your place in the song is unchanged.';
  songTick();
}
function songPush(midi){
  if (!SG.song || !SG.run || SG.t0 == null || SG.finished) return null;
  const now = performance.now();
  if (SG.startAt != null && now < SG.startAt) return null;   // still counting in
  const elapsed = now - SG.t0;
  if (elapsed < 0) return null;
  const r = SG.run.push(midi, elapsed);
  if (!r || r.verdict === 'finished') return r;
  if (r.verdict === 'correct') SG.tally.correct++; else SG.tally.wrong++;
  SG.last = r;
  // Which SECTIONS were actually judged — the engine merges its buckets by
  // section name, and coverage of the roadmap has to be counted per section.
  const p = SGE.positionAt(SG.song, elapsed);
  if (p.section){
    if (!SG.seen) SG.seen = [];
    if (SG.seen.indexOf(p.section.index) < 0) SG.seen.push(p.section.index);
  }
  renderSongJudge();
  return r;
}
function songFinish(reason){
  const song = SG.song;
  if (!song || SG.finished) return;
  songTeardown();
  SG.finished = true;
  const res = SG.run ? SG.run.result() : { correct:0, wrong:0, bySection:{}, accuracy:0 };
  const total = res.correct + res.wrong;
  const graded = SG.play === 'click';
  // COVERAGE is what makes a best mean anything. A run stopped after two of
  // five sections banked "best 100% on the root" permanently; now a best needs
  // either every section judged, or the roadmap played to its end from the top.
  const of = song.sections.length;
  const covered = (SG.seen || []).length;
  const fromTop = (SG.startSection || 0) === 0;
  const fullPlay = covered >= of || (reason === 'finished' && fromTop);
  const bankable = graded && total > 0 && fullPlay;
  /* A run in which nothing was heard is not a play. It used to increment the
     count, so "song plays 2" included the one the app itself had just told the
     player it could not score. */
  const rec = total > 0
    ? saveSongPlay(song, res.accuracy, bankable, { sections:covered, of, full:fullPlay }, SG.memoryRun)
    : null;
  renderSongList();

  document.getElementById('sgRoad').classList.add('hidden');
  document.getElementById('sgArm').classList.remove('hidden');
  document.getElementById('sgProg').classList.add('hidden');   // no stale "section 3 of 5"
  songArmHeader();
  document.getElementById('sgTap').textContent =
    SG.play === 'click' ? '▶ Go again — one bar count-in, then the song' : 'Tap on beat 1 and go again';

  // Per-section breakdown, merged by section name the way the engine counts it.
  const names = [];
  song.sections.forEach(s => { if (names.indexOf(s.name) < 0) names.push(s.name); });
  const rootsOf = (n) => {
    const out = [];
    song.sections.forEach(s => { if (s.name === n && out.indexOf(s.root) < 0) out.push(s.root); });
    return out.join(', ');
  };
  let weakest = null;
  const rows = names.map(n => {
    const b = res.bySection[n];
    const t = b ? b.correct + b.wrong : 0;
    if (!t){
      return '<div class="dr-row"><span class="dr-name">' + n + ' · ' + rootsOf(n) +
        '</span><span class="t-caption">nothing played</span></div>';
    }
    const acc = b.correct / t;
    if (!weakest || acc < weakest.acc || (acc === weakest.acc && b.wrong > weakest.wrong)){
      weakest = { name:n, acc, wrong:b.wrong, total:t };
    }
    return '<div class="dr-row"><span class="dr-name">' + n + ' · ' + rootsOf(n) + '</span>' +
      '<span class="pill' + (acc >= 0.9 ? ' good' : '') + '">' + b.correct + ' of ' + t + '</span>' +
      '<span class="t-data">' + Math.round(acc * 100) + '%</span></div>';
  }).join('');

  const head = (reason === 'finished' ? 'End of the roadmap · ' : 'Stopped partway · ') + song.title +
    (SG.memoryRun ? ' · from memory' : '');
  const bits = ['<div class="t-eyebrow">' + head + '</div>'];
  if (!total){
    /* "Check the input" was told to a player whose meter had been solid green the
       whole way through — an evening spent debugging a working interface. Only
       blame the input when the input really was silent. */
    bits.push(SG.sawSignal
      ? '<p><b>Nothing to score.</b> The input was hearing your bass the whole way through, but no ' +
        '<b>new notes</b> started during the play — a string that was already ringing when the roadmap ' +
        'began is not counted, and neither is one long sustained note. Pluck the root again on each ' +
        'change and it will count them.</p>'
      : '<p><b>Nothing reached the input.</b> No sound at all arrived while the roadmap ran, so there is ' +
        'nothing to score — check the input at the top of the page is your bass, and that it is turned up.</p>');
  } else {
    bits.push('<p>On the root <b>' + Math.round(res.accuracy * 100) + '%</b> — ' + res.correct + ' of ' + total +
      ' notes matched the root of the section you were in.</p>');
    bits.push(rows);
    // Naming a "weakest section" on a 100% run tells someone their best bit is
    // their worst bit. Above 90% there is nothing to single out.
    if (weakest && weakest.acc < 0.9){
      const from = song.sections.map(s => s.name).indexOf(weakest.name);
      bits.push('<p>Weakest section: <b>' + weakest.name + ' (' + rootsOf(weakest.name) + ')</b> — ' +
        (weakest.total - weakest.wrong) + ' of ' + weakest.total + '. That is the one to run again' +
        (from >= 0 ? ', and this starts there instead of at the top:' : '.') + '</p>' +
        (from >= 0 ? '<div class="row" style="margin-top:var(--sp2)"><button class="btn primary" data-sgfrom="' + from +
          '">Play again from ' + weakest.name + '</button></div>' : ''));
    } else if (weakest){
      bits.push('<p class="t-caption">Nothing stands out as the weak section — every section you played was at 90% or ' +
        'better on the root.</p>');
    }
    bits.push('<p class="t-caption">Roots per section, untimed: this counts whether you were on the right note for ' +
      'where the song was, not whether each note landed exactly on its beat.</p>');
    if (!graded){
      bits.push('<p class="t-caption">Played with the record, so this is not kept as a best score — the app cannot ' +
        'know the record was where you tapped. Run it with the app’s click for a score that means something.</p>');
    } else if (!fullPlay){
      bits.push('<p class="t-caption">' + (covered ? 'Only <b>' + covered + ' of ' + of + ' sections</b> were played' :
        'The roadmap was not played through') + (fromTop ? '' : ' (this run started at section ' + (SG.startSection + 1) + ')') +
        ', so this is <b>not</b> kept as a best: a best is a claim about the whole roadmap, and stopping early would make ' +
        'twelve seconds of intro look like a whole song. Play it to the end and it counts.</p>');
    } else {
      bits.push('<p class="t-caption">Whole roadmap played (' + of + ' section' + (of === 1 ? '' : 's') +
        '), so this run could bank a best.</p>');
    }
    // The from-memory claim is stated where the score is, because that is
    // what makes the score worth more: same grading, less help.
    if (SG.memoryRun){
      bits.push('<p class="t-caption">Played <b>from memory</b> — no roots, no neck, no section warnings were shown. ' +
        'The grading is the same roots-per-section as always; only what you could see changed.</p>');
      const days = rec && Array.isArray(rec.memoryDays) ? new Set(rec.memoryDays).size : 0;
      if (graded && fullPlay && res.accuracy >= MEMORY_BAR){
        bits.push('<p class="t-caption"><b>That banks a memory day</b> (' + days + ' of 2' +
          (days >= 2 ? ' — this song is gig-ready' : '; one more, on another day, and this song is gig-ready') + ').</p>');
      } else if (graded && fullPlay){
        bits.push('<p class="t-caption">A memory day needs ' + Math.round(MEMORY_BAR * 100) + '%+ on a full play — ' +
          'this was ' + Math.round(res.accuracy * 100) + '%, so it counts as practice, not as proof.</p>');
      } else if (graded){
        bits.push('<p class="t-caption">A memory day is a claim about the whole roadmap, so a partial play cannot bank one.</p>');
      }
    }
  }
  document.getElementById('sgSummary').innerHTML =
    '<div class="note-box' + (total && res.accuracy >= 0.9 ? ' good' : '') + '">' + bits.join('') + '</div>';
}
function songBack(){
  songTeardown();
  SG.song = null; SG.run = null; SG.t0 = null; SG.startAt = null; SG.startSection = 0;
  SG.seen = null; SG.finished = false; SG.rootShown = null;
  document.getElementById('sgPlay').classList.add('hidden');
  document.getElementById('sgRoad').classList.add('hidden');
  document.getElementById('sgSummary').innerHTML = '';
  document.getElementById('sgListCard').classList.remove('hidden');
  document.getElementById('sgSetStatus').classList.remove('hidden');
  document.getElementById('sgSetCard').classList.remove('hidden');
  renderSongList();
}
function enterSongs(){
  renderSongList();
  renderSetPicker();
  if (!SG.song){
    document.getElementById('sgPlay').classList.add('hidden');
    document.getElementById('sgListCard').classList.remove('hidden');
    document.getElementById('sgSetStatus').classList.remove('hidden');
    document.getElementById('sgSetCard').classList.remove('hidden');
  }
}

/* ==================================================================
   SETLIST — songs back to back, the way a set actually runs.
   The sequencing and judging live in shared/songs.js (createSetRun);
   this is only its interface. Banked runs go in their OWN store,
   bassTrainer.sets.v1 — NEVER into the songs store: app-theory's
   rollups iterate that store's values and would count a set run as a
   song.
   ================================================================== */
const SET_KEY = 'bassTrainer.sets.v1';
const ST = { picked:[], order:'set', songs:[], run:null, t0:null, timer:null, finished:false };

function loadSets(){
  try {
    const v = JSON.parse(localStorage.getItem(SET_KEY)) || {};
    v.runs = Array.isArray(v.runs) ? v.runs : [];
    return v;
  } catch(e){ return { runs:[] }; }
}
function saveSetRun(entry){
  const all = loadSets();
  all.runs.push(entry);
  while (all.runs.length > 20) all.runs.shift();   // a gig log, not an archive
  try { localStorage.setItem(SET_KEY, JSON.stringify(all)); } catch(e){}
}

/** The picked songs in the order the run will use them. */
function orderedPick(){
  const store = loadSongStore();
  const picked = SGE.SONGS.filter(s => ST.picked.indexOf(s.id) >= 0);
  if (ST.order !== 'weakest') return picked;       // set order = the book's easiest-first
  // Weakest first: the hard entries come while you are fresh.
  const rank = { 'new':0, 'learning':1, 'gig-ready':2 };
  return picked.slice().sort((a, b) => {
    const ra = store[a.id], rb = store[b.id];
    const d = rank[SGE.songReadiness(ra, a)] - rank[SGE.songReadiness(rb, b)];
    return d || (((ra && ra.bestAccuracy) || 0) - ((rb && rb.bestAccuracy) || 0));
  });
}
function renderSetPicker(){
  const host = document.getElementById('stPickRow');
  if (!host) return;
  host.innerHTML = SGE.SONGS.map(s =>
    '<button class="btn small' + (ST.picked.indexOf(s.id) >= 0 ? ' primary' : '') +
    '" data-st="' + s.id + '">' + s.title + '</button>').join('');
  document.querySelectorAll('#stOrderSeg button').forEach(b =>
    b.classList.toggle('on', b.dataset.o === ST.order));
  const n = ST.picked.length;
  document.getElementById('stStart').disabled = !(n >= 3 && n <= 4);
  const note = document.getElementById('stPickNote');
  note.innerHTML =
    n === 0 ? 'Tap songs to build the set.' :
    n < 3   ? n + ' picked — a set here is 3 or 4 songs.' :
    n > 4   ? n + ' picked — that is a whole gig; keep it to 3 or 4 and run it twice.' :
    'Runs as: <b>' + orderedPick().map(s => s.title).join(' → ') + '</b> — each at its own tempo, ' +
    SGE.GAP_BEATS + ' count-in beats between.';
}

function stBeatsDraw(bpb, active, counting){
  const host = document.getElementById('stBeats');
  const sig = bpb + '/' + active + '/' + (counting ? 'c' : 'p');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  let h = '';
  for (let i = 1; i <= bpb; i++){
    h += '<span class="sg-beat' + (i === 1 ? ' one' : '') + (counting ? ' count' : '') +
         (i === active ? ' on' : '') + '">' + i + '</span>';
  }
  host.innerHTML = h;
}
function stTick(){
  if (!ST.run || ST.t0 == null || ST.finished) return;
  const now = performance.now();
  const s0 = ST.songs[0];
  if (now < ST.t0){                                  // count-in into song 1
    const bpb = s0.beatsPerBar || 4, beatMs = 60000 / s0.bpm;
    const left = Math.min(bpb, Math.max(1, Math.ceil((ST.t0 - now) / beatMs)));
    setTxt('stSong', 'Count in · ' + s0.title);
    setTxt('stRoot', s0.sections[0].root);
    setTxt('stBar', left + ' beat' + (left === 1 ? '' : 's') + ' to go');
    stBeatsDraw(bpb, bpb - left + 1, true);
    return;
  }
  const p = ST.run.positionAt(now - ST.t0);
  if (p.finished){ setFinish('finished'); return; }
  if (p.gap){
    // The moment the whole card exists for: new key, count-in, go. The click
    // is already ticking at the NEXT song's tempo.
    MET.bpm = p.nextSong.bpm;
    const bpb = p.nextSong.beatsPerBar || 4;
    setTxt('stSong', 'Next: ' + p.nextSong.title);
    setTxt('stRoot', p.nextRoot);
    setTxt('stBar', 'new key — ' + p.beatsLeft + ' count-in beat' + (p.beatsLeft === 1 ? '' : 's') + ', go');
    stBeatsDraw(bpb, ((SGE.GAP_BEATS - p.beatsLeft) % bpb) + 1, true);
    return;
  }
  MET.bpm = p.song.bpm;
  const bpb = p.song.beatsPerBar || 4;
  setTxt('stSong', p.song.title + ' · ' + p.pos.section.name);
  setTxt('stRoot', p.pos.section.root);
  setTxt('stBar', 'bar ' + p.pos.barInSection + ' of ' + p.pos.barsInSection + ' · beat ' + p.pos.beatInBar);
  stBeatsDraw(bpb, p.pos.beatInBar, false);
}
function setPush(midi){
  if (!ST.run || ST.t0 == null || ST.finished) return;
  const now = performance.now();
  if (now < ST.t0) return;                           // still counting in
  const r = ST.run.push(midi, now - ST.t0);
  const j = document.getElementById('stJudge');
  if (!r || r.verdict === 'finished') return;
  if (r.verdict === 'correct'){
    j.className = 'pill good';
    j.textContent = '✓ on the root · ' + r.expectedRoot;
  } else if (r.verdict === 'wrong'){
    j.className = 'pill off';
    j.textContent = '✕ you played ' + r.playedName + ' · ' + r.songTitle + ' wants ' + r.expectedRoot;
  } else {
    j.className = 'pill';
    j.textContent = 'between songs — nothing judged until ' + (r.nextSong ? r.nextSong.title : 'the next song');
  }
}
function setStart(){
  const songs = orderedPick();
  if (songs.length < 3 || songs.length > 4) return;
  // A single-song play loses the floor before the set takes it.
  if (SG.song && SG.t0 != null && !SG.finished) songFinish('stopped');
  if (SG.timer){ clearInterval(SG.timer); SG.timer = null; }
  metStop();
  ST.songs = songs;
  ST.run = SGE.createSetRun(songs);
  ST.finished = false;
  // A set is a new intent: a note still ringing must not enter song 1.
  tracker = C.createTracker({ stableMs:150 });
  const s0 = songs[0], bpb = s0.beatsPerBar || 4, beatMs = 60000 / s0.bpm;
  const firstClick = metStart(s0.bpm, bpb);
  ST.t0 = (firstClick == null ? performance.now() + 200 : firstClick) + bpb * beatMs;
  document.getElementById('stRun').classList.remove('hidden');
  document.getElementById('stSummary').innerHTML = '';
  const j = document.getElementById('stJudge');
  j.className = 'pill'; j.textContent = 'nothing played yet';
  stTick();
  ST.timer = setInterval(stTick, 50);
}
function setFinish(reason){
  if (!ST.run || ST.finished) return;
  ST.finished = true;
  if (ST.timer){ clearInterval(ST.timer); ST.timer = null; }
  metStop();
  document.getElementById('stRun').classList.add('hidden');
  const r = ST.run.result();
  const total = r.correct + r.wrong;
  const missed = r.entries.filter(e => !e.made);
  /* One combined verdict, and a banked record — but only when something was
     judged: an abandoned count-in is not a set run. */
  if (total > 0){
    saveSetRun({
      date: todayISO(), songs: ST.songs.map(s => s.id), overall: r.accuracy,
      perSong: r.perSong.map(p => ({ id: p.id, accuracy: p.accuracy, correct: p.correct, wrong: p.wrong })),
      entriesMissed: missed.map(e => e.id), finished: reason === 'finished',
    });
  }
  const bits = ['<div class="t-eyebrow">' + (reason === 'finished' ? 'End of the set' : 'Stopped partway') +
    ' · ' + ST.songs.length + ' songs</div>'];
  if (!total){
    bits.push('<p><b>Nothing to score.</b> No new notes started while the set ran, so nothing was banked — ' +
      'pluck the root again on each change and it will count them.</p>');
  } else {
    bits.push('<p>On the root <b>' + Math.round(r.accuracy * 100) + '%</b> overall — ' +
      r.correct + ' of ' + total + ' notes across the set.</p>');
    bits.push(r.perSong.map(p => {
      const t = p.correct + p.wrong;
      return '<div class="dr-row"><span class="dr-name">' + p.title + '</span>' +
        (t ? '<span class="pill' + (p.accuracy >= 0.9 ? ' good' : '') + '">' + p.correct + ' of ' + t + '</span>' +
             '<span class="t-data">' + Math.round(p.accuracy * 100) + '%</span>'
           : '<span class="t-caption">nothing played</span>') + '</div>';
    }).join(''));
    // The transition note: the entries are what a setlist run exists to test.
    bits.push(missed.length
      ? '<p><b>Entries missed: ' + missed.map(e => songById(e.id).title).join(', ') + '</b> — the first bar of ' +
        (missed.length === 1 ? 'that song' : 'those songs') + ' went by without the root landing. ' +
        'That seam is the thing to drill: count-in, new key, go.</p>'
      : '<p><b>Every entry made</b> — each song\'s root landed inside its first bar.</p>');
    bits.push('<p class="t-caption">Roots per section, untimed, judged song by song against the set\'s own clock. ' +
      'This run is banked on the set log' + (reason === 'finished' ? '' : ' (marked stopped partway)') + '.</p>');
  }
  document.getElementById('stSummary').innerHTML =
    '<div class="note-box' + (total && r.accuracy >= 0.9 && !missed.length ? ' good' : '') + '">' + bits.join('') + '</div>';
  renderSetPicker();
  renderSongList();
}
function setTeardownIfRunning(){
  if (ST.run && ST.t0 != null && !ST.finished) setFinish('stopped');
  else if (ST.timer){ clearInterval(ST.timer); ST.timer = null; }
}

/* ---------------- wiring ---------------- */
document.getElementById('secSongs').addEventListener('click', e => {
  const b = e.target.closest('button[data-song]');
  if (b){ songOpen(b.dataset.song, b.dataset.play); return; }
  // "That is the one to run again" with a button that actually runs it.
  const again = e.target.closest('button[data-sgfrom]');
  if (again) songArm(+again.dataset.sgfrom);
});
document.getElementById('sgTap').addEventListener('click', () => songArm());
document.getElementById('sgResync').addEventListener('click', songResync);
/* Both hands are on the bass and the tap button vanishes once the roadmap is
   running, so the arm tap and the re-sync get the one key you can hit blind. */
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' && e.key !== ' ' && e.key !== 'Spacebar') return;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(t.tagName) || t.isContentEditable)) {
    // Let a focused control keep its own space bar — except the tap button,
    // where space means exactly what the button means.
    if (!(t.id === 'sgTap' || t.id === 'sgResync')) return;
  }
  if (mode !== 'songs' || !SG.song) return;
  const armed = !document.getElementById('sgArm').classList.contains('hidden');
  const running = !document.getElementById('sgRoad').classList.contains('hidden');
  if (armed){ e.preventDefault(); songArm(); }
  else if (running && SG.play === 'record'){ e.preventDefault(); songResync(); }
});
document.getElementById('sgStop').addEventListener('click', () => songFinish('stopped'));
document.getElementById('sgBack').addEventListener('click', songBack);
/* setlist wiring */
document.getElementById('stPickRow').addEventListener('click', e => {
  const b = e.target.closest('button[data-st]');
  if (!b) return;
  const id = b.dataset.st;
  const i = ST.picked.indexOf(id);
  if (i >= 0) ST.picked.splice(i, 1); else ST.picked.push(id);
  renderSetPicker();
});
document.getElementById('stOrderSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  ST.order = b.dataset.o === 'weakest' ? 'weakest' : 'set';
  renderSetPicker();
});
document.getElementById('stStart').addEventListener('click', setStart);
document.getElementById('stStop').addEventListener('click', () => setFinish('stopped'));
renderSongList();
renderSetPicker();

/* ==================================================================
   ENTRY POINTS — how the shell drives this half.

   The old page put the mic gate in front of everything: you could not
   see a tuner needle or a song roadmap without granting a microphone
   first. The gate has moved to exactly where it is needed: the first
   Live mode you ask for, phrased as the thing you
   asked for ("Start listening & follow the song", not Start, then Run).
   ================================================================== */
let pendingMode = null;

/** Show the gate where the mode's content would have been. */
function gateFor(m){
  pendingMode = m;
  highlightNav(m);
  document.getElementById('gateMode').textContent = MODES[m].title;
  document.getElementById('startBtn').textContent = MODES[m].cta;
  document.getElementById('gate').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  /* A slot below the button used to list what was due tonight, back when the
     Drills mode kept a review schedule — a fact about your history, readable
     without granting a mic. Nothing is due any more: the game brings weak
     spots back inside a run, so there is nothing to show before one starts. */
}

/** Stop the analyser loop, keep the stream and the AudioContext. Called when a
    Learn tab takes the screen: polling 18×/second behind a scale chart is
    pure waste, but dropping the stream would put the gate back.

    The click stops too. It used to keep ticking from behind a Learn tab,
    audible with nothing on screen to stop it. A song is stopped outright: its
    clock is wall-time from the tap, so it would run away while off-screen and
    come back pointing at the wrong section. */
function suspend(){
  if (A.timer){ clearInterval(A.timer); A.timer = null; }
  // The game scene must not animate (or run its pace clock) behind a Learn tab.
  gvLoop(false);
  // A set run's clock is wall-time like a song's: off-screen it would run away
  // and come back pointing at the wrong song, so it stops honestly instead.
  if (ST.run && ST.t0 != null && !ST.finished){ setFinish('stopped'); return; }
  if (SG.song && SG.t0 != null && !SG.finished){ songFinish('stopped'); return; }
  if (MET.timer) metStop();
}
function resume(){
  if (A.analyser && !A.timer) A.timer = setInterval(tick, 55);
  /* Nothing was listening while a Learn tab had the screen, so whatever is
     sounding on the way back was not played AT the exercise — it is a string that
     was still ringing, or the note you were on when you wandered off. Detection
     is re-armed from scratch, because otherwise the first thing heard on return
     would answer the current question — a note the player never aimed at it. */
  tracker = C.createTracker({ stableMs:TRACKER_STABLE_MS });
  /* Coming back to the game: the fuse must not count the time spent
     away — that would be a stage light lost to a tab switch. */
  if (mode === 'find'){
    GV.spawnAt = performance.now();
    GV.graceUntil = performance.now() + 600;   // same entry grace as setMode
    gvLoop(true);
  }
}

/** Enter a Live mode. Gates on the first one ever asked for, and never again. */
function showMode(m){
  if (!MODES[m]) return;
  if (!armed){ gateFor(m); return; }
  resume();
  setMode(m);
}

function mount(){ /* nothing to boot: the wiring above runs at load */ }

window.BassLive = { mount, showMode, armMic: startListening, suspend, resume, preset };

/* ---- test seam ----
   trainer/test/integration.test.js drives this half the way a player cannot:
   it plants the question it is about to "play" and resets the pitch tracker
   between notes. Those names were globals when this file was a <script> in its
   own page; now that both apps share one document they cannot be, so the seam
   the suite holds on to is published here deliberately. Accessors, not copies —
   the suite ASSIGNS q and the app has to see the write. */
[['q',        () => q,        v => { q = v; }],
 ['wrongThisQ',()=> wrongThisQ,v => { wrongThisQ = v; }],
 /* The stall clock: trainer/test/polish.test.js measures the console with the
    stall nudge painted, and waiting ten real seconds for it in each of sixteen
    states would make one assertion three minutes long. */
 ['lastProgressAt',()=> lastProgressAt,v => { lastProgressAt = v; }],
 ['qStart',   () => qStart,   v => { qStart = v; }],
 ['tier',     () => tier,     v => { tier = v; }],
 ['focus',    () => focus,    v => { focus = v; }],
 ['mode',     () => mode,     v => { mode = v; }],
 // rebuilt whenever a run starts, so a snapshot would be the wrong tracker
 ['tracker',  () => tracker,  v => { tracker = v; }]
].forEach(([name, get, set]) =>
  Object.defineProperty(window, name, { configurable:true, get, set }));
window.setMode = setMode;
window.renderTierUI = renderTierUI;
/* The console's height must not move when a verdict paints, and the longest
   verdict the game can write is a burnt fuse's correction — three facts and a
   lights count. Waiting a real fuse out per case would make that test minutes
   long; this poses the same painted state directly. */
window.gvBreach = gvBreach;
/* Same reason, for the review queue: proving that a note you were SHOWN comes
   back means advancing several questions, and playing them for real would make
   one assertion a minute long. */
window.newQuestion = newQuestion;
window.A = A;
window.GV = GV;   // scene state, so a harness can pin an exact animation frame
/* Scale mode's whole question — the chord, its box, the run's progress — so
   the e2e suite can play a run note by note without guessing which chord the
   progression happened to draw. Read-only in practice: the suite reads
   SC.targets to know what to "play", and SC.run to see where it parked. */
window.SC = SC;
/* How long THIS question's fuse burns. Scale mode pays it by the length of
   the run, and a test that re-derived that arithmetic would be testing its
   own copy of it — while waiting a 30-second fuse out for real would make one
   assertion half a minute long. */
window.gvFuseMs = gvFuseMs;
/* trainer/test/shell.test.js asks what happened to the click and the song clock
   when the screen went to a Learn tab. These are the objects that hold the
   answer. */
window.MET = MET;
window.SG = SG;
window.ST = ST;
/* trainer/test/bookkeeping.test.js hunts for a note the way a beginner does —
   two wrong notes then the right one — which needs to feed readings straight in:
   a synthetic mic plays one fixed pitch, and the question is picked at random. */
window.onStableNote = onStableNote;
/* The staff-clipping regression test draws arbitrary midis straight onto the
   game's staff canvas and reads the pixels back. */
window.drawStaff = drawStaff;
})();
