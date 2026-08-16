/* ==================================================================
   The Learn half of the app: the Scales and Chords charts, and the
   click that runs beside them. Nothing here touches the microphone,
   which is the point — you can look a shape up mid-session without
   the app asking for anything.

   It was four screens. A twelve-week practice plan was the front door
   and a tap-a-fret note quiz sat beside it; both are retired, because
   the game asks the questions now. What is left is reference: the two
   charts, the theory cards that annotate them, and a metronome.

   Lifted verbatim out of index.html when the two apps became one
   page. It is wrapped in an IIFE because both apps now share one
   global scope and both declare TUNING, SCALES, NAMES, S and pcOf —
   textual concatenation would have made one of them win at random.
   The only thing published is window.BassTheory, at the bottom.
   ================================================================== */
(function(){
"use strict";
/* ================= CORE: notes, state, audio, fretboard ================= */
const NAMES_S = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NAMES_F = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const FLAT_ROOTS = new Set(['F','Bb','Eb','Ab','Db']); // keys spelled with flats
const NATURALS = new Set(['C','D','E','F','G','A','B']);
/* Flat spellings, because that is how these keys are written in the rock this
   app is aimed at. The game's own study cards are sharp-spelled, so both say
   somewhere that the two are one note — otherwise it reads as two different
   sets of twelve. */
const ALL_ROOTS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

// open-string MIDI numbers, low to high — B0 E1 A1 D2 G2
const TUNING = { midi:[23,28,33,38,43], names:['B','E','A','D','G'] };
function pc(midi){ return ((midi % 12) + 12) % 12; }
function noteName(midi, useFlats){ return (useFlats ? NAMES_F : NAMES_S)[pc(midi)]; }
function bothNames(midi){
  const s = NAMES_S[pc(midi)], f = NAMES_F[pc(midi)];
  return s === f ? s : s + '/' + f;
}
function rootPc(rootName){
  let i = NAMES_S.indexOf(rootName);
  if (i < 0) i = NAMES_F.indexOf(rootName);
  return i;
}
function freq(midi){ return 440 * Math.pow(2, (midi - 69) / 12); }

/* ---------------- state ----------------
   Two charts' display settings and the list of lessons you have waved away.
   It used to be far more: a note quiz's tiers and running stats, and a
   twelve-week practice plan's log and checkpoints. Both screens are retired
   and their branches went with them — see the one-time clean-out in the
   boot section at the bottom of this file. */
const LS_KEY = 'bassTrainer.charts.v1';
function defaultState(){
  return {
    scales:{ root:'E', type:'minPent', view:'open', labels:'names' },
    chords:{ root:'E', type:'power', labels:'names' },
    dismissed:[]          // theory card ids you have closed
  };
}
let S = loadState();
function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const st = defaultState();
    const saved = JSON.parse(raw);
    // deep-merge saved over defaults (one level is enough for our shape)
    for (const k in saved){
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k]))
        st[k] = Object.assign({}, st[k], saved[k]);
      else st[k] = saved[k];
    }
    return normalizeState(st);
  }catch(e){ return defaultState(); }
}
/* A store written by an older build, half-written, or hand-edited must degrade
   to empty rather than throw the first time something indexes into it — this
   page's records are now read alongside two other apps' stores. */
function normalizeState(st){
  const D = defaultState();
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  st.scales = isObj(st.scales) ? st.scales : D.scales;
  st.chords = isObj(st.chords) ? st.chords : D.chords;
  st.dismissed = Array.isArray(st.dismissed) ? st.dismissed : [];
  return st;
}
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(S)); }catch(e){} }

/* ---------------- audio ---------------- */
const Audio_ = (() => {
  let ctx = null, master = null;
  function ensure(){
    if (!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      // gentle limiter so stacked notes don't clip on phone speakers
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // bass pluck: saw fundamental + octave partial through a lowpass.
  // The octave partial matters: phone speakers can't reproduce 31 Hz,
  // so the upper harmonics carry the pitch.
  function note(midi, dur = 0.6, when = 0, vel = 1){
    const c = ensure(); const t = c.currentTime + when;
    const f = freq(midi);
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.55 * vel, t + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(Math.min(Math.max(f * 16, 700), 2600), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 6, 400), t + dur * 0.7);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.38;
    const o3 = c.createOscillator(); o3.type = 'sine'; o3.frequency.value = f * 4;
    const g3 = c.createGain(); g3.gain.value = 0.10;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp);
    lp.connect(out); out.connect(master);
    o1.start(t); o2.start(t); o3.start(t);
    const end = t + dur + 0.08;
    o1.stop(end); o2.stop(end); o3.stop(end);
  }
  function click(accent, when = 0){
    const c = ensure(); const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.value = accent ? 1800 : 1150;
    const g = c.createGain();
    g.gain.setValueAtTime(accent ? 0.5 : 0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.06);
  }
  return { ensure, note, click, now:() => (ctx ? ctx.currentTime : 0) };
})();

