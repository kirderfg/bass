/* Integration-test harness: serves the app over localhost (getUserMedia needs a
   secure context) and launches Chromium with a synthesized bass note wired
   into the microphone, so tests can "play" notes at the app. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');   // repo root: matches the deploy
const PW = '/opt/node22/lib/node_modules/playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** A plucked bass tone: weak fundamental and strong partials, like the real thing. */
const PARTIALS = [[1, 0.25], [2, 0.6], [3, 0.35], [4, 0.2], [5, 0.1]];

function wavHeader(dataLength, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataLength, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(dataLength, 40);
  return h;
}

/**
 * Write a looping WAV of one plucked bass tone.
 *
 * The tone stops half a second before the end of the file by default, so
 * every loop of the fake device is a RELEASE followed by a genuine re-attack —
 * matching how the app now judges: a note that was already ringing when a
 * question arrived is never an answer, only a fresh attack is.
 *
 * `opts.toneSeconds` overrides where the tone stops (e.g. the full length for
 * a note that must ring without ever re-attacking); `opts.leadSeconds`
 * prepends silence, for tests that need the ONE attack to land after their
 * own setup has finished.
 */
function writeNoteWav(hz, file, seconds = 3, rate = 44100, opts) {
  const lead = Math.max(0, (opts && opts.leadSeconds) || 0);
  const toneSeconds = (opts && opts.toneSeconds != null)
    ? opts.toneSeconds : Math.max(0.5, seconds - 0.5);
  const n = Math.floor(seconds * rate);
  const leadN = Math.floor(lead * rate);
  const toneEnd = Math.min(n, leadN + Math.floor(toneSeconds * rate));
  const data = Buffer.alloc(n * 2);
  for (let i = leadN; i < toneEnd; i++) {
    const t = (i - leadN) / rate;
    let v = 0;
    for (const [mult, amp] of PARTIALS) v += amp * Math.sin(2 * Math.PI * hz * mult * t);
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((v / 1.5) * 22000))), i * 2);
  }
  fs.writeFileSync(file, Buffer.concat([wavHeader(data.length, rate), data]));
  return file;
}

/**
 * Write a WAV of several tones back to back, each followed by silence.
 *
 * Chromium's fake device takes ONE file, so a test that needs the app to hear
 * more than one pitch in a single page load has to put them in the file. The
 * silence matters: it is what lets the tracker release between notes, so five
 * open strings read as five separate notes rather than one long smear.
 */
function writeSequenceWav(hzList, file, secondsEach = 2.4, rate = 44100) {
  const per = Math.floor(secondsEach * rate);
  const quiet = Math.floor(rate * 0.5);
  const data = Buffer.alloc(hzList.length * per * 2);
  let o = 0;
  for (const hz of hzList) {
    for (let i = 0; i < per; i++) {
      const t = i / rate;
      let v = 0;
      for (const [mult, amp] of PARTIALS) v += amp * Math.sin(2 * Math.PI * hz * mult * t);
      const gate = i > per - quiet ? 0 : 1;
      data.writeInt16LE(Math.max(-32767, Math.min(32767,
        Math.round((v / 1.5) * 22000 * gate))), o);
      o += 2;
    }
  }
  fs.writeFileSync(file, Buffer.concat([wavHeader(data.length, rate), data]));
  return file;
}

/**
 * Open the app with `hz` playing continuously into the microphone and stop
 * there: nothing is clicked, so the mic has NOT been granted. Tests about the
 * gate itself — and about the promise that the practice plan never asks for a
 * microphone — need to see the app in that state.
 *
 * `url` is served from the repo root, so it can be '/index.html#drill' or
 * '/trainer/index.html#drill' (which redirects).
 *
 * Pass an ARRAY for `hz` to play those pitches in turn instead of one held note
 * — the tuner, for instance, has to hear five different strings to finish.
 *
 * `viewport` widens the window for tests about the desktop layout.
 *
 * `wavOpts` shapes the single-tone file: {seconds, toneSeconds, leadSeconds}
 * (see writeNoteWav) — e.g. one attack that rings for 15s and never repeats.
 *
 * @returns {{page, errors, gum, goto, close}} gum() counts getUserMedia calls.
 */
async function openApp(hz, url = '/index.html', viewport, wavOpts) {
  const { chromium } = require(PW);
  const { server, port } = await startServer();
  const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'basswav-')), 'note.wav');
  if (Array.isArray(hz)) writeSequenceWav(hz, wav);
  else writeNoteWav(hz, wav, (wavOpts && wavOpts.seconds) || 3, 44100, wavOpts);

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=' + wav,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: viewport || { width: 380, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // Permission is pre-granted here, so nothing prompts: the only way to prove
  // the mic was left alone is to count the calls.
  await page.addInitScript(() => {
    window.__gum = 0;
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (...a) => { window.__gum++; return orig(...a); };
    }
  });
  const base = `http://127.0.0.1:${port}`;
  await page.goto(base + url);

  return {
    page,
    errors,
    gum: () => page.evaluate(() => window.__gum),
    goto: rel => page.goto(base + rel),
    async close() {
      await browser.close();
      await new Promise(r => server.close(r));
    },
  };
}

/**
 * Open the Live tabs with `hz` playing continuously into the microphone.
 * The two apps are one page now, so this lands on the Tuner via its hash and
 * arms the mic from the gate that mode shows.
 * @returns {{page, close}} page is already past the mic gate and listening.
 */
async function openWithNote(hz, wavOpts) {
  const app = await openApp(hz, '/index.html#tuner', undefined, wavOpts);
  await app.page.click('#startBtn');
  await app.page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
  return app;
}

/** Poll until `fn` (run in the page) returns a truthy value, or time out.
    The default allows for the looping WAV's re-attack cadence: the app judges
    only fresh attacks now, so the first verdict can be a loop away. */
async function until(page, fn, arg, timeout = 10000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await new Promise(r => setTimeout(r, 80));
  }
  return last;
}

module.exports = { openApp, openWithNote, until, writeNoteWav, writeSequenceWav };
