/* ==================================================================
   Bass Live Trainer — the Live half of the app: Tuner, Find it, Ear
   training, Drills and Songs. Everything here needs the bass plugged
   in, so everything here waits for the mic to be armed, and the mic
   is not armed until the player asks for one of these modes.

   Lifted verbatim out of trainer/index.html when the two apps became
   one page. It is wrapped in an IIFE because both apps now share one
   global scope and both declare TUNING, SCALES, NAMES and pcOf —
   textual concatenation would have made one of them win at
   random. The only thing published is window.BassLive, at the bottom.
   ================================================================== */
(function(){
"use strict";
const C = window.BassCore;

/* ================= shared state (same store as the Theory Trainer) ================= */
const LS_KEY = 'bassTheoryTrainer.v1';
function loadShared(){
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ return {}; }
}
function saveStats(mutate){
  const st = loadShared();
  st.stats = Object.assign({ answered:0, correct:0, bestStreak:0, byString:{}, heat:{}, tierRecent:{}, speed:[] }, st.stats);
  mutate(st.stats);
  try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch(e){}
}

const TUNING = { midi:[23,28,33,38,43], names:['B','E','A','D','G'] };
const NATURALS = new Set(['C','D','E','F','G','A','B']);
const TIERS = [
  { label:'1 · E + A strings, frets 0–5', strings:['E','A'], maxFret:5, accidentals:false },
  { label:'2 · E + A strings, frets 0–12', strings:['E','A'], maxFret:12, accidentals:false },
  { label:'3 · add D + G strings', strings:['E','A','D','G'], maxFret:12, accidentals:false },
  { label:'4 · add the low B string', strings:['B','E','A','D','G'], maxFret:12, accidentals:false },
  { label:'5 · everything + sharps/flats', strings:['B','E','A','D','G'], maxFret:12, accidentals:true }
];
// Difficulty is shared with the Theory Trainer, so reaching tier 3 there
// means starting at tier 3 here (and live answers land in that tier's stats).
let tier = Math.min(TIERS.length - 1, Math.max(0, ((loadShared().trainer || {}).tier) | 0));
let focus = null, mode = 'tuner';
function persistTier(){
  const st = loadShared();
  st.trainer = Object.assign({}, st.trainer, { tier });
  try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch(e){}
}

/* ================= audio ================= */
const A = { ctx:null, analyser:null, stream:null, buf:null, timer:null, rate:44100, level:0, muteUntil:0 };
const DECIMATE = 4;
let tracker = C.createTracker({ stableMs:150 });
/* Readings used to decide whether the INSTRUMENT is out of tune: {cents, name}
   per reading, so the warning can tell one flat string from a flat bass. */
let centsHistory = [];
/* How far a reading may sit from an open string and still be taken AS that open
   string being tuned. A fret's worth is 100 cents, so 60 keeps genuinely slack
   open strings in and keeps fretted notes (>=100 cents away) out. */
const DRIFT_MAX_CENTS = 60;

/* Has the mic ever been granted? Once it has, no Live mode ever gates again:
   the stream and the AudioContext are kept alive across tab switches so that
   coming back from the practice plan is instant, and only the analyser loop
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
  else if (reading.state === 'stable') onStableNote(reading);
  else if (mode === 'find' && reading.state === 'listening') {
    document.getElementById('fHeard').textContent = 'hearing ' + C.hzToNote(reading.hz).name + '…';
  } else if (mode === 'find' && reading.state === 'held' && q && reading.midi === q.midi
             && now - lastProgressAt > 2500) {
    const hEl = document.getElementById('fHeard');
    hEl.textContent = 'that note is still ringing from before — mute the string, then play it again';
  } else if (mode === 'find' && reading.state === 'idle') {
    const hEl = document.getElementById('fHeard');
    if (/^hearing /.test(hEl.textContent)) hEl.innerHTML = '&nbsp;';
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
/* Every string green means tonight's "Tune up" is genuinely done, so say so and
   tick it off. The Learn half owns the item; this only reports the fact. */
function reportTuned(){
  const names = TUNING.names;
  const all = names.every(n => tunedStrings[n]);
  const done = document.getElementById('tuneDone');
  if (done) done.classList.toggle('hidden', !all);
  if (all && !reportTuned.sent && window.BassTheory && BassTheory.markTuned){
    reportTuned.sent = true;      // once per page: markTuned is once per day
    BassTheory.markTuned();
  }
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

/* ================= find it ================= */
let q = null, hintLevel = 0, qStart = 0, wrongThisQ = 0, lastProgressAt = 0, outOfTuneThisQ = false;
/* `score` = questions you eventually found; `clean` = found on the first attempt,
   which is the one the stored accuracy is built from. */
const sess = { find:{ score:0, clean:0, streak:0, asked:0 }, echo:{ score:0, streak:0 } };

function tierNow(){ return TIERS[tier]; }
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
  return out;
}
function newQuestion(){
  const p = pool();
  if (!p.length){ q = null; return; }
  let pick;
  do { pick = p[Math.floor(Math.random() * p.length)]; }
  while (p.length > 1 && q && pick.sn === q.sn && pick.f === q.f);
  q = pick; hintLevel = 0; wrongThisQ = 0; outOfTuneThisQ = false; qStart = performance.now();
  lastProgressAt = qStart;
  tracker.reset();   // clears the settle clock only — a ringing note stays consumed
  document.getElementById('fQ').innerHTML = 'Play <b>' + q.name + '</b> on the <b>' + q.sn + '</b> string';
  document.getElementById('fSub').textContent = 'Find it on the neck and play it.';
  const v = document.getElementById('fVerdict');
  v.innerHTML = '&nbsp;'; v.className = 'verdict';
  document.getElementById('fHeard').innerHTML = '&nbsp;';
  document.getElementById('fBoard').innerHTML = '';
  updateFindStats();
}
function showHint(){
  if (!q) return;
  if (outOfTuneThisQ && hintLevel === 0){
    // They found the right note; the problem is the instrument, not the fret.
    document.getElementById('fSub').innerHTML =
      'You are playing the right note — it is your <b>tuning</b> that is off. Open the Tuner tab and retune that string.';
    lastProgressAt = performance.now();
    outOfTuneThisQ = false;
    return;
  }
  hintLevel = Math.min(2, hintLevel + 1);
  lastProgressAt = performance.now();
  if (hintLevel === 1){
    const lo = Math.max(0, q.f - 2), hi = Math.min(tierNow().maxFret, q.f + 2);
    document.getElementById('fSub').textContent = 'Hint: it is somewhere between fret ' + lo + ' and fret ' + hi + '.';
    drawBoard({ range:[lo, hi] });
  } else {
    document.getElementById('fSub').textContent = 'It is right here — play it, then it moves on.';
    drawBoard({ reveal:true });
  }
}
function drawBoard(opts){
  const t = tierNow(), host = document.getElementById('fBoard');
  if (!q){ host.innerHTML = ''; return; }
  const names = TUNING.names;
  const dimStrings = [];
  for (let si = 0; si < names.length; si++) if (!t.strings.includes(names[si])) dimStrings.push(si);

  const markers = [];
  if (opts.reveal){
    markers.push({ si:q.si, fret:q.f, kind:'correct', label:q.name });
  } else if (opts.range){
    // Mark the search area on the target string without giving away the fret.
    for (let f = opts.range[0]; f <= opts.range[1]; f++){
      markers.push({ si:q.si, fret:f, kind:'asked', label:'?' });
    }
  }
  const wide = window.matchMedia('(min-width:1000px)').matches;
  BassNeck.render(host, {
    strings: names, fromFret:0, toFret:t.maxFret, scale: wide ? 'desk' : 'read',
    markers, dimStrings,
    title: opts.reveal ? (q.name + ' is on the ' + q.sn + ' string, fret ' + q.f)
                       : 'the ' + q.sn + ' string, frets ' + (opts.range ? opts.range.join(' to ') : ''),
    scrollToFret: q.f,
  });
}
function updateFindStats(){
  document.getElementById('fScore').textContent = sess.find.score;
  document.getElementById('fClean').textContent = sess.find.clean;
  document.getElementById('fStreak').textContent = sess.find.streak;
  document.getElementById('fAsked').textContent = sess.find.asked;
}

function onStableNote(reading){
  const heardName = C.hzToNote(reading.hz).name;
  if (mode === 'find'){
    if (!q) return;
    const verdict = C.checkAnswer(reading, q.midi);
    const vEl = document.getElementById('fVerdict'), hEl = document.getElementById('fHeard');
    hEl.textContent = 'heard ' + heardName + C.hzToNote(reading.hz).octave +
      ' (' + reading.hz.toFixed(1) + ' Hz, ' + (reading.cents>0?'+':'') + Math.round(reading.cents) + ' cents)';
    if (verdict === 'correct'){
      vEl.textContent = ['Yes!','Nailed it.','Correct!','That’s the one.'][Math.floor(Math.random()*4)];
      vEl.className = 'verdict ok';
      sess.find.score++;
      /* One stored answer per QUESTION, graded on the first attempt — the rule the
         heat map and the "in under 2 seconds" checkpoint already assume. Hunting
         used to bank a wrong AND then a correct, so four questions all answered
         right came out as 50% of 8. countWrong() has already banked this
         question if the first attempt missed; banking again would double it. */
      if (wrongThisQ === 0){
        sess.find.clean++; sess.find.streak++; sess.find.asked++;
        recordAnswer(true, q, performance.now() - qStart);
      }
      updateFindStats();
      drawBoard({ reveal:true });
      setTimeout(newQuestion, 1100);
    } else if (verdict === 'out-of-tune'){
      vEl.textContent = 'Right note! But it is ' + Math.abs(Math.round(reading.cents)) + ' cents ' +
        (reading.cents < 0 ? 'flat' : 'sharp') + ' — that string needs tuning.';
      vEl.className = 'verdict warn';
      outOfTuneThisQ = true;   // let the stall timer escalate to the tuner
    } else if (verdict === 'wrong-octave'){
      const dir = reading.midi > q.midi ? 'higher up' : 'lower down';
      const article = /^[AEF]$/.test(heardName) ? 'an' : 'a';
      vEl.textContent = 'That’s ' + article + ' ' + heardName + ' — right note, wrong octave. You want the one 12 frets ' +
        (reading.midi > q.midi ? 'lower' : 'higher') + ', on the ' + q.sn + ' string.';
      void dir;
      vEl.className = 'verdict no';
      countWrong();
    } else {
      vEl.textContent = 'That’s ' + heardName + ' — keep looking for ' + q.name + '.';
      vEl.className = 'verdict no';
      countWrong();
    }
  } else if (mode === 'drill'){
    // Terminal feedback: the run judges the ORDER, and says nothing until it stops.
    drillPush(reading.midi, performance.now());
  } else if (mode === 'songs'){
    // A play-along, not a test: this notes whether you were on the section's
    // root and says so quietly. It never halts and never buzzes.
    songPush(reading.midi);
  } else if (mode === 'echo'){
    if (echoTarget == null) return;
    const targetName = C.NAMES[((echoTarget % 12) + 12) % 12];
    const same = (((reading.midi - echoTarget) % 12) + 12) % 12 === 0;
    const vEl = document.getElementById('eVerdict');
    document.getElementById('eHeard').textContent = 'you played ' + heardName + C.hzToNote(reading.hz).octave;
    if (same){
      vEl.textContent = 'Correct — the note was ' + targetName + '.';
      vEl.className = 'verdict ok';
      sess.echo.score++; sess.echo.streak++;
      if (echoWrongThisTarget === 0) recordEcho(true);
      setTimeout(newEcho, 1600);
    } else {
      vEl.textContent = 'You played ' + heardName + ' — that is not it. Tap “Let me hear it” to hear it again.';
      vEl.className = 'verdict no';
      sess.echo.streak = 0;
      recordEcho(false);
      document.getElementById('eShow').classList.remove('hidden');
    }
    document.getElementById('eScore').textContent = sess.echo.score;
    document.getElementById('eStreak').textContent = sess.echo.streak;
  }
}
function countWrong(){
  wrongThisQ++;
  lastProgressAt = performance.now();
  if (wrongThisQ === 1){
    sess.find.streak = 0; sess.find.asked++;
    recordAnswer(false, q, performance.now() - qStart);
  }
  if (wrongThisQ >= 2 && hintLevel < 2) showHint();
  updateFindStats();
}
/* Day-stamped answers, in the shared store, so the practice plan's "This week"
   card can compare this week with last week instead of counting a streak.
   Bounded to 60 days — two comparisons' worth. */
function bumpDaily(st, ok){
  const daily = st.daily || (st.daily = {});
  const k = todayISO();
  const day = daily[k] || (daily[k] = { a:0, c:0 });
  day.a++; if (ok) day.c++;
  const keys = Object.keys(daily).sort();
  while (keys.length > 60) delete daily[keys.shift()];
}
function recordAnswer(ok, question, elapsedMs){
  saveStats(st => {
    st.answered++; if (ok) st.correct++;
    bumpDaily(st, ok);
    const bs = st.byString[question.sn] || (st.byString[question.sn] = { a:0, c:0, recent:[] });
    bs.a++; if (ok) bs.c++;
    bs.recent = bs.recent || [];
    bs.recent.push(ok ? 1 : 0);
    if (bs.recent.length > 20) bs.recent.shift();
    if (!ok){
      const key = question.sn + ':' + question.f;
      st.heat[key] = (st.heat[key] || 0) + 1;
    }
    if (ok && sess.find.streak > (st.bestStreak || 0)) st.bestStreak = sess.find.streak;
    st.tierRecent = st.tierRecent || {};
    const tr = st.tierRecent[tier] || (st.tierRecent[tier] = []);
    tr.push(ok ? 1 : 0); if (tr.length > 20) tr.shift();
    st.speed = st.speed || [];
    st.speed.push(Math.min(30, elapsedMs / 1000)); if (st.speed.length > 20) st.speed.shift();
  });
}

/* ================= echo ================= */
let echoTarget = null, echoStart = 0, echoWrongThisTarget = 0;
function recordEcho(ok){
  // One record per target: repeated guesses at the same note are practice,
  // not extra wrong answers dragging down the shared accuracy figure.
  if (!ok){
    echoWrongThisTarget++;
    if (echoWrongThisTarget > 1) return;
  }
  saveStats(st => {
    st.answered++; if (ok) st.correct++;
    bumpDaily(st, ok);
    st.ear = st.ear || { a:0, c:0 };
    st.ear.a++; if (ok) st.ear.c++;
    st.speed = st.speed || [];
    st.speed.push(Math.min(30, (performance.now() - echoStart) / 1000));
    if (st.speed.length > 20) st.speed.shift();
  });
}
function newEcho(){
  const p = pool();
  if (!p.length) return;
  let pick;
  do { pick = p[Math.floor(Math.random() * p.length)].midi; }
  while (p.length > 1 && pick === echoTarget);
  echoTarget = pick;
  echoStart = performance.now();
  echoWrongThisTarget = 0;
  const v = document.getElementById('eVerdict');
  v.innerHTML = '&nbsp;'; v.className = 'verdict';
  document.getElementById('eHeard').innerHTML = '&nbsp;';
  document.getElementById('eShow').classList.add('hidden');
  playNote(echoTarget);
}
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
/* The five Live modes are five of the app's nine nav destinations now, so the
   nav is what shows which one is on; the mode segment inside the page is gone. */
const MODES = {
  tuner: { title:'Tuner',        cta:'Start listening & tune up' },
  find:  { title:'Find it',      cta:'Start listening & find the note' },
  echo:  { title:'Ear training', cta:'Start listening & start ear training' },
  drill: { title:'Drills',       cta:'Start listening & run the drill' },
  songs: { title:'Songs',        cta:'Start listening & follow the song' }
};
function highlightNav(m){
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === m));
}
function setMode(m){
  mode = m;
  highlightNav(m);
  document.getElementById('secTuner').classList.toggle('hidden', m !== 'tuner');
  document.getElementById('secFind').classList.toggle('hidden', m !== 'find');
  document.getElementById('secEcho').classList.toggle('hidden', m !== 'echo');
  document.getElementById('secDrill').classList.toggle('hidden', m !== 'drill');
  document.getElementById('secSongs').classList.toggle('hidden', m !== 'songs');
  const dc = document.getElementById('difficultyCard');
  // Tiers/focus belong to Find it and Ear training; a drill or a song carries its own scope.
  dc.classList.toggle('hidden', m === 'tuner' || m === 'drill' || m === 'songs');
  // keep it below whichever exercise is showing, so it never jumps
  const sec = document.getElementById(m === 'echo' ? 'secEcho' : 'secFind');
  if ((m === 'find' || m === 'echo') && sec && sec.nextSibling !== dc) sec.parentNode.insertBefore(dc, sec.nextSibling);
  // Say what this mode actually writes to, naming tabs the player can actually
  // click: the two apps were merged, so "the Theory Trainer" named nothing.
  // Drills keep their own record, so claiming they feed the quiz would be false.
  const feed = document.getElementById('feedNote');
  // The tuner has no answers — you turn pegs — and it sits in the always-visible
  // card, so the quiz sentence was shown on a screen it did not describe.
  if (feed) feed.textContent = m === 'tuner'
    ? 'Getting all five strings into the green ticks “Tune up” off tonight’s practice list.'
    : m === 'drill'
    ? 'Drills keep their own record — review dates, tempo and mastery live with the drill itself, and do not feed the Note quiz stats or the Practice checkpoints.'
    : m === 'songs'
    ? 'Songs keep their own record too — plays and best root accuracy live with the song, and do not feed the Note quiz stats or the Practice checkpoints.'
    : 'Answers here feed the same progress stats as the Note quiz on the Practice tab.';
  tracker.reset();
  /* The mute window belongs to Ear — it exists so the app cannot hear its own
     note. Left set across a tab switch, the Tuner opened saying "playing the
     note — listen…" about a note it never played, until the window expired.
     Cleared BEFORE the echo branch below, which sets a fresh one on entry. */
  A.muteUntil = 0;
  // A pending preset is consumed by THIS switch, matching mode or not: it was
  // stored for one navigation, and surviving it would configure a later,
  // unrelated visit that never asked for it.
  const pre = pendingPreset;
  pendingPreset = null;
  if (m === 'find' && !q) newQuestion();
  if (m === 'echo') newEcho();
  // Leaving Songs stops its clock and its click; leaving Drills stops theirs.
  // (setMode is not called while a song is running, so this never cuts one off.)
  if (m !== 'songs') songTeardown();
  if (m !== 'drill') metStop();
  // Applied before enterDrills, so the picker renders already configured.
  if (pre && m === 'drill' && pre.drill) pickerFromCfg(pre.drill);
  if (m === 'drill') enterDrills();
  if (m === 'songs') enterSongs();
  // After enterSongs: the list has to exist before an entry can be pointed at.
  if (pre && m === 'songs' && pre.song) highlightSong(pre.song);
}
/** A spec stored by the Learn half just before it navigates here, so a plan
    link lands CONFIGURED — the drill picker pre-picked, or the named song
    scrolled to and ringed — instead of merely on the right tab. Consumed by
    the next setMode. */