/* ---------------- fretboard component ----------------
   cfg = {
     frets: 12,
     strings: [indices into tuning, low->high] or null = all,
     mark(stringIdx, fret) -> null | {cls:'root|tone|hl|ghost|good|bad', label, finger},
     onTap(stringIdx, fret, midi),
     disable(stringIdx, fret) -> bool,
     boxWindow: [lo, hi] or null  (frets outside get dimmed)
   }
   stringIdx is index into TUNING.midi (0 = lowest string).
   Rendered top row = HIGHEST string (like reading tab).
------------------------------------------------------- */
/* Adapter onto the shared SVG neck renderer (shared/neck.js).
   Keeps the call sites below unchanged while the drawing itself is now a
   real fingerboard rather than a table of cells. */
const KIND = { root:'root', tone:'tone', hl:'highlight', ghost:'ghost', asked:'asked',
               good:'correct', bad:'wrong', playing:'highlight' };

function drawFretboard(el, cfg){
  const tun = TUNING;
  const frets = cfg.frets != null ? cfg.frets : 12;
  const fromFret = cfg.fromFret || 0;
  const nStr = tun.midi.length;

  const dimStrings = [];
  for (let si = 0; si < nStr; si++){
    let allOff = true;
    for (let f = fromFret; f <= frets && allOff; f++) if (!(cfg.disable && cfg.disable(si, f))) allOff = false;
    if (allOff) dimStrings.push(si);
  }

  // Snapshot the marks once; setNote() edits this list and redraws.
  const markers = [];
  for (let si = 0; si < nStr; si++){
    if (dimStrings.indexOf(si) >= 0) continue;
    for (let f = fromFret; f <= frets; f++){
      if (cfg.disable && cfg.disable(si, f)) continue;
      const m = cfg.mark ? cfg.mark(si, f) : null;
      if (m) markers.push({ si, fret:f, kind: KIND[m.cls] || 'tone', label:m.label, finger:m.finger });
    }
  }

  let handle = null;
  function paint(keepScroll){
    const left = keepScroll && handle ? handle.scroll.scrollLeft : null;
    handle = BassNeck.render(el, {
      strings: tun.names, fromFret, toFret: frets, scale: cfg.scale || neckScale(),
      markers: markers.slice(), window: cfg.boxWindow, windowLabel: cfg.boxWindow ? true : false,
      dimStrings, animate: !keepScroll,
      onTap: cfg.onTap ? (si, f) => cfg.onTap(si, f, tun.midi[si] + f) : null,
      title: cfg.title,
    });
    if (left != null) handle.scroll.scrollLeft = left;
  }
  paint(false);

  function put(si, f, kind, label){
    const i = markers.findIndex(m => m.si === si && m.fret === f);
    if (i >= 0) markers[i] = { si, fret:f, kind, label: label != null ? label : markers[i].label };
    else markers.push({ si, fret:f, kind, label });
    paint(true);
  }

  return {
    get el(){ return handle.svg; },
    cellAt(si, f){ return handle.marker(si, f); },
    setNote(si, f, cls, label){ put(si, f, KIND[cls] || cls || 'tone', label); },
    clearNote(si, f){
      const i = markers.findIndex(m => m.si === si && m.fret === f);
      if (i >= 0){ markers.splice(i, 1); paint(true); }
    },
    setPlaying(si, f){
      handle.svg.querySelectorAll('.neck-marker.is-playing')
        .forEach(n => n.classList.remove('is-playing'));
      const m = handle.marker(si, f);
      if (m) m.classList.add('is-playing');
    },
    clearPlaying(){
      handle.svg.querySelectorAll('.neck-marker.is-playing')
        .forEach(n => n.classList.remove('is-playing'));
    },
    pulse(si, f){ handle.pulse(si, f); },
    scrollToFret(f){ handle.scrollTo(f); },
  };
}

/* orientation helper line shown under fretboards */
/**
 * The caption under a fretboard.
 *
 * `tappable` must be false wherever a tap would give the answer away: "Name the
 * note" marks a fret and asks what it is, and the caption sat underneath saying
 * "Tap any fret to hear it" — an invitation to cheat the quiz being taken.
 */
function fbCaption(tappable){
  return '<div class="muted small" style="margin:2px 4px 6px">Reads like tab: thin G string on top, thick low ' +
    'B at the bottom.' + (tappable === false ? '' : ' Tap any fret to hear it.') + '</div>';
}

