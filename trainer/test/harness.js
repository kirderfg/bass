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

/** Write a looping WAV of a plucked bass tone (weak fundamental, like the real thing). */
function writeNoteWav(hz, file, seconds = 3, rate = 44100) {
  const n = Math.floor(seconds * rate);
  const data = Buffer.alloc(n * 2);
  const partials = [[1, 0.25], [2, 0.6], [3, 0.35], [4, 0.2], [5, 0.1]];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (const [mult, amp] of partials) v += amp * Math.sin(2 * Math.PI * hz * mult * t);
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((v / 1.5) * 22000))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
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
 * @returns {{page, errors, gum, goto, close}} gum() counts getUserMedia calls.
 */
async function openApp(hz, url = '/index.html') {
  const { chromium } = require(PW);
  const { server, port } = await startServer();
  const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'basswav-')), 'note.wav');
  writeNoteWav(hz, wav);

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
    viewport: { width: 380, height: 800 },
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
async function openWithNote(hz) {
  const app = await openApp(hz, '/index.html#tuner');
  await app.page.click('#startBtn');
  await app.page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
  return app;
}

/** Poll until `fn` (run in the page) returns a truthy value, or time out. */
async function until(page, fn, arg, timeout = 6000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await new Promise(r => setTimeout(r, 80));
  }
  return last;
}

module.exports = { openApp, openWithNote, until, writeNoteWav };