let pendingPreset = null;
function preset(spec){
  pendingPreset = spec && typeof spec === 'object' ? spec : null;
}
/** Scroll one song entry into view and ring it briefly. */
function highlightSong(id){
  const btn = document.querySelector('#sgList [data-song="' + id + '"]');
  const item = btn && btn.closest('.sg-item');
  if (!item) return;
  document.querySelectorAll('#sgList .sg-item.is-target').forEach(e => e.classList.remove('is-target'));
  item.classList.add('is-target');
  // Deferred: the shell scrolls to the top AFTER showMode returns, and a
  // synchronous scrollIntoView here would be undone by it.
  requestAnimationFrame(() => item.scrollIntoView({ block:'center' }));
  // A pointer, not a state: it goes away on its own, or on the first touch.
  const drop = () => { item.classList.remove('is-target'); clearTimeout(t); };
  const t = setTimeout(drop, 4000);
  document.getElementById('secSongs').addEventListener('pointerdown', drop, { once:true });
}
function renderTierUI(){
  const sel = document.getElementById('tierSel');
  sel.innerHTML = TIERS.map((t,i) =>
    '<option value="' + i + '"' + (i===tier?' selected':'') + '>Tier ' + t.label + '</option>').join('');
  const fs = document.getElementById('focusSeg');
  const strs = tierNow().strings;
  fs.innerHTML = '<button data-f="">All strings</button>' +
    strs.map(s => '<button data-f="' + s + '">' + s + ' only</button>').join('');
  fs.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', (b.dataset.f || null) === focus);
    b.addEventListener('click', () => { focus = b.dataset.f || null; renderTierUI(); newQuestion(); });
  });
  document.getElementById('tStrings').textContent = TUNING.names.join(' ');
  const t2 = document.getElementById('tStrings2');
  if (t2) t2.textContent = TUNING.names.join(' ');
}

/* One button, one click: it grants the mic AND starts what you came for. The
   mode is set BEFORE the panel is shown, so the panel never appears for a
   frame with the wrong mode — or no mode — on it. */
document.getElementById('startBtn').addEventListener('click', async () => {
  const want = pendingMode || mode;
  if (!await startListening()) return;
  setMode(want);
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
});
document.getElementById('deviceSel').addEventListener('change', e => startListening(e.target.value));

document.getElementById('tierSel').addEventListener('change', e => {
  tier = +e.target.value; focus = null; persistTier(); renderTierUI(); newQuestion();
});
document.getElementById('fHint').addEventListener('click', showHint);
document.getElementById('fSkip').addEventListener('click', newQuestion);
document.getElementById('ePlay').addEventListener('click', () => { if (echoTarget != null) playNote(echoTarget); });
document.getElementById('eNext').addEventListener('click', newEcho);
document.getElementById('eShow').addEventListener('click', () => {
  if (echoTarget == null) return;
  const name = C.NAMES[((echoTarget % 12) + 12) % 12];
  const v = document.getElementById('eVerdict');
  v.textContent = 'It was ' + name + '. Play it, or tap "New note".';
  v.className = 'verdict warn';
  playNote(echoTarget);
});
renderTierUI();