/* ---------------- theory cards ---------------- */
const CARDS = {
  degrees:{ title:'Degrees 101: what "R, b3, 5" means',
    body:'Notes in a scale get numbers counted from the root: R (root) = 1, then 2, 3… A "b" (flat) means one fret lower. So b3 = "the 3rd, lowered one fret" — that single fret is what makes minor sound dark instead of happy.' },
  bcef:{ title:'The B–C and E–F rule',
    body:'Between most letter names there\'s a sharp note (one fret apart). B→C and E→F are the exceptions: NO sharp in between — they sit on neighboring frets. Memorize those two pairs and the whole fretboard gets easier.' },
  octave:{ title:'The octave shape',
    body:'Same note one octave up = 2 strings up + 2 frets up. It\'s one moveable shape that works everywhere on the neck. Find a root, and you instantly know a second place to play it.' },
  fifth:{ title:'Why metal loves the 5th',
    body:'The 5th is the interval in a power chord (R + 5). It\'s neither major nor minor — no 3rd — so it sounds huge and neutral under distortion. As a bassist: root and 5th are your two best friends.' },
  relative:{ title:'Em and G major are twins',
    body:'E minor and G major contain the exact same 7 notes — they just treat a different note as home base. That\'s called relative major/minor. It\'s why TNT (in E minor) can lean on a G: it\'s family.' },
  enharm:{ title:'C# and Db are the same fret',
    body:'One fret, two names. Which name you use depends on the key you\'re in — but under your finger it\'s identical. Don\'t let double names scare you.' },
  flat7:{ title:'"7" means flat 7 (by default)',
    body:'When a chord is written E7 or Em7, the 7 means the FLAT 7th — the rock/blues flavor. The "pretty" natural 7th gets a longer name: maj7. Default 7 = b7. That\'s why rock is full of 7 chords.' },
  rootsJob:{ title:'Roots are the bassist\'s job',
    body:'When the band plays an E chord, your job #1 is to land on E. Nail the root on beat 1, keep the rhythm locked, and you\'re already a real bassist. Everything else (5ths, octaves, fills) is decoration on top.' },
  bstring:{ title:'Taming the low B string',
    body:'The B string is the E string\'s mirror, 5 frets up: any note on the E string also lives on the B string 5 frets HIGHER. Example: E is B-string fret 5, G is B-string fret 8. Learn E-string notes and the B string comes free.' },
  fretHalfStep:{ title:'1 fret = a half step',
    body:'Every fret raises the pitch by one half step (semitone) — the smallest step in Western music. 2 frets = whole step. All scale formulas are just recipes of half steps, which is why shapes are moveable.' }
};
function theoryCard(id){
  if (S.dismissed.includes(id) || !CARDS[id]) return '';
  const c = CARDS[id];
  return '<div class="tcard" data-card="' + id + '">' +
    // data-dismiss, not onclick="dismissCard(...)": an inline handler resolves
    // against window, and this file's functions became private when the two apps
    // were merged into one document — so all ten ✕ buttons silently threw
    // "dismissCard is not defined" and nothing could be dismissed.
    '<button class="dismiss" title="Dismiss" data-dismiss="' + id + '">✕</button>' +
    '<h4>' + c.title + '</h4><p>' + c.body + '</p></div>';
}
function dismissCard(id){
  if (!S.dismissed.includes(id)) S.dismissed.push(id);
  save();
  document.querySelectorAll('[data-card="' + id + '"]').forEach(e => e.remove());
}
/* Delegated once, at the document, because theory cards are re-rendered by four
   different tabs and a per-render binding would have to be re-attached by each. */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-dismiss]');
  if (b) dismissCard(b.dataset.dismiss);
});

/* ---------------- routing ---------------- */
/** Board size for the current viewport: a desk gets a neck you can read
    from a metre away; a phone gets the tappable one. */
function neckScale(){ return window.matchMedia('(min-width:1000px)').matches ? 'desk' : 'play'; }
function readScale(){ return window.matchMedia('(min-width:1000px)').matches ? 'readbig' : 'read'; }
const TABS = ['scales','chords'];
let currentTab = null;
/** Show one of this app's two charts, or neither (`null`) when a Live tab has
    the screen. The shell calls this; it never calls render directly. */
function show(tab){
  stopPlayback();
  /* Re-read the store on the way in. The two halves no longer share a key, but
     a second copy of this page in another browser tab does, and the next save()
     here would otherwise write back a state from before its edits. */
  S = loadState();
  currentTab = tab;
  TABS.forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('on', t === tab);
  });
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === tab));
  if (!tab) return;
  render(tab);
}
function render(tab){
  if (tab === 'scales') renderScales();
  if (tab === 'chords') renderChords();
}
/* deepLink() lived here, alongside a `navigate` the shell handed in: the
   practice plan carried links that opened a chart already set to the scale or
   chord the week was teaching, and following one from a Live tab had to go
   through the router. The plan is retired and nothing writes such a link any
   more, so the only route into a chart is the nav — which the shell already
   owns. */
/* ================= FEATURE 1: SCALE EXPLORER ================= */
const SCALES = {
  minPent:{ name:'Minor pentatonic', iv:[0,3,5,7,10], deg:['R','b3','4','5','b7'],
    blurb:'The skeleton of ~80% of rock & metal riffs. If you learn ONE scale, it\'s this one.' },
  natMinor:{ name:'Natural minor', iv:[0,2,3,5,7,8,10], deg:['R','2','b3','4','5','b6','b7'],
    blurb:'Minor pentatonic + two extra notes (2 and b6). The full "dark/heavy" scale.' },
  majPent:{ name:'Major pentatonic', iv:[0,2,4,7,9], deg:['R','2','3','5','6'],
    blurb:'The bright cousin of minor pentatonic — same shape, different home note.' },
  major:{ name:'Major scale', iv:[0,2,4,5,7,9,11], deg:['R','2','3','4','5','6','7'],
    blurb:'The "do-re-mi" ruler that every formula is measured against.' },
  blues:{ name:'Blues scale', iv:[0,3,5,6,7,10], deg:['R','b3','4','b5','5','b7'],
    blurb:'Minor pentatonic + one spicy note (the b5). Instant attitude.' }
};
const SCALE_ORDER = ['minPent','natMinor','majPent','major','blues'];

