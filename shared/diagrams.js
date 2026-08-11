/* ============================================================
   Drill illustrations — one small SVG per practice exercise.

   These replace paragraphs of prose ("one finger per fret
   (index-middle-ring-pinky)", "floating thumb") with something a
   beginner can copy at a glance. They use the same surface treatment
   and colour tokens as the full fretboard, so a drill and the board
   above it read as the same instrument.

   Colour grammar (fixed):
     amber = what you do          teal = the second thing in a pair
     --t3/--t4 = structure
   Green and red never appear: these are instructions, not verdicts.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassDiagrams = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const W = 328;                      // one card row wide, always
  const GAUGES = [4.6, 3.7, 3.0, 2.4, 1.9];
  let uid = 0;

  function el(name, attrs, text) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function canvas(h, title) {
    const s = el('svg', { class: 'drill', viewBox: '0 0 ' + W + ' ' + h, role: 'img' });
    s.appendChild(el('title', null, title));
    return s;
  }
  function label(svg, x, y, text, anchor) {
    svg.appendChild(el('text', { x, y, class: 'drill-label', 'text-anchor': anchor || 'middle' }, text));
  }
  /** A numbered finger puck — never a drawn hand. */
  function puck(svg, x, y, text, alt) {
    const g = el('g', { class: 'drill-puck' + (alt ? ' is-alt' : '') });
    g.appendChild(el('rect', { x: x - 10, y: y - 10, width: 20, height: 20, rx: 6 }));
    g.appendChild(el('text', { x, y, class: 'drill-puck-label' }, text));
    svg.appendChild(g);
    return g;
  }
  function arrow(svg, x1, y1, x2, y2, lift, dashed) {
    const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - lift;
    svg.appendChild(el('path', {
      d: 'M' + x1 + ' ' + y1 + 'Q' + mx + ' ' + my + ' ' + x2 + ' ' + y2,
      class: 'drill-arc' + (dashed ? ' is-dashed' : ''),
    }));
    const ang = Math.atan2(y2 - my, x2 - mx), a = 6;
    svg.appendChild(el('path', {
      d: 'M' + x2 + ' ' + y2 +
         'L' + (x2 - a * Math.cos(ang - 0.5)) + ' ' + (y2 - a * Math.sin(ang - 0.5)) +
         'L' + (x2 - a * Math.cos(ang + 0.5)) + ' ' + (y2 - a * Math.sin(ang + 0.5)) + 'Z',
      class: 'drill-head',
    }));
  }

  /**
   * A small stretch of fingerboard, drawn with the same treatment as the
   * full neck: wood, bone nut, lit fret wire, gauged strings.
   * @returns {{fretX, stringY, right, bottom}} helpers in canvas coordinates
   */
  function miniNeck(svg, o) {
    const x = o.x, y = o.y, rows = o.strings.length, row = o.row || 22;
    const openCol = 16, nut = 4, col = o.col || 30;
    const gauges = rows === 5 ? GAUGES : GAUGES.slice(GAUGES.length - rows);
    const id = 'dg' + (++uid);

    const defs = el('defs');
    const wood = el('linearGradient', { id: id + 'w', x1: '0', y1: '0', x2: '0', y2: '1' });
    [['0', 'var(--wood-hi)'], ['0.5', 'var(--wood)'], ['1', 'var(--wood-lo)']]
      .forEach(([o2, c]) => wood.appendChild(el('stop', { offset: o2, 'stop-color': c })));
    const wire = el('linearGradient', { id: id + 'r', x1: '0', y1: '0', x2: '1', y2: '0' });
    [['0', 'var(--wire-hi)'], ['0.45', 'var(--wire)'], ['1', 'var(--wire-lo)']]
      .forEach(([o2, c]) => wire.appendChild(el('stop', { offset: o2, 'stop-color': c })));
    defs.appendChild(wood); defs.appendChild(wire);
    svg.appendChild(defs);

    const stringY = (i) => y + (rows - 1 - i) * row;      // i = 0 is the lowest
    const top = stringY(rows - 1) - row * 0.55;
    const bot = stringY(0) + row * 0.55;
    const boardX = x + openCol + nut;
    const right = boardX + o.frets * col;

    svg.appendChild(el('rect', { x, y: top, width: openCol, height: bot - top, rx: 2, fill: 'var(--s2)' }));
    svg.appendChild(el('rect', { x: boardX, y: top, width: right - boardX, height: bot - top, fill: 'url(#' + id + 'w)' }));
    svg.appendChild(el('line', { x1: boardX, y1: top, x2: right, y2: top, stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1 }));
    svg.appendChild(el('line', { x1: boardX, y1: bot, x2: right, y2: bot, stroke: 'rgba(0,0,0,.55)', 'stroke-width': 1 }));
    svg.appendChild(el('rect', { x: x + openCol, y: top - 1, width: nut, height: bot - top + 2, rx: 1, fill: 'var(--nut)' }));
    for (let f = 1; f <= o.frets; f++) {
      svg.appendChild(el('rect', { x: boardX + f * col - 1, y: top, width: 2, height: bot - top, fill: 'url(#' + id + 'r)' }));
    }
    for (let i = 0; i < rows; i++) {
      const sy = stringY(i);
      svg.appendChild(el('line', {
        x1: x, y1: sy, x2: right, y2: sy,
        stroke: (o.muted || []).indexOf(i) >= 0 ? 'rgba(110,107,100,.35)' : 'var(--string)',
        'stroke-width': gauges[i] * 0.62,
        'stroke-dasharray': (o.muted || []).indexOf(i) >= 0 ? '3 4' : null,
        'stroke-linecap': 'round',
      }));
      if (o.labels !== false) {
        svg.appendChild(el('text', {
          x: x - 5, y: sy, class: 'drill-strlabel' + (i === 0 && rows === 5 ? ' is-lowest' : ''),
        }, o.strings[i]));
      }
    }
    return {
      fretX: (f) => f === 0 ? x + openCol / 2 : boardX + (f - 0.5) * col,
      stringY, right, bottom: bot, top,
    };
  }

  /* ---------------- 1 · chromatic 1-2-3-4 ---------------- */
  function chromatic(host, strings) {
    const H = 96;
    const svg = canvas(H, 'Play frets 1, 2, 3, 4 on one string using index, middle, ring then pinky — one finger per fret. Then start again on the next string up.');
    const two = [strings[0], strings[1]];
    const n = miniNeck(svg, { x: 18, y: 30, strings: two, frets: 4, row: 26, col: 30 });
    for (let f = 1; f <= 4; f++) puck(svg, n.fretX(f), n.stringY(0), String(f), false);
    arrow(svg, n.fretX(4) + 12, n.stringY(0) - 12, n.fretX(1), n.stringY(1) - 12, 16, true);
    label(svg, n.right + 12, n.stringY(1) - 2, 'THEN THE', 'start');
    label(svg, n.right + 12, n.stringY(1) + 11, 'NEXT STRING', 'start');
    label(svg, 18, H - 8, '1 = INDEX · 2 = MIDDLE · 3 = RING · 4 = PINKY', 'start');
    host.innerHTML = ''; host.appendChild(svg);
  }

  /* ---------------- 2 · alternating i–m plucking ---------------- */
  function plucking(host) {
    const H = 92;
    const svg = canvas(H, 'Alternate your plucking fingers: index, middle, index, middle. One note per click, never the same finger twice in a row.');
    const y = 42, x0 = 34, gap = 62;
    svg.appendChild(el('line', { x1: x0 - 14, y1: y, x2: x0 + gap * 3 + 14, y2: y, class: 'drill-rail' }));
    ['i', 'm', 'i', 'm'].forEach((f, i) => {
      const x = x0 + gap * i;
      svg.appendChild(el('line', { x1: x, y1: y - 7, x2: x, y2: y + 7, class: 'drill-tick is-strong' }));
      puck(svg, x, y - 22, f, i % 2 === 1);
      label(svg, x, y + 20, 'CLICK ' + (i + 1));
      if (i < 3) arrow(svg, x + 12, y - 22, x + gap - 12, y - 22, 12, false);
    });
    label(svg, x0 - 20, H - 8, 'i = INDEX · m = MIDDLE · ALWAYS ALTERNATE', 'start');
    host.innerHTML = ''; host.appendChild(svg);
  }

  /* ---------------- 3 · floating-thumb muting ---------------- */
  function floatingThumb(host, strings) {
    const H = 112;
    const low = strings[0], play = strings[1];
    const svg = canvas(H, 'Rest your plucking thumb on the ' + low + ' string so it cannot ring, and pluck the ' +
      play + ' string above it with alternating index and middle fingers.');
    const n = miniNeck(svg, { x: 22, y: 24, strings, frets: 2, row: 19, col: 26, muted: [0] });
    const yMute = n.stringY(0), yPlay = n.stringY(1);

    // the muted string is marked on the string itself
    svg.appendChild(el('text', { x: n.fretX(1), y: yMute, class: 'drill-x' }, '✕'));

    const ax = n.right + 14;
    // row aligned with the string you pluck
    puck(svg, ax + 10, yPlay, 'i', false);
    puck(svg, ax + 34, yPlay, 'm', true);
    label(svg, ax + 50, yPlay + 1, 'PLUCK THE ' + play, 'start');
    // row aligned with the string the thumb kills
    svg.appendChild(el('rect', { x: ax, y: yMute - 8, width: 46, height: 16, rx: 8, class: 'drill-thumb' }));
    svg.appendChild(el('text', { x: ax + 23, y: yMute, class: 'drill-thumb-label' }, 'THUMB'));
    label(svg, ax + 52, yMute + 1, 'MUTES THE ' + low, 'start');

    host.innerHTML = ''; host.appendChild(svg);
  }

  /* ---------------- 4 · eighth notes ---------------- */
  function eighthNotes(host) {
    const H = 104;
    const svg = canvas(H, 'Two notes per click. Count one-and-two-and: the numbers land on the click, the "and" falls exactly between two clicks.');
    const y = 56, x0 = 44, step = 34;
    svg.appendChild(el('path', { d: 'M14 70 L22 38 L30 70 Z', class: 'drill-metro' }));
    svg.appendChild(el('line', { x1: 22, y1: 66, x2: 29, y2: 44, class: 'drill-metro-arm' }));
    svg.appendChild(el('line', { x1: x0 - 10, y1: y, x2: x0 + step * 7 + 10, y2: y, class: 'drill-rail' }));
    ['1', '&', '2', '&', '3', '&', '4', '&'].forEach((name, i) => {
      const x = x0 + step * i, onBeat = i % 2 === 0;
      svg.appendChild(el('line', {
        x1: x, y1: y - (onBeat ? 10 : 5), x2: x, y2: y + (onBeat ? 10 : 5),
        class: 'drill-tick' + (onBeat ? ' is-strong' : ''),
      }));
      svg.appendChild(el('circle', { cx: x, cy: y - 20, r: 5, class: 'drill-note' + (onBeat ? '' : ' is-alt') }));
      svg.appendChild(el('line', { x1: x + 4.6, y1: y - 22, x2: x + 4.6, y2: y - 36, class: 'drill-stem' + (onBeat ? '' : ' is-alt') }));
      if (onBeat) svg.appendChild(el('line', { x1: x + 4.6, y1: y - 35, x2: x + step + 4.6, y2: y - 35, class: 'drill-beam' }));
      label(svg, x, y + 22, name);
    });
    label(svg, 14, H - 6, 'TWO NOTES PER CLICK · EVEN AND STEADY', 'start');
    host.innerHTML = ''; host.appendChild(svg);
  }

  /* ---------------- 5 · TNT roots E → A → G ---------------- */
  function tntRoots(host, strings) {
    const H = 128;
    const svg = canvas(H, 'The three roots of T.N.T.: open E, open A, and G on the E string at fret 3. Play eight even notes on each before moving on.');
    const eIdx = Math.max(0, strings.indexOf('E')), aIdx = Math.max(1, strings.indexOf('A'));
    const two = [strings[eIdx], strings[aIdx]];
    const n = miniNeck(svg, { x: 18, y: 26, strings: two, frets: 3, row: 24, col: 30 });
    [[0, 0, 'E'], [1, 0, 'A'], [0, 3, 'G']].forEach(([si, fret, name]) => {
      const cx = n.fretX(fret), cy = n.stringY(si);
      const g = el('g', { class: 'drill-rootdot' });
      g.appendChild(el('circle', { cx, cy, r: 11 }));
      g.appendChild(el('text', { x: cx, y: cy, class: 'drill-rootdot-label' }, name));
      svg.appendChild(g);
    });
    label(svg, n.right + 12, n.stringY(1) + 2, 'THE SONG’S', 'start');
    label(svg, n.right + 12, n.stringY(1) + 15, 'THREE ROOTS', 'start');

    const stripY = 104;
    let x = 20;
    ['E', 'A', 'G'].forEach((name, gi) => {
      for (let i = 0; i < 8; i++) {
        svg.appendChild(el('rect', {
          x: x + i * 9, y: stripY - 7, width: 6, height: 14, rx: 2,
          class: 'drill-slot' + (i % 2 === 0 ? ' is-strong' : ''),
        }));
      }
      label(svg, x + 36, stripY + 17, name + ' × 8');
      x += 8 * 9 + 22;
      if (gi < 2) svg.appendChild(el('text', { x: x - 13, y: stripY, class: 'drill-arrowtext' }, '→'));
    });
    host.innerHTML = ''; host.appendChild(svg);
  }

  const MAP = { chromatic, plucking, floatingThumb, eighthNotes, tntRoots };

  /** Draw diagram `name` into `host`. Unknown or failing names leave the host
      empty, so a drill always still shows its text. */
  function draw(name, host, strings) {
    const fn = MAP[name];
    if (!fn || !host) return false;
    try { fn(host, strings && strings.length ? strings : ['B', 'E', 'A', 'D', 'G']); return true; }
    catch (e) { host.innerHTML = ''; return false; }
  }

  return { draw, names: Object.keys(MAP) };
});