// Offer help when the player stops making progress — whether that is silence,
// or being stuck holding one wrong note (which fires only a single verdict).
// Once they've already missed, help arrives sooner.
setInterval(() => {
  if (mode !== 'find' || !q || hintLevel >= 2) return;
  const stalledFor = performance.now() - lastProgressAt;
  if (stalledFor > (wrongThisQ > 0 ? 4500 : 10000)) showHint();
}, 700);

/* ==================================================================
   DRILLS — the order you play notes in, not just single notes.
   The pedagogy lives in shared/drill.js; this is only its interface.
   Its state is kept in its OWN localStorage key, because the Theory
   Trainer reads bassTheoryTrainer.v1 and must not see drill records.
   ================================================================== */
const DE = window.BassDrill;
const DRILL_KEY = 'bassTrainer.drills.v1';

/* same names and intervals as the Theory Trainer's scale explorer */
const SCALES = {
  minPent:{ name:'Minor pentatonic', iv:[0,3,5,7,10] },
  natMinor:{ name:'Natural minor',   iv:[0,2,3,5,7,8,10] },
  majPent:{ name:'Major pentatonic', iv:[0,2,4,7,9] },
  major:{ name:'Major scale',        iv:[0,2,4,5,7,9,11] },
  blues:{ name:'Blues scale',        iv:[0,3,5,6,7,10] }
};
const SCALE_ORDER = ['minPent','natMinor','majPent','major','blues'];
const CHROM_STARTS = [1,3,5,7,9];
const WINDOW_SIZE = 4;           // notes in a middle / repair window

const pcOf = (midi) => ((midi % 12) + 12) % 12;
const noteName = (midi) => C.NAMES[pcOf(midi)];
function fullName(midi){ const n = C.hzToNote(C.midiToHz(midi)); return n.name + n.octave; }
function todayISO(){
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
}
function loadDrills(){
  try { return JSON.parse(localStorage.getItem(DRILL_KEY)) || {}; } catch(e){ return {}; }
}
function saveDrillItem(item){
  const all = loadDrills();
  all[item.id] = item;
  try { localStorage.setItem(DRILL_KEY, JSON.stringify(all)); } catch(e){}
}

/* picker state (what the selects say) and run state (what is being played) */
/* The click ships ON. Mastery requires a run that is clean AND in time, only the
   day's FIRST run can bank one, and "in time" can only be measured against a
   click — so with the click off by default, a beginner's first-ever run was
   spent before the rule was ever stated, and the tempo checkbox that decided it
   sat below the fold at the far end of the card. Off is still one click away. */
const DP = { type:'scale', scaleKey:'minPent', rootPc:4, winKey:null, si:1, variant:'full',
             bpm:60, bpmTouched:false, met:true, labels:'names', wins:[], dueId:null };
const DR = {
  cfg:null, item:null, targets:[], full:[], repairTargets:null, run:null,
  phase:'idle', direction:'up', variant:'full', repair:false,
  repairClean:0, needFullRep:false, err:null, errTargets:null,
  history:[], tempoOffer:null, tempoDownOffer:null, bpm:60, met:false, timing:null,
  // Absolute performance.now() of every accepted onset, plus the absolute time
  // of the FIRST CLICK: the grid has to be phase-locked to the click, so both
  // sides of the comparison must survive as absolute times.
  onsets:[], metOrigin:null,
  // plan is DRAWN ONCE when a rep ends, so the button's label and the button's
  // click can never disagree; skips/stall drive the escape hatches.
  plan:null, skips:0, lastAdvanceAt:0, stallLevel:0, boardApi:null, flash:false
};

/* ---- plain language for the two things the engine calls by jargon ---- */
const CI_WORDS = { blocked:'one thing at a time', serial:'mixed in', random:'fully mixed' };
const CI_NOTE = {
  blocked:'One thing at a time: the same shape over and over, until it is solid.',
  serial:'Mixed in: this shape now takes its turn alongside the others.',
  random:'Fully mixed: direction and slice get shuffled — it feels worse and it sticks better.'
};
function dayGap(fromISO, toISO){
  return Math.round((Date.parse(toISO + 'T12:00:00Z') - Date.parse(fromISO + 'T12:00:00Z')) / 86400000);
}
/** "today" / "tomorrow" / "in 3 days" — a date a person can act on, not a box number. */
function dueWords(due){
  if (!due) return 'not scheduled yet';
  const d = dayGap(todayISO(), due);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  return 'in ' + d + ' days';
}

/* ---- what the dots say ----
   NOTE NAMES by default: the practice plan teaches note names and never
   teaches scale degrees, and a degree label ("4") sitting on fret 0 reads
   as a fret number. Degrees are available, with a legend, for anyone who
   wants them. */
function targetLabel(x){
  return DP.labels === 'degrees' ? x.degree : noteName(x.midi);
}
function legendFor(type){
  if (DP.labels !== 'degrees') return '';
  return type === 'chromatic'
    ? '1 2 3 4 = which finger plays the note (1 = index) — not the fret number.'
    : 'R = root, b3 = flat third — the note numbers counted up from the root.';
}
function setLegend(id, type){
  const el = document.getElementById(id);
  if (!el) return;
  const txt = legendFor(type);
  el.textContent = txt;
  el.classList.toggle('hidden', !txt);
}
function renderLabelSegs(){
  document.querySelectorAll('#drLabelSeg button, #drLabelSegRun button')
    .forEach(b => b.classList.toggle('on', b.dataset.k === DP.labels));
}

/* ---------------- metronome (Web Audio, no assets) ---------------- */
/* Everything between the string moving and this code SEEING a note: the
   analyser window fills over ~190ms (8192 samples at 44.1kHz), the tracker only
   calls a note stable once it has held for 150ms, and the poll runs every 55ms.
   So a detected onset always sits LATER than the pluck, and that lag is the
   app's, not the player's — one estimate of it comes off every onset before the
   onset is compared with the click.
   220ms is what this pipeline measured here: feeding it a note every 2s through
   the fake microphone put detection 204–244ms behind each onset (mean 224).
   It stays an ESTIMATE — one number for one machine, not a measurement of
   yours — so read the figures as good to tens of milliseconds, not single ones,
   and read the verdict as a verdict about a sixth of a beat, not about 5ms. */
const DETECT_LATENCY_MS = 220;
const MET = { timer:null, next:0, beat:0, bpm:null, firstPerf:0, accentEvery:4 };
function metStop(){ if (MET.timer){ clearInterval(MET.timer); MET.timer = null; } MET.bpm = null; }
/**
 * Start the click. `bpm` overrides the drill tempo (Songs runs at the song's
 * tempo); returns the performance.now() of the FIRST click, so a play-along
 * can put its beat 1 on the click grid instead of guessing.
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
    const period = 60 / (MET.bpm || DR.bpm);
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

/* ---------------- building the targets ---------------- */
function boxOptions(rootPc){
  const T = TUNING, out = [];
  out.push({ key:'open', from:0, to:5, label:'Open position · frets 0–5' });
  for (let si = 0; si < T.midi.length - 2; si++){
    let f = ((rootPc - pcOf(T.midi[si])) % 12 + 12) % 12;
    if (f === 0) f = 12;                       // an "open string box" is the open position
    if (f + 4 > 12) continue;
    out.push({ key:'box' + si + '_' + f, from:f, to:f + 4, si, fret:f,
      label:'Box · ' + T.names[si] + ' string, fret ' + f });
  }
  return out;
}
/** Stack the +2 strings / +2 frets shape as far as this neck allows. */
function octaveStart(rootPc){
  const T = TUNING;
  let best = null;
  for (let si = 0; si < T.midi.length; si++){
    const base = ((rootPc - pcOf(T.midi[si])) % 12 + 12) % 12;
    for (const f of [base, base + 12]){
      if (f > 12) continue;
      let len = 0, s = si, x = f;
      while (s < T.midi.length && x <= 12){ len++; s += 2; x += 2; }
      if (len < 2) continue;
      if (!best || len > best.len || (len === best.len && f < best.fret)) best = { si, fret:f, len };
    }
  }
  return best;
}
function buildTargets(cfg){
  const T = TUNING;
  let out;
  if (cfg.type === 'chromatic'){
    out = [];
    for (let k = 0; k < 4; k++){
      const f = cfg.from + k;
      out.push({ si:cfg.si, fret:f, midi:T.midi[cfg.si] + f, degree:String(k+1), finger:String(k+1) });
    }
  } else if (cfg.type === 'octave'){
    out = [];
    let si = cfg.si, f = cfg.fret;
    while (si < T.midi.length && f <= 12){
      out.push({ si, fret:f, midi:T.midi[si] + f, degree:'R' });
      si += 2; f += 2;
    }
  } else {
    out = DE.sequence({ tuning:T, intervals:SCALES[cfg.scaleKey].iv, rootPc:cfg.rootPc,
      fromFret:cfg.from, toFret:cfg.to });
  }
  return cfg.direction === 'down' ? out.slice().reverse() : out;
}
function drillId(cfg){
  const names = TUNING.names;
  if (cfg.type === 'chromatic') return [cfg.tuning,'chromatic',names[cfg.si],cfg.from].join('|');
  if (cfg.type === 'octave')    return [cfg.tuning,'octave',C.NAMES[cfg.rootPc],names[cfg.si] + cfg.fret].join('|');
  return [cfg.tuning,'scale',cfg.scaleKey,C.NAMES[cfg.rootPc],cfg.from + '-' + cfg.to].join('|');
}
function drillLabel(cfg){
  const names = TUNING.names;
  if (cfg.type === 'chromatic')
    return 'Chromatic 1-2-3-4 · ' + names[cfg.si] + ' string, frets ' + cfg.from + '–' + (cfg.from + 3);
  if (cfg.type === 'octave')
    return C.NAMES[cfg.rootPc] + ' octave shape · from the ' + names[cfg.si] + ' string, fret ' + cfg.fret;
  return C.NAMES[cfg.rootPc] + ' ' + SCALES[cfg.scaleKey].name.toLowerCase() + ' · ' + (cfg.winLabel || '');
}
function itemFor(cfg){
  const id = drillId(cfg);
  const stored = loadDrills()[id];
  const item = stored || { id, box:0, due:null, ci:'blocked', bpm:60, attempts:[] };
  item.attempts = item.attempts || [];
  item.cfg = cfg;                      // so the shelf can reopen it
  item.label = drillLabel(cfg);
  return item;
}

/* ---------------- what "mastered" means here ----------------
   The engine ignores direction, and the UI insists ascending and descending
   are separate reps, so mastery is stated — and measured — on the ASCENDING
   shape only. Descending reps still schedule review; they cannot bank a day. */