/** Render degree names with a real flat sign, matching the fretboard. */
function flatSign(deg){ return String(deg).replace(/^b(?=[0-9])/, '\u266d'); }
function stepFormula(iv){
  const steps = [];
  for (let i = 1; i < iv.length; i++) steps.push('+' + (iv[i] - iv[i-1]));
  steps.push('+' + (12 - iv[iv.length-1]) + ' → R');
  return 'R ' + steps.join(' ');
}
function scaleNotes(rootName, iv){
  const rp = rootPc(rootName);
  const flats = FLAT_ROOTS.has(rootName);
  return iv.map(i => (flats ? NAMES_F : NAMES_S)[(rp + i) % 12]);
}
function lowestStringRootFret(rootName){
  const rp = rootPc(rootName);
  const open = TUNING.midi[0];
  for (let f = 1; f <= 12; f++) if (pc(open + f) === rp) return f;
  return 12; // pc(open) === rp -> octave at 12
}
let playTimers = [];
function stopPlayback(){
  playTimers.forEach(t => clearTimeout(t));
  playTimers = [];
  [scaleFbHandle, chordFbHandle].forEach(h => { if (h && h.clearPlaying) h.clearPlaying(); });
}
function playSequence(handle, seq, msPerNote, onDone){
  stopPlayback();
  Audio_.ensure();
  seq.forEach((p, i) => {
    playTimers.push(setTimeout(() => {
      Audio_.note(p.midi, 0.55);
      handle.setPlaying(p.si, p.f);
    }, i * msPerNote));
  });
  playTimers.push(setTimeout(() => {
    handle.clearPlaying();
    if (onDone) onDone();
  }, seq.length * msPerNote + 100));
}