function ascendingOnly(attempts){
  return (attempts || []).filter(a => a.direction !== 'down');
}
function masteryFor(item){
  return DE.masteryOf(ascendingOnly(item && item.attempts));
}
/** Would THIS attempt bank a mastery day? Asked of the engine, not re-derived. */
function bankedDay(a){
  return !!(a && a.cold && a.direction !== 'down' && DE.masteryOf([a]) !== 'new');
}
function masteryDays(item){
  return new Set(((item && item.attempts) || []).filter(bankedDay).map(a => a.date)).size;
}
/** One sentence: did this run bank a mastery day, and if not, why not. */
function masteryLine(attempt){
  if (!attempt.cold)
    return 'Today’s first run is the one that can bank a mastery day — this was a repeat, so it counts as practice, not as proof.';
  const days = masteryDays(DR.item);
  if (bankedDay(attempt))
    return 'That was today’s first run — the one that counts — and it banked a mastery day (' + days + ' of 2). ' +
      (days >= 2 ? 'That is mastered.' : 'One more, on another day, and this shape is mastered.');
  const clicked = !!(DR.timing && DR.timing.kind === 'click');
  const why =
    attempt.skipped              ? 'You skipped a note, so the run was not all yours'
  : !attempt.passed              ? 'It stopped on a wrong note'
  : attempt.direction === 'down' ? 'Mastery is measured on the ascending shape and this was the descending one'
  : attempt.window               ? 'It was part of the shape, not the whole shape'
  : !attempt.timingOk            ? (clicked ? 'Right notes, but they sat off the click' : 'Right notes, but the spacing wandered')
  : (attempt.notes || 0) < 3     ? 'A ' + (attempt.notes || 0) + '-note shape is too short to measure timing against the click — ' +
                                   'mastery needs at least three notes'
  : !attempt.timingMeasured      ? 'Right notes and evenly spaced, but the click was off, so “on the click” could not be checked'
  : !attempt.atTargetTempo       ? 'Right notes in time, but below this drill’s target tempo'
  :                                'It did not clear the bar';
  return 'That was today’s first run — the one that counts. ' + why +
    ', so today does not bank a mastery day; tomorrow’s first run is the next chance.';
}

/* ---------------- the picker ---------------- */
/* cfg still carries `tuning: 5`, and drillId still embeds it: stored drill ids
   were minted with it when the app had a 4-string mode, and dropping it now
   would orphan every stored review date and mastery history. */