let scaleFbHandle = null, scPage = 0;
function renderScales(){
  const el = document.getElementById('tab-scales');
  const sc = SCALES[S.scales.type];
  const rp = rootPc(S.scales.root);
  const flats = FLAT_ROOTS.has(S.scales.root);
  const scalePcs = new Set(sc.iv.map(i => (rp + i) % 12));
  const degOf = {};
  sc.iv.forEach((i, k) => degOf[(rp + i) % 12] = sc.deg[k]);
  const notes = scaleNotes(S.scales.root, sc.iv);
  const anchor = lowestStringRootFret(S.scales.root);
  const boxHi = anchor + 3 + (sc.iv.length > 5 ? 1 : 0);
  const view = S.scales.view;

  let h = '<h2>Scale explorer</h2>';
  h += '<div class="card tight">';
  h += '<h3>Scale</h3><div class="seg" id="scType">' + SCALE_ORDER.map(k =>
    '<button data-k="' + k + '" class="' + (k === S.scales.type ? 'on' : '') + '">' + SCALES[k].name + '</button>').join('') + '</div>';
  h += '<h3>Root note</h3><p class="muted small" style="margin:0 0 4px">Db is the same note as C#, Eb as D#, and so ' +
    'on — one key, two spellings. Elsewhere in the app you will see the sharp names.</p>' +
    '<div class="seg compact" id="scRoot">' + ALL_ROOTS.map(r =>
    '<button data-k="' + r + '" class="' + (r === S.scales.root ? 'on' : '') + '">' + r + '</button>').join('') + '</div>';
  h += '</div>';

  h += theoryCard('degrees');

  h += '<div class="card">';
  h += '<div style="font-size:17px; font-weight:700">' + S.scales.root + ' ' + sc.name.toLowerCase() + '</div>';
  h += '<p class="muted" style="margin:4px 0 8px">' + sc.blurb + '</p>';
  h += '<div class="chips">' + notes.map((n, i) =>
    '<span class="chip ' + (i === 0 ? 'root' : 'tone') + '">' + n + '<small>' + flatSign(sc.deg[i]) + '</small></span>').join('') + '</div>';
  h += '<p class="small" style="margin:10px 0 0"><b>Step recipe:</b> ' + stepFormula(sc.iv) +
    '<br><span class="muted">Each number = how many frets (= half steps) to the next note. Same recipe from ANY root — that\'s why shapes are moveable.</span></p>';
  h += '</div>';

  h += theoryCard('fretHalfStep');

  h += '<div class="card">';
  h += '<div class="row between">';
  h += '<div class="seg compact" id="scView">' +
    '<button data-k="open" class="' + (view === 'open' ? 'on' : '') + '">Open position</button>' +
    '<button data-k="box" class="' + (view === 'box' ? 'on' : '') + '">Moveable box</button>' +
    '<button data-k="neck" class="' + (view === 'neck' ? 'on' : '') + '">Whole neck</button></div>';
  h += '<div class="seg compact" id="scLabels">' +
    '<button data-k="names" class="' + (S.scales.labels === 'names' ? 'on' : '') + '">Names</button>' +
    '<button data-k="degrees" class="' + (S.scales.labels === 'degrees' ? 'on' : '') + '">Degrees</button></div>';
  h += '</div>';
  const viewNote = view === 'open'
    ? 'Open position = frets 0–5, using open strings where you can. Home base for beginners.'
    : view === 'box'
    ? 'The moveable box, anchored where the root (' + S.scales.root + ') sits on your lowest string — fret ' + anchor + '. Slide the whole box to a new root and it\'s the same scale in a new key. Numbers on the dots = suggested finger (1=index, 2=middle, 3=ring, 4=pinky).' +
      (anchor >= 10 ? ' Cramped this high up? Slide the identical shape lower — anchored at fret 5 it becomes ' + noteName(TUNING.midi[0] + 5, false) + ' ' + sc.name.toLowerCase() + '.' : '')
    : 'Every ' + S.scales.root + ' ' + sc.name.toLowerCase() + ' note, frets 0–12. Notice the patterns repeating.';

  /* Open position draws six fret columns, so on a desktop it was a ~450px picture
     alone in a ~1100px card with two thirds of the row empty. The wide views fill
     the card on their own and are left alone; this one gets its explanation beside
     it instead of underneath. `.board-split` collapses back to one column below
     1000px, so the phone layout is unchanged. */
  const split = view === 'open';
  if (split) h += '<div class="board-split">';
  if (split) h += '<div class="bs-board">';
  h += '<div id="scaleFb"></div>';
  if (view === 'neck' && !window.matchMedia('(min-width:1000px)').matches){
    const wins = BassNeck.windows(12);
    h += '<div class="fret-pager seg compact" id="scPager">' + wins.map((w, i) =>
      '<button data-k="' + i + '" class="' + (i === scPage ? 'on' : '') + '">Frets ' + w[0] + '–' + w[1] + '</button>').join('') + '</div>';
  }
  h += fbCaption();
  if (split) h += '</div><div class="bs-aside">';
  h += '<p class="muted small" style="margin:' + (split ? '0' : '8px 2px 0') + '">' + viewNote + '</p>';
  h += '<div class="legend"><span class="l-root"><i></i>root</span><span class="l-tone"><i></i>scale tone</span><span class="l-hl"><i></i>now playing</span></div>';
  h += '<div class="row" style="margin-top:6px"><button class="btn primary" id="scPlay">▶ Play scale (slow)</button><button class="btn ghost" id="scStop">■ Stop</button></div>';
  if (split) h += '</div></div>';
  h += '</div>';

  if ((S.scales.type === 'minPent' || S.scales.type === 'natMinor') && S.scales.root === 'E') h += theoryCard('relative');
  h += theoryCard('octave');
  /* The click. It lived on the practice plan, which is retired — and a scale is
     the thing you most want to run against one, so it came here rather than
     being deleted with the screen that happened to host it. */
  h += metronomeHtml();

  el.innerHTML = h;

  // fretboard — box view extends past fret 12 when the shape needs it
  const wide = window.matchMedia('(min-width:1000px)').matches;
  const wins = BassNeck.windows(12);
  if (scPage >= wins.length) scPage = 0;
  const neckWin = wide ? [0, 12] : wins[scPage];
  const frets = view === 'open' ? 5 : (view === 'box' ? Math.max(12, boxHi) : neckWin[1]);
  const neckFrom = view === 'neck' ? neckWin[0] : 0;
  const boxWin = view === 'box' ? [anchor, boxHi] : null;
  scaleFbHandle = drawFretboard(document.getElementById('scaleFb'), {
    frets, fromFret: neckFrom,
    boxWindow: boxWin,
    onTap(si, f, midi){ Audio_.note(midi); },
    mark(si, f){
      const midi = TUNING.midi[si] + f;
      const p = pc(midi);
      if (!scalePcs.has(p)) return null;
      const isRoot = p === rp;
      const label = S.scales.labels === 'degrees' ? degOf[p] : noteName(midi, flats);
      const m = { cls: isRoot ? 'root' : 'tone', label };
      if (boxWin && f >= boxWin[0] && f <= boxWin[1]){
        m.finger = String(Math.min(4, f - anchor + 1));
      }
      return m;
    }
  });
  if (view === 'box') scaleFbHandle.scrollToFret(anchor);

  // sequence for playback: in-view scale tones, one octave up from lowest root, then back
  function buildSeq(){
    const tun = TUNING;
    const pos = [];
    const lo = boxWin ? boxWin[0] : 0, hi = boxWin ? boxWin[1] : frets;
    for (let si = 0; si < tun.midi.length; si++)
      for (let f = lo === 0 ? 0 : lo; f <= hi; f++){
        const midi = tun.midi[si] + f;
        if (scalePcs.has(pc(midi))) pos.push({ si, f, midi });
      }
    pos.sort((a, b) => a.midi - b.midi || a.si - b.si);
    const firstRoot = pos.find(p => pc(p.midi) === rp);
    if (!firstRoot) return [];
    const start = firstRoot.midi;
    const seen = new Set();
    const asc = [];
    for (const p of pos){
      if (p.midi >= start && p.midi <= start + 12 && !seen.has(p.midi)){
        seen.add(p.midi); asc.push(p);
      }
    }
    const desc = asc.slice(0, -1).reverse();
    return asc.concat(desc);
  }
  document.getElementById('scPlay').addEventListener('click', () => {
    playSequence(scaleFbHandle, buildSeq(), 550);
  });
  document.getElementById('scStop').addEventListener('click', stopPlayback);

  // controls
  bindSeg('scType', k => { S.scales.type = k; save(); renderScales(); });
  bindSeg('scRoot', k => { S.scales.root = k; save(); renderScales(); });
  bindSeg('scView', k => { S.scales.view = k; save(); renderScales(); });
  bindSeg('scLabels', k => { S.scales.labels = k; save(); renderScales(); });
  bindSeg('scPager', k => { scPage = +k; renderScales(); });
  mountMetronome();
}
function bindSeg(id, fn){
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => { stopPlayback(); fn(b.dataset.k); }));
}