function cfgFromPicker(){
  const T = TUNING;
  if (DP.type === 'chromatic'){
    const from = CHROM_STARTS.indexOf(+DP.winKey) >= 0 ? +DP.winKey : 1;
    return { tuning:5, type:'chromatic', si:Math.min(DP.si, T.midi.length - 1), from, to:from + 3 };
  }
  if (DP.type === 'octave'){
    const st = octaveStart(DP.rootPc);
    if (!st) return null;
    return { tuning:5, type:'octave', rootPc:DP.rootPc, si:st.si, fret:st.fret, from:st.fret, to:Math.min(12, st.fret + 4) };
  }
  const win = DP.wins.find(w => w.key === DP.winKey) || DP.wins[0];
  if (!win) return null;
  return { tuning:5, type:'scale', scaleKey:DP.scaleKey, rootPc:DP.rootPc,
    from:win.from, to:win.to, winLabel:win.label };
}
function renderDrillPicker(){
  const T = TUNING;
  document.querySelectorAll('#drTypeSeg button').forEach(b => b.classList.toggle('on', b.dataset.k === DP.type));
  document.querySelectorAll('#drVarSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === DP.variant));

  const scaleSel = document.getElementById('drScaleSel');
  scaleSel.innerHTML = SCALE_ORDER.map(k =>
    '<option value="' + k + '"' + (k === DP.scaleKey ? ' selected' : '') + '>' + SCALES[k].name + '</option>').join('');
  const rootSel = document.getElementById('drRootSel');
  rootSel.innerHTML = C.NAMES.map((n,i) =>
    '<option value="' + i + '"' + (i === DP.rootPc ? ' selected' : '') + '>' + n + '</option>').join('');
  const strSel = document.getElementById('drStringSel');
  strSel.innerHTML = T.names.map((n,i) =>
    '<option value="' + i + '"' + (i === Math.min(DP.si, T.names.length-1) ? ' selected' : '') + '>' + n + ' string</option>').join('');

  const winSel = document.getElementById('drWinSel');
  if (DP.type === 'chromatic'){
    DP.wins = CHROM_STARTS.map(f => ({ key:String(f), from:f, to:f+3, label:'Frets ' + f + '–' + (f+3) }));
  } else {
    // Only offer places where this root actually starts a full octave.
    DP.wins = boxOptions(DP.rootPc).filter(w => DE.sequence({
      tuning:T, intervals:SCALES[DP.scaleKey].iv, rootPc:DP.rootPc, fromFret:w.from, toFret:w.to
    }).length > 1);
  }
  if (!DP.wins.some(w => w.key === DP.winKey)) DP.winKey = DP.wins.length ? DP.wins[0].key : null;
  winSel.innerHTML = DP.wins.map(w =>
    '<option value="' + w.key + '"' + (w.key === DP.winKey ? ' selected' : '') + '>' + w.label + '</option>').join('')
    || '<option>nothing fits on this neck</option>';

  const showScale = DP.type === 'scale';
  document.getElementById('drScaleWrap').classList.toggle('hidden', !showScale);
  document.getElementById('drRootWrap').classList.toggle('hidden', DP.type === 'chromatic');
  document.getElementById('drWinWrap').classList.toggle('hidden', DP.type === 'octave');
  document.getElementById('drStringWrap').classList.toggle('hidden', DP.type !== 'chromatic');

  document.getElementById('drMet').checked = DP.met;
  document.getElementById('drBpmTxt').textContent = DP.bpm + ' bpm';
  renderLabelSegs();

  const cfg = cfgFromPicker();
  const prev = document.getElementById('drPreview');
  const start = document.getElementById('drStart');
  const targetNote = document.getElementById('drTargetNote');
  const hasDue = applyPrimaryCta();
  if (!cfg || !buildTargets(cfg).length){
    prev.textContent = 'That root does not give a full octave here — pick another place on the neck.';
    start.disabled = !hasDue;
    document.getElementById('drStartPicked').disabled = true;
    setLegend('drLegendPick', DP.type);
    targetNote.classList.add('hidden');
    return;
  }
  const t = buildTargets(cfg);
  const shown = DP.variant === 'middle' ? DE.middleWindow(t, WINDOW_SIZE) : t;
  start.disabled = false;
  document.getElementById('drStartPicked').disabled = false;
  prev.innerHTML = '<b>' + drillLabel(cfg) + '</b><br>' + shown.length +
    ' notes, ascending — then the same shape coming down as a second rep:<br>' +
    shown.map(x => targetLabel(x) + ' <span class="t-data">' + TUNING.names[x.si] + '/' + x.fret + '</span>').join(' → ') +
    '<br><span class="t-data">string/fret</span>' +
    // Three onsets is the minimum that says anything about timing, so a shorter
    // shape is told up front that it cannot bank a mastery day.
    (shown.length < 3
      ? '<br><b>Only ' + shown.length + ' notes</b> — too few to measure against the click, so this shape is practice: ' +
        'it schedules review but it cannot bank a mastery day.'
      : '');
  /* Said BEFORE the run, next to the button, because only the day's first run can
     bank a mastery day and it needs the click: learning that afterwards means
     learning it by losing the day. */
  const bank = document.getElementById('drBankNote');
  if (bank){
    // Same test endRep uses for `cold`: today's first run of THIS shape.
    const rec = loadDrills()[drillId(cfg)];
    const first = !rec || rec.coldDate !== todayISO();
    bank.innerHTML = shown.length < 3 ? ''
      : !first ? 'You have already had today’s first run of this shape — the one that can bank a mastery day. ' +
          'Anything now is practice, and still worth doing.'
      : DP.met ? '<b>The click is on</b>, so this run can bank a mastery day: play it clean and in time and ' +
          'today counts toward mastery. It is the day’s first run of this shape that counts.'
      : '<b>The click is off</b>, so this run cannot bank a mastery day — “in time” is only a claim you can ' +
          'check against a click. <button class="btn small" id="drMetOn">Turn the click on</button>';
    bank.classList.toggle('hidden', shown.length < 3);
    const on = document.getElementById('drMetOn');
    if (on) on.addEventListener('click', () => { DP.met = true; renderDrillPicker(); });
  }
  setLegend('drLegendPick', cfg.type);

  // Tempo is not a ratchet: the picker's bpm is what will play. The stored
  // target only decides when a run counts as "in time" — and it can come down.
  const stored = loadDrills()[drillId(cfg)];
  if (stored && stored.bpm && stored.bpm !== DP.bpm){
    targetNote.innerHTML = 'This drill’s <b>target</b> is ' + stored.bpm + ' bpm. It will run at the ' + DP.bpm +
      ' bpm you picked here — the target only decides when a run counts as “in time”.' +
      (stored.bpm > DP.bpm
        ? ' <button class="btn small" id="drLowerTarget">Make ' + DP.bpm + ' bpm the target</button>'
        : '');
    targetNote.classList.remove('hidden');
  } else targetNote.classList.add('hidden');
}

/* ---------------- running a rep ---------------- */
function startDrill(cfg){
  if (!cfg) return;
  DR.cfg = cfg;
  DR.item = itemFor(cfg);
  // The PICKER's tempo is the session's tempo. The item's accepted target is
  // only a starting suggestion for someone who has not touched the picker:
  // otherwise one accepted step would lock the drill at that speed forever.
  if (!DP.bpmTouched && DR.item.bpm) DP.bpm = Math.max(40, Math.min(200, DR.item.bpm));
  DR.bpm = DP.bpm;
  DR.met = DP.met;
  DR.direction = 'up'; DR.variant = DP.variant;
  DR.repair = false; DR.repairTargets = null; DR.repairClean = 0; DR.needFullRep = false;
  DR.history = []; DR.tempoOffer = null; DR.err = null; DR.plan = null;
  document.getElementById('drPick').classList.add('hidden');
  document.getElementById('drRun').classList.remove('hidden');
  beginRep();
}
function beginRep(){
  const cfg = Object.assign({}, DR.cfg, { direction:DR.direction });
  DR.full = buildTargets(cfg);
  DR.targets = DR.repair && DR.repairTargets ? DR.repairTargets
             : DR.variant === 'middle' ? DE.middleWindow(DR.full, WINDOW_SIZE)
             : DR.full;
  DR.run = DE.createRun(DR.targets);
  DR.phase = 'running'; DR.err = null; DR.errTargets = null;
  DR.plan = null; DR.skips = 0; DR.flash = false;
  DR.onsets = []; DR.metOrigin = null; DR.timing = null; DR.tempoDownTaken = false;
  DR.clickLost = false;
  DR.lastAdvanceAt = performance.now();
  hideStall();
  document.getElementById('drPanel').innerHTML = '';
  // A new rep is a NEW INTENT, so detection is re-armed: tracker.reset() only
  // clears the settle clock, which left a still-consumed note unable to answer
  // the rep's first target — a drill whose first note you just played froze.
  tracker = C.createTracker({ stableMs:150 });
  // metStart returns the performance.now() of the first click: that is the
  // origin of the timing grid, and without it there is no click to measure.
  if (DR.met) DR.metOrigin = metStart();
  renderRun();
}
function restartRun(){
  if (!DR.cfg) return;
  DR.direction = 'up'; DR.variant = DP.variant;
  DR.repair = false; DR.repairTargets = null; DR.repairClean = 0; DR.needFullRep = false;
  DR.history = []; DR.tempoOffer = null; DR.err = null;
  beginRep();
}
/** The one place a played note enters a run. Returns the engine's status. */
function drillPush(midi, atMs){
  if (DR.phase !== 'running' || !DR.run) return null;
  const at = atMs == null ? performance.now() : atMs;
  const r = DR.run.push(midi, at);
  // Keep the ABSOLUTE onset time: the engine stores each note relative to note
  // one, which cancels any constant offset from the click — including a whole
  // half-beat of it.
  if (r.status === 'advanced' || r.status === 'done') DR.onsets.push(at);
  if (r.status === 'error'){
    DR.phase = 'error'; DR.err = r; DR.errTargets = DR.targets;
    endRep(false);
  } else if (r.status === 'done'){
    DR.phase = 'done';
    endRep(true);
  } else {
    DR.lastAdvanceAt = performance.now();
    hideStall();
    renderRun();
  }
  return r;
}

/* ---------------- a run must never be a dead end ----------------
   Find it has its own stall timer; Drills had none, so a run that would not
   advance offered nothing but "Change drill", which throws the drill away. */
function showStall(html, escapes){
  const s = document.getElementById('drStall');
  s.innerHTML = html;
  s.classList.remove('hidden');
  const esc = document.getElementById('drEscape');
  const wasHidden = esc.classList.contains('hidden');
  esc.classList.toggle('hidden', !escapes);
  // A way out that sits below the fold is not a way out (the desktop board is tall).
  if (escapes && wasHidden) esc.scrollIntoView({ block:'nearest' });
}
function hideStall(){
  DR.stallLevel = 0;
  document.getElementById('drStall').classList.add('hidden');
  document.getElementById('drEscape').classList.add('hidden');
}
function showExpectedNote(){
  if (DR.phase !== 'running' || !DR.run) return;
  const want = DR.run.expected();
  if (!want) return;
  const T = TUNING;
  showStall('It is the <b>' + T.names[want.si] + '</b> string, <b>fret ' + want.fret + '</b> — ' +
    noteName(want.midi) + ' (the violet dot, flashing). Mute everything else and pluck just that.', true);
  DR.flash = true;
  drillBoard();
  DR.flash = false;
  if (DR.boardApi) DR.boardApi.scrollTo(want.fret);
}
function skipExpectedNote(){
  if (DR.phase !== 'running' || !DR.run) return;
  const want = DR.run.expected();
  if (!want) return;
  // The run advances, but the rep is marked as not clean: a note the app
  // played for you cannot bank mastery or move the tempo.
  DR.skips++;
  drillPush(want.midi, performance.now());
  if (DR.phase === 'running'){
    tracker = C.createTracker({ stableMs:150 });
    showStall('Skipped that note — this run no longer counts towards mastery or the tempo. Carry on from the violet dot.', true);
  }
}
setInterval(() => {
  if (mode !== 'drill' || DR.phase !== 'running' || !DR.run) return;
  const stalledFor = performance.now() - DR.lastAdvanceAt;
  if (stalledFor > 20000 && DR.stallLevel < 2){
    DR.stallLevel = 2;
    showStall('Still waiting on the <b style="color:var(--hl)">violet</b> note — mute the strings and pluck it again.' +
      '<br>If it still will not register, take one of these ways out.', true);
  } else if (stalledFor > 8000 && DR.stallLevel < 1){
    DR.stallLevel = 1;
    showStall('Still waiting on the <b style="color:var(--hl)">violet</b> note — mute the strings and pluck it again.', false);
  }
}, 700);
/**
 * Score the onsets against the CLICK, in milliseconds.
 *
 * `onsets` are ABSOLUTE performance.now() times and `clickOrigin` is the
 * performance.now() of the first click, so the grid is phase-locked to the
 * click itself. (It used to be phase-locked to note one — res.notes[].at is
 * measured from the first note — which cancels ANY constant offset: six notes
 * played squarely on the off-beat scored a perfect 0ms.)
 * Each onset is compared with the NEAREST point on that grid — the beat, or
 * the half-beat if the gaps say two notes per click — and the deviation is
 * SIGNED, so early and late are visible instead of averaged into "off".
 * Tolerance is ±15% of that unit, tightened to ±10% once the drill is
 * mastered, because "mastered" should not keep getting easier.
 *
 * With no clickOrigin there is no click to be on, and the report says so: it
 * measures EVEN SPACING and is labelled that way everywhere it is shown.
 */
function timingReport(onsets, bpm, tight, clickOrigin){
  if (!onsets || onsets.length < 3) return null;
  const beat = 60000 / bpm;
  if (!(beat > 0)) return null;
  const gaps = [];
  for (let i = 1; i < onsets.length; i++) gaps.push(onsets[i] - onsets[i-1]);
  const meanGap = gaps.reduce((a,b) => a+b, 0) / gaps.length;
  const sub = meanGap > 0 && meanGap < beat * 0.75;
  const unit = sub ? beat / 2 : beat;
  const pct = tight ? 10 : 15;
  const tol = unit * pct / 100;
  const sd = Math.sqrt(gaps.reduce((a,g) => a + (g-meanGap)*(g-meanGap), 0) / gaps.length);
  if (clickOrigin == null){
    return { kind:'spacing', spread:sd, meanGap, unit, sub, pct, tol, bpm,
             inside: meanGap > 0 && sd / meanGap <= 0.35 };
  }
  let sum = 0, signed = 0, worst = 0, worstSigned = 0;
  for (const at of onsets){
    const t = at - clickOrigin - DETECT_LATENCY_MS;
    const dev = t - Math.round(t / unit) * unit;      // signed: − early, + late
    sum += Math.abs(dev); signed += dev;
    if (Math.abs(dev) > worst){ worst = Math.abs(dev); worstSigned = dev; }
  }
  return { kind:'click', mean:sum / onsets.length, meanSigned:signed / onsets.length,
           worst, worstSigned, spread:sd, tol, pct, unit, sub, bpm, inside: worst <= tol };
}
function timingOkOf(res){
  DR.timing = null;
  // Two notes give one gap, and one gap is "even" by definition: fewer than
  // three onsets is not evidence about timing at all.
  if (!DR.onsets || DR.onsets.length < 3) return true;
  DR.timing = timingReport(DR.onsets, DR.bpm, masteryFor(DR.item) === 'mastered',
                           DR.met ? DR.metOrigin : null);
  return DR.timing ? DR.timing.inside : true;
}
/** A tolerance a beginner owns: 15% of a beat is "about a sixth of a beat". */
const BEAT_FRACTIONS = { 2:'half a beat', 3:'a third of a beat', 4:'a quarter of a beat',
  5:'a fifth of a beat', 6:'a sixth of a beat', 7:'a seventh of a beat', 8:'an eighth of a beat',
  9:'a ninth of a beat', 10:'a tenth of a beat', 11:'an eleventh of a beat', 12:'a twelfth of a beat' };
function toleranceWords(t){
  const beat = 60000 / t.bpm;
  const denom = Math.max(2, Math.min(12, Math.floor(beat / t.tol)));
  return BEAT_FRACTIONS[denom];
}
const earlyLate = (ms) => (ms < 0 ? 'early' : 'late');
/** The one visible timing line, built from the same report as the verdict. */
function timingLine(){
  const t = DR.timing;
  if (!t) return '';
  if (t.kind === 'spacing'){
    return '<p class="t-caption"><b>Even spacing</b> (' + (DR.clickLost
        ? 'the click stopped part-way through, when you left the tab, so this run cannot be scored against it'
        : 'no click was running, so being “on the beat” could not be checked') +
      '): the gaps between notes varied by <b>' + Math.round(t.spread) + 'ms</b> around ' +
      Math.round(t.meanGap) + 'ms — ' + (t.inside ? 'even enough' : 'uneven') + '. ' +
      (DR.clickLost
        ? 'Run it again without leaving the tab and it gets measured against the beat itself.'
        : 'Switch the click on and the same run gets measured against the beat itself.') + '</p>';
  }
  return '<p class="t-caption">Against the click: <b>' + Math.abs(Math.round(t.meanSigned)) + 'ms ' +
    earlyLate(t.meanSigned) + '</b> on average, worst <b>' + Math.abs(Math.round(t.worstSigned)) + 'ms ' +
    earlyLate(t.worstSigned) + '</b> — ' + (t.inside ? 'inside' : 'outside') + ' the ±' +
    Math.round(t.tol) + 'ms window, which is ' + toleranceWords(t) + ' (' + t.pct + '% of ' +
    (t.sub ? 'the half-beat' : 'the beat') + ' at ' + t.bpm + ' bpm' + (t.sub ? ', two notes per click' : '') +
    ').<br><span class="t-data">measured from the click itself, less a fixed ' + DETECT_LATENCY_MS +
    'ms estimate of the app’s own detection lag</span></p>';
}
function endRep(passed){
  metStop();
  hideStall();
  const res = DR.run.result();
  const skipped = DR.skips > 0;
  // A skipped note is not a played note: it counts for nothing.
  const clean = passed && !skipped;
  const timingOk = !skipped && timingOkOf(res);
  // Timing is only EVIDENCE when there was a click to measure against and at
  // least three onsets to measure. A two-note drill (a short octave shape) used
  // to sail past the timing gate with nothing measured and reach "mastered".
  const timingMeasured = !skipped && !!(DR.timing && DR.timing.kind === 'click');
  const played = Math.max(0, res.notes.length - DR.skips);
  const accuracy = res.total ? (clean ? 1 : played / res.total) : 0;
  const today = todayISO();
  // COLD = the first attempt of a DAY, persisted with the drill. Keying this
  // on a page-lifetime object made mastery unreachable for anyone who leaves
  // the tab open overnight — which is what a desktop tab does.
  const cold = DR.item.coldDate !== today;
  // A repair span, a middle-only slice or a run with a skipped note is not an
  // attempt at the drill: the engine ignores such reps, and so does the gate.
  const windowRep = DR.repair || DR.variant === 'middle' || skipped;

  // The drill's target tempo only moves when the player accepts the gate's
  // offer, so "at target tempo" stays a real condition on mastery.
  const targetBpm = DR.item.bpm || DR.bpm;
  if (skipped){
    // No promotion, no demotion: the review date is not this run's business.
    DR.item = Object.assign({}, DR.item, { cfg:DR.cfg, label:drillLabel(DR.cfg) });
  } else {
    // Review is DAY-scale. schedule() runs on every completed rep, but a single
    // session must not ratchet the box to 5: once today's pass has promoted the
    // item, further passes today only refresh lastSeen. Failures still demote.
    const promotedToday = passed && DR.item.lastSeen === today && (DR.item.box || 0) > 0;
    const scheduled = DE.schedule(DR.item, passed, today);
    DR.item = Object.assign(
      promotedToday ? Object.assign({}, DR.item, { lastSeen: scheduled.lastSeen }) : scheduled,
      { cfg:DR.cfg, label:drillLabel(DR.cfg) });
  }
  DR.item.ci = DE.nextCI(DR.item.ci, clean, { window: windowRep });
  DR.item.bpm = targetBpm;
  DR.item.coldDate = today;
  const attempt = {
    date:today, cold, passed: clean, accuracy, timingOk, timingMeasured,
    // "In time" is only a claim you can check against a click, and only with
    // enough notes to check: mastery requires both. The wording says so too.
    atTargetTempo: timingMeasured && DR.bpm >= targetBpm,
    direction:DR.direction, bpm:DR.bpm, notes:res.total,
    window: windowRep, skipped
  };
  DR.item.attempts.push(attempt);
  if (DR.item.attempts.length > 40) DR.item.attempts.shift();
  // The tempo offer has to be earned by two clean reps of the WHOLE shape.
  if (!windowRep) DR.history.push({ passed: clean, timingOk });
  saveDrillItem(DR.item);

  // Tempo never moves on its own — the gate only makes the offer.
  // Two clean reps in time earn an OFFER. Nothing speeds up unless it is tapped.
  const gate = DE.tempoGate(DR.history, DR.bpm);
  DR.tempoOffer = (gate.advance && !windowRep) ? gate.nextBpm : null;

  if (DR.repair){
    DR.repairClean = clean ? DR.repairClean + 1 : 0;
    if (DR.repairClean >= 2){ DR.repair = false; DR.repairClean = 0; DR.needFullRep = true; }
  } else if (clean && DR.needFullRep && DR.variant !== 'middle'){
    DR.needFullRep = false;
  }

  // Draw what happens next ONCE, here, and store it: the label on the button
  // and the rep the button runs are then the same thing by construction.
  DR.plan = drawPlan();
  renderRun();
  renderPanel(res, timingOk, attempt);
  renderDue(); renderShelf();
}

/* What the next tap should run. The contextual-interference rung decides,
   not the player: blocked and serial are prescribed, random shuffles.
   DRAWN ONCE per rep (see endRep) and stored in DR.plan — calling this from
   both the label and the click made the button lie about what it would do. */
function drawPlan(){
  const ci = (DR.item && DR.item.ci) || 'blocked';
  if (DR.phase === 'error')
    return { direction:DR.direction, variant:DR.variant, repair:DR.repair, label:'Run it again' };
  if (DR.needFullRep)
    return { direction:DR.direction, variant:'full', repair:false, label:'One clean full run' };
  if (DR.repair)
    return { direction:DR.direction, variant:DR.variant, repair:true, label:'The same few notes again' };
  const slice = DR.variant === 'middle' ? ' · middle only' : '';
  if (DR.direction === 'up')
    return { direction:'down', variant:DR.variant, repair:false, label:'Now descending' + slice + ' →' };
  if (ci === 'random'){
    const dir = Math.random() < 0.5 ? 'up' : 'down';
    const variant = DR.full.length > WINDOW_SIZE && Math.random() < 0.4 ? 'middle' : 'full';
    return { direction:dir, variant, repair:false,
      label:'Next: ' + (dir === 'up' ? 'ascending' : 'descending') + (variant === 'middle' ? ' · middle only' : '') };
  }
  return { direction:'up', variant:DR.variant, repair:false, label:'Ascending again' + slice + ' →' };
}
function findPosition(midi, near){
  const T = TUNING;
  let best = null;
  for (let si = 0; si < T.midi.length; si++){
    const f = midi - T.midi[si];
    if (f < 0 || f > 12) continue;
    const cost = near ? Math.abs(f - near.fret) + Math.abs(si - near.si) * 2 : f;
    if (!best || cost < best.cost) best = { si, fret:f, cost };
  }
  return best;
}

/* ---------------- drawing ---------------- */
function drillBoard(){
  const host = document.getElementById('drBoard');
  const T = TUNING, t = DR.targets;
  if (!t.length){ host.innerHTML = ''; return; }
  const idx = DR.run ? DR.run.index() : 0;
  const RANK = { ghost:1, correct:2, highlight:3, wrong:4 };
  const cells = new Map();
  const put = (m) => {
    const k = m.si + ':' + m.fret;
    const cur = cells.get(k);
    if (!cur || RANK[m.kind] > RANK[cur.kind]) cells.set(k, m);
  };
  t.forEach((x, i) => put({
    si:x.si, fret:x.fret, label:targetLabel(x), finger:x.finger,
    kind: i < idx ? 'correct' : i === idx ? 'highlight' : 'ghost'
  }));
  if (DR.phase === 'error' && DR.err){
    const p = findPosition(DR.err.played, DR.err.expected);
    if (p) put({ si:p.si, fret:p.fret, kind:'wrong', label:noteName(DR.err.played) });
  }
  const markers = [...cells.values()];
  const frets = markers.map(m => m.fret);
  const lo = Math.min(...frets), hi = Math.max(...frets);
  const used = new Set(markers.map(m => m.si));
  const dimStrings = [];
  for (let si = 0; si < T.names.length; si++) if (!used.has(si)) dimStrings.push(si);

  /* The box is the window the drill's own TITLE names — cfg.from..cfg.to — not
     merely the frets this shape happens to land on. A drill headed "Open position
     · frets 0–5" was drawing its box over frets 0–3, so the picture and the
     heading disagreed about what the drill was.
     And the visible neck is that window plus a little context, instead of a full
     twelve frets: a six-note open-position shape was three quarters empty. */
  const num = (v) => typeof v === 'number' && isFinite(v);
  const boxLo = Math.min(lo, num(DR.cfg && DR.cfg.from) ? DR.cfg.from : lo);
  const boxHi = Math.max(hi, num(DR.cfg && DR.cfg.to) ? DR.cfg.to : hi);
  const wide = window.matchMedia('(min-width:1000px)').matches;
  DR.boardApi = BassNeck.render(host, {
    strings:T.names,
    fromFret: wide ? Math.max(0, boxLo - 1) : Math.max(0, lo - 1),
    toFret:   wide ? Math.min(12, Math.max(boxHi + 2, boxLo + 6))
                   : Math.min(12, Math.max(hi + 1, lo + 4)),
    scale: wide ? 'desk' : 'play',
    markers, dimStrings,
    window: wide ? [boxLo, boxHi] : null,
    windowLabel: boxLo > 0,       // "BOX · FRET 0" would be a lie about open position
    scrollToFret: boxLo,
    animate: !!DR.flash,          // "Show me this note" pops the dots back in
    title: DR.item ? DR.item.label : 'drill'
  });
}
function renderRun(){
  if (!DR.item) return;
  const t = DR.targets, idx = DR.run ? DR.run.index() : 0;
  document.getElementById('drRunTitle').textContent = DR.item.label;
  document.getElementById('drRunKind').textContent =
    (DR.repair ? 'Fixing the bit you missed' :
     DR.variant === 'middle' ? 'Middle only' : 'Whole shape') +
    ' · ' + (DR.direction === 'up' ? 'ascending' : 'descending');
  document.getElementById('drProg').textContent =
    (DR.phase === 'done' ? t.length : Math.min(idx + 1, t.length)) + ' of ' + t.length;
  renderLabelSegs();
  drillBoard();
  setLegend('drLegend', DR.cfg ? DR.cfg.type : DP.type);

  const hint = document.getElementById('drHint');
  if (DR.phase === 'running'){
    hint.innerHTML = 'Play the <b style="color:var(--hl)">violet</b> note, then the next. Dotted circles are still to come.' +
      (DR.met && !DR.clickLost ? ' One note per click at ' + DR.bpm + ' bpm.' : '') +
      '<br>Nothing is judged until the run stops.' +
      // Said here rather than only in the verdict: otherwise he plays the rest
      // of the run believing it is still being timed against a click.
      (DR.clickLost ? '<br><b>The click stopped when you left this tab</b>, so the ' +
        'rest of this run is not being timed against it — the notes still count. ' +
        'Restart the run to get the click and the timing back.' : '');
  } else {
    hint.innerHTML = '';
  }

  const go = document.getElementById('drGo');
  go.classList.toggle('hidden', DR.phase === 'running');
  if (DR.phase !== 'running'){
    if (!DR.plan) DR.plan = drawPlan();     // stored, so the click matches the label
    go.textContent = DR.plan.label;
  }
  const fix = document.getElementById('drFix');
  fix.classList.toggle('hidden', DR.phase !== 'error');
  if (DR.phase === 'error'){
    const w = DE.errorWindow(DR.errTargets || t, DR.err.index, WINDOW_SIZE);
    fix.textContent = 'Fix that bit · ' + w.length + ' notes';
  }
  const tb = document.getElementById('drTempoBtn');
  tb.classList.toggle('hidden', !DR.tempoOffer);
  if (DR.tempoOffer) tb.textContent = '+8% → ' + DR.tempoOffer + ' bpm';
  // Speeding up is offered when timing is earned; slowing down must be offered
  // when it is missed, or "too fast" is a problem with no button attached.
  const td = document.getElementById('drTempoDownBtn');
  DR.tempoDownOffer = (DR.phase !== 'running' && DR.timing && !DR.timing.inside && DR.bpm > 40 && !DR.tempoDownTaken)
    ? Math.max(40, Math.round(DR.bpm * 0.92)) : null;
  td.classList.toggle('hidden', !DR.tempoDownOffer);
  if (DR.tempoDownOffer) td.textContent = '−8% → ' + DR.tempoDownOffer + ' bpm';

  const mastery = masteryFor(DR.item);
  const ci = DR.item.ci || 'blocked';
  document.getElementById('drPills').innerHTML =
    '<span class="pill' + (mastery === 'mastered' ? ' good' : '') + '">' + mastery + '</span>' +
    '<span class="pill">Practice order: ' + CI_WORDS[ci] + '</span>' +
    '<span class="pill">Next review: ' + dueWords(DR.item.due) + '</span>' +
    (DR.met ? '<span class="pill warn">' + DR.bpm + ' bpm</span>' : '');
  document.getElementById('drPillNote').innerHTML = CI_NOTE[ci] +
    // "cold" was jargon, and the rule was worded two different ways on one
    // screen. One wording, and the word is explained where it is used.
    ' <b>Mastered</b> means the <b>ascending</b> shape, whole, played <b>cold</b> — the day’s first ' +
    'run, before any warm-up on it — clean and in time with the click, on two separate days.';
}
function renderPanel(res, timingOk, attempt){
  const p = document.getElementById('drPanel');
  const T = TUNING;
  const t = DR.errTargets || DR.targets;
  if (!attempt.passed && DR.err){
    const e = DR.err, want = e.expected, diff = e.played - want.midi;
    const pos = findPosition(e.played, want);
    const why = e.reason === 'wrong-octave'
      ? 'Right note, <b>wrong octave</b>: you played ' + fullName(e.played) + ', ' +
        (Math.abs(diff) / 12) + ' octave' + (Math.abs(diff) === 12 ? '' : 's') + ' ' +
        (diff > 0 ? 'above' : 'below') + ' the one in the shape.'
      : '<b>Wrong note</b>: you played ' + fullName(e.played) + ' — ' + Math.abs(diff) +
        ' fret' + (Math.abs(diff) === 1 ? '' : 's') + ' ' + (diff > 0 ? 'too high' : 'too low') + '.';
    p.innerHTML =
      '<div class="note-box bad">' +
        '<div class="t-eyebrow">Stopped at note ' + (e.index + 1) + ' of ' + t.length + '</div>' +
        '<p>Expected <b>' + noteName(want.midi) +
          (DP.labels === 'degrees' ? '</b> (degree ' + want.degree + ')' : '</b>') + ' — ' +
          T.names[want.si] + ' string, fret ' + want.fret + ' (violet on the neck).</p>' +
        '<p>' + why + (pos ? ' That note is at ' + T.names[pos.si] + ' string, fret ' + pos.fret +
          ' — the outlined circle.' : '') + '</p>' +
        '<p class="t-caption">You got ' + res.notes.length + ' of ' + t.length +
          ' before it stopped. Nothing was flagged while you were playing — that is deliberate.</p>' +
        timingLine() +
        '<p class="t-caption">' + masteryLine(attempt) + '</p>' +
      '</div>';
    return;
  }
  const dir = DR.direction === 'up' ? 'ascending' : 'descending';
  const bits = [];
  // A rep that failed on timing is not "clean", and is not painted as success.
  const kind = attempt.skipped ? 'warn' : timingOk ? 'good' : 'warn';
  const clicked = !!(DR.timing && DR.timing.kind === 'click');
  // "On the click" is only said when the onsets were actually compared with the
  // click. Without one, the honest claim is even SPACING, and that is what it says.
  const okWords = clicked ? 'On the click' : 'Evenly spaced';
  // "The onsets sat 101ms ahead of the click" — nobody outside audio code knows
  // what an onset is. It is the moment a note starts, so say that.
  const offWords = clicked
    ? 'Your notes started ' + Math.abs(Math.round(DR.timing.meanSigned)) + 'ms ' +
      (DR.timing.meanSigned < 0 ? 'before' : 'after') + ' the click'
    : 'The gaps between notes wandered';
  bits.push('<div class="t-eyebrow">' +
    (attempt.skipped ? 'Finished with a skipped note'
     : timingOk ? 'Clean · ' + t.length + ' notes ' + dir
     : (clicked ? 'Right notes, off the click · ' : 'Right notes, uneven spacing · ') + t.length + ' notes ' + dir) + '</div>');
  bits.push('<p>' + (attempt.skipped
      ? 'One note was skipped for you, so this run is not a measurement of anything.'
      : (timingOk ? okWords : offWords) + (DR.met ? ' at ' + DR.bpm + ' bpm.' : '.')) +
    '</p>');
  bits.push(timingLine());
  bits.push('<p class="t-caption">' + (attempt.skipped
    ? 'The review date is unchanged.'
    : 'Back for review <b>' + dueWords(DR.item.due) + '</b> (' + DR.item.due + '). Practice order: <b>' +
      CI_WORDS[DR.item.ci || 'blocked'] + '</b>.') + '</p>');
  bits.push('<p class="t-caption">' + masteryLine(attempt) + '</p>');
  if (DR.needFullRep)
    bits.push('<p class="t-caption">Two clean window reps done — now one clean run of the whole shape.</p>');
  if (DR.tempoOffer)
    bits.push('<p class="t-caption">Two clean reps of the whole shape, in time. Take the tempo up if you want it — nothing moves unless you tap' +
      (DR.met ? '.' : ', and taking it up switches the click on so the number means something.') + '</p>');
  if (!timingOk && DR.tempoDownOffer)
    bits.push('<p class="t-caption">Right notes at the wrong speed is a tempo problem, not a you problem: <b>take it down to ' +
      DR.tempoDownOffer + ' bpm</b> and land inside the window there first. That becomes this drill’s target, and it can go back up ' +
      'the moment two reps are clean.</p>');
  p.innerHTML = '<div class="note-box ' + kind + '">' + bits.join('') + '</div>';
}

/* ---------------- due today / the shelf ---------------- */
function drillRow(item, cta){
  const mastery = masteryFor(item);
  return '<div class="dr-row">' +
      '<span class="dr-name">' + (item.label || item.id) + '</span>' +
      '<span class="pill' + (mastery === 'mastered' ? ' good' : '') + '">' + mastery + '</span>' +
      (item.due ? '<span class="pill">' + (DE.isDue(item, todayISO())
          ? 'due now' : 'next review ' + dueWords(item.due)) + '</span>' : '') +
      '<button class="btn small" data-open="' + item.id + '">' + cta + '</button>' +
    '</div>';
}
function allDrills(){
  const all = loadDrills();
  // Stored cfgs carry tuning:5 (see cfgFromPicker); anything else is a
  // hand-edited store and is not something this app can run.
  return Object.keys(all).map(k => all[k]).filter(x => x && x.cfg && x.cfg.tuning === 5);
}
/** Everything that review says is due today. */
function dueDrills(){
  const today = todayISO();
  return allDrills().filter(it => DE.isDue(it, today));
}
/* The primary action must point at TODAY'S WORK: a review that is due beats
   whatever the picker happens to be showing. The picker stays reachable through
   its own button, so nothing is taken away. */
function applyPrimaryCta(){
  const start = document.getElementById('drStart');
  const picked = document.getElementById('drStartPicked');
  const cta = document.getElementById('drDueCta');
  const due = dueDrills();
  DP.dueId = due.length ? due[0].id : null;
  picked.classList.toggle('hidden', !DP.dueId);
  cta.classList.toggle('hidden', !DP.dueId);
  if (DP.dueId){
    start.textContent = 'Run today’s review · ' + due.length + ' due';
    cta.innerHTML = 'That runs <b>' + (due[0].label || due[0].id) + '</b> — the review that is due today' +
      (due.length > 1 ? ', first of ' + due.length : '') + '. Reviews come first because the shape you have not ' +
      'touched since last time is the one with something to prove.';
  } else {
    start.textContent = 'Start the drill';
  }
  return !!DP.dueId;
}
function renderDue(){
  const host = document.getElementById('drDue');
  const due = dueDrills();
  host.innerHTML = due.length
    ? due.map(it => drillRow(it, 'Run it')).join('')
    : '<p class="t-caption">Nothing is due. Anything you drill today comes back tomorrow — that overnight gap is the one with evidence behind it.</p>';
}
function renderShelf(){
  const host = document.getElementById('drShelfBody');
  const all = allDrills().sort((a,b) => String(a.due).localeCompare(String(b.due)));
  host.innerHTML = all.length
    ? all.map(it => drillRow(it, 'Open')).join('') +
      '<p class="t-caption" style="margin-top:var(--sp3)">new → acquired → mastered. Mastered means the <b>ascending</b> shape, ' +
      'whole, played as the day’s <b>first</b> run, clean and in time <b>with the click on</b>, on two separate days — ' +
      'in-session fluency does not count, and neither do repair windows or skipped notes.</p>'
    : '<p class="t-caption">No drills yet. Pick a scale, a root and a place on the neck, then play the shape in order. ' +
      'Every finished run is scheduled for review, and what you keep missing gets its own short repair drill.</p>';
}
/** Load a cfg back into the picker controls. One mapping for the two callers
    that need it — the shelf's "Open" and a practice-plan preset — so the two
    can never disagree about how a cfg reads back into the selects. */
function pickerFromCfg(cfg){
  if (!cfg || !cfg.type) return;
  DP.type = cfg.type;
  if (cfg.scaleKey) DP.scaleKey = cfg.scaleKey;
  if (cfg.rootPc != null) DP.rootPc = cfg.rootPc;
  if (cfg.type === 'chromatic'){ DP.si = cfg.si; DP.winKey = String(cfg.from); }
  else DP.winKey = cfg.type === 'scale' ? (boxOptions(cfg.rootPc).find(w => w.from === cfg.from) || {}).key : null;
}
function openStored(id){
  const it = loadDrills()[id];
  if (!it || !it.cfg) return;
  pickerFromCfg(it.cfg);
  // startDrill decides the tempo: a bpm the player set by hand always wins.
  renderDrillPicker();
  startDrill(it.cfg);
}
function enterDrills(){
  renderDrillPicker(); renderDue(); renderShelf();
  if (DR.item) renderRun();
}

/* ---------------- wiring ---------------- */
document.getElementById('drTypeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  DP.type = b.dataset.k; DP.winKey = null; renderDrillPicker();
});
document.getElementById('drVarSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  DP.variant = b.dataset.v; renderDrillPicker();
});
document.getElementById('drScaleSel').addEventListener('change', e => { DP.scaleKey = e.target.value; DP.winKey = null; renderDrillPicker(); });
document.getElementById('drRootSel').addEventListener('change', e => { DP.rootPc = +e.target.value; DP.winKey = null; renderDrillPicker(); });
document.getElementById('drWinSel').addEventListener('change', e => { DP.winKey = e.target.value; renderDrillPicker(); });
document.getElementById('drStringSel').addEventListener('change', e => { DP.si = +e.target.value; renderDrillPicker(); });
document.getElementById('drMet').addEventListener('change', e => {
  DP.met = e.target.checked; DR.met = DP.met;
  if (!DP.met) metStop(); else if (DR.phase === 'running') metStart();
  renderDrillPicker();
  if (DR.item) renderRun();
});
document.getElementById('drBpmDown').addEventListener('click', () => {
  DP.bpm = Math.max(40, DP.bpm - 4); DP.bpmTouched = true;
  DR.bpm = DP.bpm; renderDrillPicker(); if (DR.item) renderRun();
});
document.getElementById('drBpmUp').addEventListener('click', () => {
  DP.bpm = Math.min(200, DP.bpm + 4); DP.bpmTouched = true;
  DR.bpm = DP.bpm; renderDrillPicker(); if (DR.item) renderRun();
});
document.getElementById('drStart').addEventListener('click', () => {
  // Whatever the label says is what runs: due review first, picker otherwise.
  if (DP.dueId){ openStored(DP.dueId); return; }
  startDrill(cfgFromPicker());
});
document.getElementById('drStartPicked').addEventListener('click', () => startDrill(cfgFromPicker()));
document.querySelectorAll('#drLabelSeg button, #drLabelSegRun button').forEach(b => {
  b.addEventListener('click', () => {
    DP.labels = b.dataset.k;
    renderLabelSegs(); renderDrillPicker();
    if (DR.item) renderRun();
  });
});
/* The lower-the-target button is re-rendered with the picker, so it is delegated. */
document.getElementById('drPick').addEventListener('click', e => {
  if (!e.target.closest('#drLowerTarget')) return;
  const cfg = cfgFromPicker(); if (!cfg) return;
  const it = itemFor(cfg);
  it.bpm = DP.bpm; saveDrillItem(it);
  if (DR.item && DR.item.id === it.id) DR.item.bpm = DP.bpm;
  renderDrillPicker(); renderDue(); renderShelf();
});
document.getElementById('drGo').addEventListener('click', () => {
  const plan = DR.plan || drawPlan();       // the plan that was on the label
  DR.plan = null;
  DR.direction = plan.direction; DR.variant = plan.variant; DR.repair = plan.repair;
  DR.tempoOffer = null;
  beginRep();
});
document.getElementById('drRestart').addEventListener('click', restartRun);
document.getElementById('drShow').addEventListener('click', showExpectedNote);
document.getElementById('drSkip').addEventListener('click', skipExpectedNote);
document.getElementById('drFix').addEventListener('click', () => {
  if (!DR.err) return;
  DR.repairTargets = DE.errorWindow(DR.errTargets || DR.targets, DR.err.index, WINDOW_SIZE);
  DR.repair = true; DR.repairClean = 0; DR.tempoOffer = null;
  beginRep();
});
document.getElementById('drTempoBtn').addEventListener('click', () => {
  if (!DR.tempoOffer) return;
  DR.bpm = DR.tempoOffer; DP.bpm = DR.bpm;
  // A tempo target with no click to play against is just a number.
  DP.met = true; DR.met = true;
  document.getElementById('drMet').checked = true;
  if (DR.item){ DR.item.bpm = DR.bpm; saveDrillItem(DR.item); }
  DR.history = []; DR.tempoOffer = null;      // the new tempo has to earn its own two reps
  renderDrillPicker(); renderRun();
});
document.getElementById('drTempoDownBtn').addEventListener('click', () => {
  if (!DR.tempoDownOffer) return;
  DR.bpm = DR.tempoDownOffer; DP.bpm = DR.bpm; DP.bpmTouched = true;
  DP.met = true; DR.met = true;
  document.getElementById('drMet').checked = true;
  // A target you cannot play in time is not a target: coming down moves it too.
  if (DR.item && (DR.item.bpm || 0) > DR.bpm){ DR.item.bpm = DR.bpm; saveDrillItem(DR.item); }
  DR.history = []; DR.tempoOffer = null; DR.tempoDownTaken = true;
  renderDrillPicker(); renderRun(); renderDue(); renderShelf();
});
function drillReset(){
  metStop();
  hideStall();
  DR.phase = 'idle'; DR.run = null; DR.item = null; DR.err = null;
  DR.repair = false; DR.repairTargets = null; DR.needFullRep = false; DR.targets = [];
  DR.plan = null; DR.skips = 0; DR.cfg = null;
  document.getElementById('drRun').classList.add('hidden');
  document.getElementById('drPick').classList.remove('hidden');
  renderDrillPicker(); renderDue(); renderShelf();
}
document.getElementById('drBack').addEventListener('click', drillReset);
document.getElementById('secDrill').addEventListener('click', e => {
  const b = e.target.closest('button[data-open]');
  if (b) openStored(b.dataset.open);
});
renderDrillPicker();

/* ==================================================================
   SONGS — playing along, either with the record or with the app's own
   click. The roadmaps and the judging live in shared/songs.js; this is
   only its interface. Its state is kept in its OWN localStorage key:
   plays and best root accuracy belong to the song, and neither the
   Theory Trainer's stats nor the drill records are touched.
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
  tally:{ correct:0, wrong:0 }, last:null
};

function loadSongStore(){
  try { return JSON.parse(localStorage.getItem(SONG_KEY)) || {}; } catch(e){ return {}; }
}
function saveSongPlay(song, accuracy, bankable, cov){
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
  all[song.id] = rec;
  try { localStorage.setItem(SONG_KEY, JSON.stringify(all)); } catch(e){}
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
    return '<div class="sg-item">' +
      '<div class="row between">' +
        '<div><b class="t-title3">' + song.title + '</b>' +
          '<div class="t-caption">' + song.artist + '</div></div>' +
        '<div class="row"><span class="pill num">' + song.bpm + ' bpm</span>' + best + plays + '</div>' +
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

/* ---------------- the neck: the root, and the same note an octave up ----------------
   Aimed at the E and A strings — the two the practice plan drills — so the
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
    setTxt('sgRoot', first.root);
    setTxt('sgBar', first.name + ' starts on the next 1 — ' + left + ' beat' + (left === 1 ? '' : 's') + ' to go');
    renderBeats(bpb, bpb - left + 1, true);
    songBoard(first.root);
    renderSongNext(null, bpb);
    // Nothing is running yet, so any "section N of M" is last run's number.
    prog.classList.add('hidden');
    return;
  }
  const elapsed = now - SG.t0;
  const p = SGE.positionAt(song, elapsed);
  if (p.finished){ songFinish('finished'); return; }
  setTxt('sgSection', p.section.name);
  setTxt('sgRoot', p.section.root);
  setTxt('sgBar', 'bar ' + p.barInSection + ' of ' + p.barsInSection + ' · beat ' + p.beatInBar);
  setTxt('sgProg', 'section ' + (p.section.index + 1) + ' of ' + song.sections.length);
  prog.classList.remove('hidden');
  renderBeats(bpb, p.beatInBar, false);
  songBoard(p.section.root);
  // Two bars of notice, so the warning is never later than one full bar out.
  renderSongNext(SGE.upcomingChange(song, elapsed, 2), bpb, p.section.root);
}

/* ---------------- starting, re-syncing, stopping ---------------- */
function songTeardown(){
  if (SG.timer){ clearInterval(SG.timer); SG.timer = null; }
  metStop();
}
function songOpen(id, play){
  const song = songById(id);
  if (!song) return;
  songTeardown();
  SG.song = song; SG.play = play === 'click' ? 'click' : 'record';
  SG.t0 = null; SG.startAt = null; SG.startSection = 0; SG.seen = null;
  SG.run = null; SG.finished = false; SG.rootShown = null;
  SG.tally = { correct:0, wrong:0 }; SG.last = null; SG.resyncs = 0; SG.sawSignal = false;
  document.getElementById('sgListCard').classList.add('hidden');
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
  if (total > 0) saveSongPlay(song, res.accuracy, bankable, { sections:covered, of, full:fullPlay });
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

  const head = (reason === 'finished' ? 'End of the roadmap · ' : 'Stopped partway · ') + song.title;
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
  renderSongList();
}
function enterSongs(){
  renderSongList();
  if (!SG.song){
    document.getElementById('sgPlay').classList.add('hidden');
    document.getElementById('sgListCard').classList.remove('hidden');
  }
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
renderSongList();

/* ==================================================================
   ENTRY POINTS — how the shell drives this half.

   The old page put the mic gate in front of everything: you could not
   see a tuner needle or a drill picker without granting a microphone
   first. Now the practice plan is the front door and this half is
   five tabs behind it, so the gate has moved to exactly where it is
   needed: the first Live mode you ask for, phrased as the thing you
   asked for ("Start listening & run the drill", not Start, then Run).
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
  /* What is due is a fact about your history, not about the microphone, and it
     used to be locked behind the gate — you could not glance at tonight's review
     without switching the mic on first. Read-only here: no run starts from it. */
  const extra = document.getElementById('gateExtra');
  if (!extra) return;
  const due = m === 'drill' ? dueDrills() : [];
  extra.innerHTML = !due.length ? '' :
    '<div class="t-eyebrow">Due today</div>' +
    due.map(it => '<div class="dr-row"><span class="dr-name">' + (it.label || it.id) + '</span>' +
      '<span class="pill">' + masteryFor(it) + '</span>' +
      '<span class="pill">due now</span></div>').join('') +
    '<p class="t-caption" style="margin:var(--sp2) 0 0">Start listening and the first of these is what the ' +
    'button runs.</p>';
  extra.classList.toggle('hidden', !due.length);
}