/* ================= FEATURE 2: CHORD / ARPEGGIO EXPLORER ================= */
const CHORDS = {
  power:{ name:'Power chord (5)', sym:'5', iv:[0,7], deg:['R','5'],
    blurb:'Root + 5th, nothing else. No 3rd = neither major nor minor — just weight. THE rock/metal sound. On bass you play these as two single notes, not a strum.' },
  maj:{ name:'Major triad', sym:'', iv:[0,4,7], deg:['R','3','5'],
    blurb:'Root + bright 3rd + 5th. The "happy" chord. As a bassist you outline it one note at a time (an arpeggio).' },
  min:{ name:'Minor triad', sym:'m', iv:[0,3,7], deg:['R','b3','5'],
    blurb:'"m" flattens the 3rd by one fret — that single fret turns bright into dark. Root + b3 + 5.' },
  m7:{ name:'Minor 7', sym:'m7', iv:[0,3,7,10], deg:['R','b3','5','b7'],
    blurb:'Decoder: m = flat 3rd (dark) + 7 = flat 7 by default (rock flavor). A minor triad with a smoky b7 on top.' },
  dom7:{ name:'Dominant 7', sym:'7', iv:[0,4,7,10], deg:['R','3','5','b7'],
    blurb:'Bright major 3rd + gritty flat 7 = built-in blues tension. AC/DC and every blues-rock band live here.' }
};
const CHORD_ORDER = ['power','min','maj','m7','dom7'];

let chordFbHandle = null;
function renderChords(){
  const el = document.getElementById('tab-chords');
  const ch = CHORDS[S.chords.type];
  const rp = rootPc(S.chords.root);
  const flats = FLAT_ROOTS.has(S.chords.root);
  const chordPcs = new Set(ch.iv.map(i => (rp + i) % 12));
  const degOf = {};
  ch.iv.forEach((i, k) => degOf[(rp + i) % 12] = ch.deg[k]);
  const notes = scaleNotes(S.chords.root, ch.iv);

  let h = '<h2>Chords &amp; arpeggios</h2>';
  h += '<p class="muted small" style="margin:2px 2px 8px">Bassists don\'t strum chords — we spell them out one note at a time. That\'s an <b>arpeggio</b>.</p>';
  h += '<div class="card tight">';
  h += '<h3>Chord type</h3><div class="seg" id="chType">' + CHORD_ORDER.map(k =>
    '<button data-k="' + k + '" class="' + (k === S.chords.type ? 'on' : '') + '">' + CHORDS[k].name + '</button>').join('') + '</div>';
  h += '<h3>Root note</h3><div class="seg compact" id="chRoot">' + ALL_ROOTS.map(r =>
    '<button data-k="' + r + '" class="' + (r === S.chords.root ? 'on' : '') + '">' + r + '</button>').join('') + '</div>';
  h += '</div>';

  h += theoryCard('degrees');

  h += '<div class="card">';
  h += '<div style="font-size:17px; font-weight:700">' + S.chords.root + ch.sym + ' — ' + ch.name.toLowerCase() + '</div>';
  h += '<p class="muted" style="margin:4px 0 8px">' + ch.blurb + '</p>';
  h += '<div class="chips">' + notes.map((n, i) =>
    '<span class="chip ' + (i === 0 ? 'root' : 'tone') + '">' + n + '<small>' + flatSign(ch.deg[i]) + '</small></span>').join('') + '</div>';
  h += '</div>';

  if (S.chords.type === 'power') h += theoryCard('fifth');
  if (S.chords.type === 'm7' || S.chords.type === 'dom7') h += theoryCard('flat7');

  // fretboard: chord tones everywhere, shape window anchored at root
  const eIdx = 1; // E string index (B is 0)
  const eOpen = TUNING.midi[eIdx];
  let anchorE = null;
  for (let f = 0; f <= 12; f++) if (pc(eOpen + f) === rp){ anchorE = f; break; }
  h += '<div class="card">';
  h += '<div class="row between"><b>Arpeggio on the fretboard</b>';
  h += '<div class="seg compact" id="chLabels">' +
    '<button data-k="names" class="' + (S.chords.labels === 'names' ? 'on' : '') + '">Names</button>' +
    '<button data-k="degrees" class="' + (S.chords.labels === 'degrees' ? 'on' : '') + '">Degrees</button></div></div>';
  h += '<div id="chordFb"></div>' + fbCaption();
  h += '<div class="legend"><span class="l-root"><i></i>root</span><span class="l-tone"><i></i>chord tone</span><span class="l-hl"><i></i>now playing</span></div>';
  h += '<div class="row" style="margin-top:6px"><button class="btn primary" id="chPlay">▶ Play arpeggio</button><button class="btn ghost" id="chStop">■ Stop</button></div>';
  h += '</div>';

  // containment chain
  h += containmentChain(ch, rp, flats);
  h += theoryCard('rootsJob');
  el.innerHTML = h;

  chordFbHandle = drawFretboard(document.getElementById('chordFb'), {
    frets:12,
    onTap(si, f, midi){ Audio_.note(midi); },
    mark(si, f){
      const midi = TUNING.midi[si] + f;
      const p = pc(midi);
      if (!chordPcs.has(p)) return null;
      const isRoot = p === rp;
      const label = S.chords.labels === 'degrees' ? degOf[p] : noteName(midi, flats);
      return { cls: isRoot ? 'root' : 'tone', label };
    }
  });
  if (anchorE > 4) chordFbHandle.scrollToFret(anchorE);

  document.getElementById('chPlay').addEventListener('click', () => {
    const tun = TUNING;
    const pos = [];
    for (let si = 0; si < tun.midi.length; si++)
      for (let f = 0; f <= 12; f++){
        const midi = tun.midi[si] + f;
        if (chordPcs.has(pc(midi))) pos.push({ si, f, midi });
      }
    pos.sort((a, b) => a.midi - b.midi || a.si - b.si);
    const rootStart = pos.find(p => pc(p.midi) === rp && p.f > 0) || pos[0];
    const seen = new Set(); const asc = [];
    for (const p of pos){
      if (p.midi >= rootStart.midi && p.midi <= rootStart.midi + 12 && !seen.has(p.midi)){
        seen.add(p.midi); asc.push(p);
      }
    }
    playSequence(chordFbHandle, asc.concat(asc.slice(0, -1).reverse()), 500);
  });
  document.getElementById('chStop').addEventListener('click', stopPlayback);

  bindSeg('chType', k => { S.chords.type = k; save(); renderChords(); });
  bindSeg('chRoot', k => { S.chords.root = k; save(); renderChords(); });
  bindSeg('chLabels', k => { S.chords.labels = k; save(); renderChords(); });
}

function containmentChain(ch, rp, flats){
  const isMinorFamily = ch.iv.includes(3) || ch.iv.length === 2;
  const isMajorFamily = ch.iv.includes(4);
  const chordPcs = new Set(ch.iv.map(i => (rp + i) % 12));
  const root = S.chords.root;
  function rowFor(scaleKey, label){
    const sc = SCALES[scaleKey];
    const ns = scaleNotes(root, sc.iv);
    return '<div style="margin:8px 0"><div class="small muted" style="margin-bottom:4px">' + label + '</div><div class="chips">' +
      ns.map((n, i) => {
        const p = (rp + sc.iv[i]) % 12;
        const inChord = chordPcs.has(p);
        const cls = p === rp ? 'chip root' : (inChord ? 'chip tone' : 'chip dim');
        return '<span class="' + cls + '">' + n + '<small>' + flatSign(sc.deg[i]) + '</small></span>';
      }).join('') + '</div></div>';
  }
  let h = '<div class="card"><b>Where these notes live</b>';
  h += '<p class="muted small" style="margin:4px 0 2px">Bright chips = chord tones. Faded chips = the other scale notes around them. Chord ⊂ pentatonic ⊂ full scale — smaller sets nest inside bigger ones.</p>';
  if (isMinorFamily && ch.iv.includes(3)){
    h += rowFor('minPent', '…inside ' + root + ' minor pentatonic:');
    h += rowFor('natMinor', '…inside ' + root + ' natural minor:');
  } else if (ch.iv.length === 2){
    h += rowFor('minPent', '…inside ' + root + ' minor pentatonic (fits the major side too):');
    h += rowFor('natMinor', '…inside ' + root + ' natural minor:');
  } else if (isMajorFamily && !ch.iv.includes(10)){
    h += rowFor('majPent', '…inside ' + root + ' major pentatonic:');
    h += rowFor('major', '…inside ' + root + ' major scale:');
  } else {
    h += rowFor('major', 'vs. the ' + root + ' major scale:');
    h += '<p class="small" style="margin:6px 0 0">The b7 pokes <b>outside</b> the plain major scale — that outside note is exactly the bluesy tension a dominant 7 is famous for.</p>';
  }
  h += '</div>';
  return h;
}
/* ================= METRONOME ================= */
const Metro = (() => {
  let running = false, bpm = 60, beat = 0, nextTime = 0, timer = null;
  function schedule(){
    const c = Audio_.ensure();
    while (nextTime < c.currentTime + 0.15){
      Audio_.click(beat % 4 === 0, nextTime - c.currentTime);
      const b = beat % 4, tt = nextTime;
      setTimeout(() => flash(b), Math.max(0, (tt - c.currentTime) * 1000));
      beat++; nextTime += 60 / bpm;
    }
  }
  function flash(b){
    document.querySelectorAll('.beatdots i').forEach((d, i) => d.classList.toggle('on', i === b));
    const dot = document.getElementById('mbDot');
    if (dot){ dot.classList.add('tick'); setTimeout(() => dot.classList.remove('tick'), 90); }
  }
  function start(){
    const c = Audio_.ensure();
    beat = 0; nextTime = c.currentTime + 0.1; running = true;
    clearInterval(timer); timer = setInterval(schedule, 30);
    ui();
  }
  function stop(){
    running = false; clearInterval(timer); timer = null;
    document.querySelectorAll('.beatdots i').forEach(d => d.classList.remove('on'));
    ui();
  }
  function setBpm(v){
    bpm = Math.max(40, Math.min(220, v));
    ui();
  }
  function ui(){
    const bar = document.getElementById('metrobar');
    bar.classList.toggle('on', running);
    document.body.classList.toggle('metro-on', running);
    document.getElementById('mbBpm').textContent = bpm + ' bpm';
    const big = document.getElementById('bpmBig');
    if (big) big.innerHTML = bpm + ' <small>bpm</small>';
    const sld = document.getElementById('bpmSlider');
    if (sld && +sld.value !== bpm) sld.value = bpm;
    const btn = document.getElementById('metStart');
    if (btn){
      btn.textContent = running ? '■ Stop' : '▶ Start';
      btn.classList.toggle('primary', !running);
    }
  }
  return { start, stop, setBpm, ui, get running(){ return running; }, get bpm(){ return bpm; } };
})();
document.getElementById('mbStop').addEventListener('click', () => Metro.stop());