/** Stop the analyser loop, keep the stream and the AudioContext. Called when a
    Learn tab takes the screen: polling 18×/second behind a practice plan is
    pure waste, but dropping the stream would put the gate back.

    The click stops too. It used to keep ticking from behind the practice plan,
    audible with nothing on screen to stop it. Nothing already recorded is
    harmed by stopping it — DR.metOrigin is a snapshot taken at metStart, and
    metStop leaves it alone — but the notes AFTER it would be graded against a
    grid the player can no longer hear, so this rep stops claiming the click and
    falls back to the even-spacing report, which already words itself honestly.
    A song is stopped outright: its clock is wall-time from the tap, so it would
    run away while off-screen and come back pointing at the wrong section. */
function suspend(){
  if (A.timer){ clearInterval(A.timer); A.timer = null; }
  if (SG.song && SG.t0 != null && !SG.finished){ songFinish('stopped'); return; }
  if (MET.timer){
    metStop();
    if (DR.phase === 'running' && DR.met){ DR.clickLost = true; DR.metOrigin = null; }
    if (DR.phase === 'running') renderRun();
  }
}
function resume(){
  if (A.analyser && !A.timer) A.timer = setInterval(tick, 55);
  /* Nothing was listening while a Learn tab had the screen, so whatever is
     sounding on the way back was not played AT the exercise — it is a string that
     was still ringing, or the note you were on when you wandered off. Detection
     is re-armed the way a new rep re-arms it, because otherwise the first thing
     heard on return answered the current target and a drill could come back
     already failed on a note the player never aimed at it. */
  tracker = C.createTracker({ stableMs:150 });
  if (DR.phase === 'running') DR.lastAdvanceAt = performance.now();
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
   it plants the question it is about to "play" (q, echoTarget), jumps the hint
   level, resets the pitch tracker between notes. Those names were globals when
   this file was a <script> in its own page; now that both apps share one
   document they cannot be, so the seam the suite holds on to is published here
   deliberately. Accessors, not copies — the suite ASSIGNS q and echoTarget and
   the app has to see the write. */
[['q',        () => q,        v => { q = v; }],
 ['hintLevel',() => hintLevel,v => { hintLevel = v; }],
 ['wrongThisQ',()=> wrongThisQ,v => { wrongThisQ = v; }],
 ['qStart',   () => qStart,   v => { qStart = v; }],
 ['echoTarget',()=> echoTarget,v => { echoTarget = v; }],
 ['echoWrongThisTarget', () => echoWrongThisTarget, v => { echoWrongThisTarget = v; }],
 ['tier',     () => tier,     v => { tier = v; }],
 ['focus',    () => focus,    v => { focus = v; }],
 ['mode',     () => mode,     v => { mode = v; }],
 // rebuilt whenever a run starts, so a snapshot would be the wrong tracker
 ['tracker',  () => tracker,  v => { tracker = v; }]
].forEach(([name, get, set]) =>
  Object.defineProperty(window, name, { configurable:true, get, set }));
window.setMode = setMode;
window.showHint = showHint;
window.renderTierUI = renderTierUI;
window.A = A;
/* trainer/test/shell.test.js asks what happened to the click, the drill run and
   the song clock when the screen went to a Learn tab. Those are the objects that
   hold the answer, and timingReport/timingLine are how a run's verdict is
   reached — a test that re-derived either would be testing its own copy. */
window.MET = MET;
window.DR = DR;
window.SG = SG;
window.timingReport = timingReport;
window.timingLine = timingLine;
/* trainer/test/bookkeeping.test.js hunts for a note the way a beginner does —
   two wrong notes then the right one — which needs to feed readings straight in:
   a synthetic mic plays one fixed pitch, and the question is picked at random. */
window.onStableNote = onStableNote;
})();