function metronomeHtml(){
  return '<div class="card" id="metCard"><b>Metronome</b>' +
    '<div class="bpm-big" id="bpmBig">' + Metro.bpm + ' <small>bpm</small></div>' +
    '<div class="beatdots"><i></i><i></i><i></i><i></i></div>' +
    '<input type="range" id="bpmSlider" min="40" max="220" step="1" value="' + Metro.bpm + '">' +
    '<div class="row" style="justify-content:center">' +
    '<button class="btn" id="bpmM5">−5</button>' +
    '<button class="btn primary" id="metStart" style="min-width:110px">▶ Start</button>' +
    '<button class="btn" id="bpmP5">+5</button></div>' +
    '<p class="muted small" style="text-align:center; margin:8px 0 0">First beat of 4 is accented. It keeps running while you use other tabs.</p></div>';
}
function mountMetronome(){
  const sld = document.getElementById('bpmSlider');
  if (!sld) return;
  sld.addEventListener('input', () => Metro.setBpm(+sld.value));
  document.getElementById('bpmM5').addEventListener('click', () => Metro.setBpm(Metro.bpm - 5));
  document.getElementById('bpmP5').addEventListener('click', () => Metro.setBpm(Metro.bpm + 5));
  document.getElementById('metStart').addEventListener('click', () => Metro.running ? Metro.stop() : Metro.start());
  Metro.ui();
}

/* ================= BOOT ================= */
let rzTimer = null, lastWide = window.matchMedia('(min-width:1000px)').matches;

/** Wire this app up. The shell owns the nav and the hash; nothing here decides
    which tab opens first. */
function mount(){
  /* Unlock audio on first touch (mobile requirement). Scoped to this app's own
     tabs now that a Live mode's clicks land on the same body: only the
     metronome and the scale player use this context, and spinning a second
     AudioContext up alongside the Live half's analyser buys nothing but
     contention. Hence no {once:true} — the listener waits for a touch that
     actually belongs to a Learn tab. */
  const unlockAudio = () => {
    if (!currentTab) return;
    Audio_.ensure();
    document.body.removeEventListener('pointerdown', unlockAudio);
  };
  document.body.addEventListener('pointerdown', unlockAudio);

  window.addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      const nowWide = window.matchMedia('(min-width:1000px)').matches;
      if (nowWide !== lastWide){ lastWide = nowWide; if (currentTab) render(currentTab); }
    }, 200);
  });
}

/* ---------------- one-time clean-out ----------------
   Four screens were retired when the app was refocused on the game: the
   twelve-week practice plan, the Note quiz, Ear training and the pattern
   Drills. Their records are unreachable now — nothing renders a week log, a
   quiz accuracy or a drill's review date — so leaving them in localStorage
   would be leaving dead weight in the one place the player cannot see to
   clear. This runs once, keyed by its own flag, and is the only code in the
   app that deletes anything.

   The two charts' own settings moved to a NEW key rather than being migrated
   out of the old one, so this drops the old key whole. Songs and the game keep
   their own stores and are not touched. */
const WIPE_FLAG = 'bassTrainer.retired.v1';
const RETIRED_KEYS = [
  'bassTheoryTrainer.v1',   // practice log, checkpoints, quiz stats, chart prefs
  'bassTrainer.drills.v1'   // every drill's tempo, mastery and review date
];
function clearRetiredStores(){
  try {
    if (localStorage.getItem(WIPE_FLAG)) return;
    RETIRED_KEYS.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(WIPE_FLAG, '1');
  } catch(e){ /* a browser refusing storage has nothing to clear */ }
}
clearRetiredStores();

window.BassTheory = { mount, showTab: show };

/* ---- test seam ----
   trainer/test/*.js drive this app from page scope: they set a chart's options
   and force a re-render. Those were globals when this file was a <script> in
   the page; now that both apps share one document they cannot be, so the
   handful the suites hold on to is published here deliberately. An accessor,
   not a copy: S is REASSIGNED on every tab switch (it is re-read from the
   store), and a snapshot would hand the suite a state object that save() no
   longer writes. */
Object.defineProperty(window, 'S', { configurable:true, get:() => S, set:v => { S = v; } });
window.save = save;
})();
