/* ============================================================
   Shared bass-neck renderer — used by both apps, verbatim.
   Draws an SVG fingerboard that reads as an instrument rather than
   a table. All colour comes from CSS custom properties (see
   shared/theme.css), so restyling never touches this file.

   Loads in the browser as `BassNeck`; require()-able in Node so the
   geometry can be unit-tested.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassNeck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Two shipping sizes: `play` for anything tappable (44px+ targets),
     `read` for hint boards. `micro` exists only inside drill diagrams. */
  const SCALES = {
    play:  { openCol:44, nut:7, col:46, row:46, dot:11.5, inlay:5.5, fretNum:20, label:13,   gaugeMul:1,    finger:true  },
    read:  { openCol:26, nut:5, col:34, row:30, dot:9, inlay:4.0, fretNum:16, label:10.5, gaugeMul:0.68, finger:false },
    micro: { openCol:18, nut:4, col:26, row:22, dot:7.5, inlay:3.0, fretNum:13, label:9,   gaugeMul:0.5,  finger:false },
  };
  // Relative gauges of a real 5-string set (.130 → .045). The low B has to
  // look like the low B; this is the detail that sells the instrument.
  const GAUGES_5 = [4.6, 3.7, 3.0, 2.4, 1.9];
  const INLAY_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];
  const DOUBLE_INLAY_FRETS = [12, 24];
  // String pitch at the nut vs at the last drawn fret: the neck splays.
  const TAPER_NUT = 0.93, TAPER_END = 1.0;

  function geometry(opts) {
    const S = SCALES[opts.scale || 'play'];
    const fromFret = opts.fromFret || 0;
    const toFret = opts.toFret != null ? opts.toFret : 12;
    const nStrings = opts.strings || 5;
    const showNumbers = opts.showFretNumbers !== false;

    const padT = Math.round(S.row * 0.18) + (opts.window ? 16 : 0);
    const padB = padT;

    const frets = [];
    let x = 0;
    if (fromFret === 0) {
      frets.push({ n: 0, x: 0, width: S.openCol, center: S.openCol / 2, open: true });
      x = S.openCol + S.nut;
    }
    for (let n = Math.max(1, fromFret); n <= toFret; n++) {
      frets.push({ n, x, width: S.col, center: x + S.col / 2 });
      x += S.col;
    }

    const boardStart = fromFret === 0 ? S.openCol : 0;
    const boardEnd = x;
    const centerY = padT + (nStrings - 1) * S.row / 2;

    /** Vertical string spacing at a given x — this is the taper. */
    function pitchAt(px) {
      const span = boardEnd - boardStart;
      const t = span > 0 ? Math.min(1, Math.max(0, (px - boardStart) / span)) : 0;
      return S.row * (TAPER_NUT + (TAPER_END - TAPER_NUT) * t);
    }
    /** y of string `i` (0 = lowest) at horizontal position `px`. */
    function stringY(i, px) {
      const fromTop = nStrings - 1 - i;
      return centerY + (fromTop - (nStrings - 1) / 2) * pitchAt(px);
    }

    const gauges = (nStrings === 5 ? GAUGES_5 : GAUGES_5.slice(1));
    const strings = [];
    for (let i = 0; i < nStrings; i++) {
      strings.push({
        i,
        gauge: +(gauges[gauges.length - 1 - (nStrings - 1 - i)] * S.gaugeMul).toFixed(4),
        y0: stringY(i, boardStart),
        y1: stringY(i, boardEnd),
      });
    }

    const inRange = (f) => f >= Math.max(1, fromFret) && f <= toFret;
    const inlays = INLAY_FRETS.filter(inRange).map(f => ({ fret: f, double: false }))
      .concat(DOUBLE_INLAY_FRETS.filter(inRange).map(f => ({ fret: f, double: true })))
      .sort((a, b) => a.fret - b.fret);

    return {
      S, width: boardEnd,
      height: padT + (nStrings - 1) * S.row + padB + (showNumbers ? S.fretNum : 0),
      boardHeight: padT + (nStrings - 1) * S.row + padB,
      frets, strings, inlays, stringY, pitchAt,
      boardStart, boardEnd, centerY, padT, nStrings, fromFret, toFret, showNumbers,
    };
  }

  /** Overlapping fret windows, so a long neck can be paged instead of scrolled. */
  function windows(toFret, size) {
    const span = size || 5;
    if (toFret <= span) return [[0, toFret]];
    const out = [];
    let lo = 0;
    while (lo + span < toFret) {
      out.push([lo, lo + span]);
      lo += span - 1;                      // overlap by one fret for continuity
    }
    out.push([Math.max(0, toFret - span), toFret]);
    return out;
  }

  /* ------------------------------------------------------------------ */
  const NS = 'http://www.w3.org/2000/svg';
  let uidSeq = 0;
  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function grad(id, stops, horizontal) {
    const g = el('linearGradient', horizontal
      ? { id, x1: '0', y1: '0', x2: '1', y2: '0' }
      : { id, x1: '0', y1: '0', x2: '0', y2: '1' });
    for (const [offset, color] of stops) g.appendChild(el('stop', { offset, 'stop-color': color }));
    return g;
  }

  /**
   * Render a neck into `host`.
   *
   * opts: strings (['B','E','A','D','G'] low→high), fromFret, toFret,
   *       scale ('play'|'read'|'micro'), markers [{si,fret,kind,label,finger}],
   *       window [lo,hi], windowLabel, dimStrings [si], onTap(si,fret),
   *       scrollToFret, animate
   * marker kinds: root | tone | highlight | ghost | correct | wrong | asked
   */
  function render(host, opts) {
    const names = opts.strings;
    const g = geometry({
      fromFret: opts.fromFret, toFret: opts.toFret, strings: names.length,
      scale: opts.scale, showFretNumbers: opts.showFretNumbers, window: opts.window,
    });
    const S = g.S;
    const uid = 'nk' + (++uidSeq);
    const dim = opts.dimStrings || [];

    host.innerHTML = '';
    host.classList.add('neck');

    /* String names live OUTSIDE the scroll container, so the board can never
       cover them (a bug we shipped once already). */
    const labels = document.createElement('div');
    labels.className = 'neck-labels';
    for (let i = names.length - 1; i >= 0; i--) {
      const l = document.createElement('span');
      l.className = 'neck-label' + (i === 0 ? ' is-lowest' : '') +
                    (dim.indexOf(i) >= 0 ? ' is-dim' : '');
      l.style.position = 'absolute';
      l.textContent = names[i];
      labels.appendChild(l);
    }
    labels.style.position = 'relative';
    labels.style.width = (S.label + 6) + 'px';
    labels.style.height = g.height + 'px';
    Array.prototype.forEach.call(labels.children, (l, idx) => {
      const i = names.length - 1 - idx;
      l.style.top = (g.stringY(i, g.boardStart) - 9) + 'px';
      l.style.right = '7px';
      l.style.fontSize = (S.label) + 'px';
    });

    const scroll = document.createElement('div');
    scroll.className = 'neck-scroll';
    const svg = el('svg', {
      class: 'neck-svg', width: g.width, height: g.height,
      viewBox: '0 0 ' + g.width + ' ' + g.height, role: 'img',
    });
    if (opts.title) {
      const t = el('title'); t.textContent = opts.title; svg.appendChild(t);
    }

    const defs = el('defs');
    defs.appendChild(grad(uid + 'wood', [['0', 'var(--wood-hi)'], ['0.5', 'var(--wood)'], ['1', 'var(--wood-lo)']]));
    defs.appendChild(grad(uid + 'wire', [['0', 'var(--wire-hi)'], ['0.45', 'var(--wire)'], ['1', 'var(--wire-lo)']], true));
    defs.appendChild(grad(uid + 'rootg', [['0', '#FFC163'], ['1', '#E8952B']]));
    svg.appendChild(defs);

    /* ---- open-string column: --s2, not wood. This is what makes the nut
       read as the END of the neck rather than a divider inside it. ---- */
    const edgeTop = (px) => g.stringY(g.nStrings - 1, px) - S.row * 0.6;
    const edgeBot = (px) => g.stringY(0, px) + S.row * 0.6;

    if (g.fromFret === 0) {
      svg.appendChild(el('rect', {
        x: 0, y: edgeTop(0), width: S.openCol,
        height: edgeBot(0) - edgeTop(0), rx: 3, fill: 'var(--s2)',
      }));
    }

    /* ---- fingerboard: a trapezoid, because the neck splays ---- */
    const bs = g.boardStart + (g.fromFret === 0 ? S.nut : 0);
    const be = g.boardEnd;
    svg.appendChild(el('path', {
      d: 'M' + bs + ' ' + edgeTop(bs) + 'L' + be + ' ' + edgeTop(be) +
         'L' + be + ' ' + edgeBot(be) + 'L' + bs + ' ' + edgeBot(bs) + 'Z',
      fill: 'url(#' + uid + 'wood)',
    }));
    // grain: a few straight lines at irregular positions — never a texture
    // dense enough to shimmer while scrolling
    [0.18, 0.34, 0.52, 0.71, 0.86].forEach((f, k) => {
      const y0 = edgeTop(bs) + (edgeBot(bs) - edgeTop(bs)) * f;
      const y1 = edgeTop(be) + (edgeBot(be) - edgeTop(be)) * f;
      svg.appendChild(el('line', {
        x1: bs, y1: y0, x2: be, y2: y1,
        stroke: k === 2 ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,' + (0.022 + (k % 3) * 0.008) + ')',
        'stroke-width': 1,
      }));
    });
    // lit top edge / shaded bottom edge: the board becomes a solid object
    svg.appendChild(el('line', { x1: bs, y1: edgeTop(bs), x2: be, y2: edgeTop(be), stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1 }));
    svg.appendChild(el('line', { x1: bs, y1: edgeBot(bs), x2: be, y2: edgeBot(be), stroke: 'rgba(0,0,0,.55)', 'stroke-width': 1 }));

    /* ---- inlays: on the board, under the strings ---- */
    for (const inlay of g.inlays) {
      const f = g.frets.find(fr => fr.n === inlay.fret);
      if (!f) continue;
      const top = edgeTop(f.center), bot = edgeBot(f.center);
      const ys = inlay.double
        ? [top + (bot - top) * 0.16, top + (bot - top) * 0.84]
        // With an odd string count the centre line is a string, so sit the
        // dot in the gap below it rather than under the string itself.
        : [(top + bot) / 2 + (g.nStrings % 2 ? g.pitchAt(f.center) * 0.5 : 0)];
      void 0;
      for (const cy of ys) {
        svg.appendChild(el('circle', { cx: f.center, cy, r: S.inlay, class: 'neck-inlay' }));
      }
    }

    /* ---- fret wire: a lit cylinder, following the taper ---- */
    const wireW = S.col >= 40 ? 3 : 2;
    for (const f of g.frets) {
      if (f.open) continue;
      const wx = f.x + f.width;                  // wire sits at the fret's far edge
      svg.appendChild(el('rect', {
        x: wx - wireW / 2, y: edgeTop(wx), width: wireW,
        height: edgeBot(wx) - edgeTop(wx), fill: 'url(#' + uid + 'wire)',
      }));
    }
    if (g.fromFret === 0) {
      const nx = S.openCol;
      svg.appendChild(el('rect', {
        x: nx, y: edgeTop(nx) - 2, width: S.nut,
        height: (edgeBot(nx) - edgeTop(nx)) + 4, rx: 1.5, class: 'neck-nut',
      }));
      svg.appendChild(el('rect', {
        x: nx + S.nut, y: edgeTop(nx) - 2, width: 1,
        height: (edgeBot(nx) - edgeTop(nx)) + 4, fill: 'rgba(0,0,0,.5)',
      }));
    }

    /* ---- the moveable box: framed like a viewfinder ---- */
    if (opts.window) {
      const lo = g.frets.find(f => f.n === opts.window[0]);
      const hi = g.frets.find(f => f.n === opts.window[1]);
      if (lo && hi) {
        const wx0 = lo.x, wx1 = hi.x + hi.width;
        // shade the board OUTSIDE the window; contents inside keep true colour
        if (wx0 > 0) svg.appendChild(el('rect', { x: 0, y: 0, width: wx0, height: g.boardHeight, class: 'neck-shade' }));
        if (wx1 < g.width) svg.appendChild(el('rect', { x: wx1, y: 0, width: g.width - wx1, height: g.boardHeight, class: 'neck-shade' }));
        const wy0 = edgeTop(wx0) - 3, wy1 = edgeBot(wx1) + 3;
        svg.appendChild(el('rect', { x: wx0, y: wy0, width: wx1 - wx0, height: wy1 - wy0, rx: 10, class: 'neck-window' }));
        const B = 11;
        [[wx0, wy0, 1, 1], [wx1, wy0, -1, 1], [wx0, wy1, 1, -1], [wx1, wy1, -1, -1]].forEach(([cx, cy, sx, sy]) => {
          svg.appendChild(el('path', {
            d: 'M' + (cx + sx * B) + ' ' + cy + 'L' + cx + ' ' + cy + 'L' + cx + ' ' + (cy + sy * B),
            class: 'neck-bracket',
          }));
        });
        if (opts.windowLabel !== false) {
          const label = 'BOX · FRET ' + opts.window[0];
          const pw = label.length * 6.2 + 14;
          svg.appendChild(el('rect', { x: wx0 + 4, y: Math.max(0, wy0 - 15), width: pw, height: 15, rx: 7.5, class: 'neck-window-pill' }));
          const t = el('text', { x: wx0 + 4 + pw / 2, y: Math.max(0, wy0 - 15) + 8, class: 'neck-window-pill-label' });
          t.textContent = label;
          svg.appendChild(t);
        }
      }
    }

    /* ---- strings: gauged, with a wound-metal sheen ---- */
    for (const s of g.strings) {
      const muted = dim.indexOf(s.i) >= 0;
      const x0 = g.fromFret === 0 ? 0 : g.boardStart;
      svg.appendChild(el('line', {
        x1: x0, y1: g.stringY(s.i, x0), x2: g.boardEnd, y2: g.stringY(s.i, g.boardEnd),
        stroke: muted ? 'rgba(110,107,100,.35)' : 'var(--string)',
        'stroke-width': s.gauge, 'stroke-dasharray': muted ? '3 4' : null,
        'stroke-linecap': 'round',
      }));
      if (!muted) {
        const off = s.gauge / 2 - 0.6;
        svg.appendChild(el('line', {
          x1: x0, y1: g.stringY(s.i, x0) - off, x2: g.boardEnd, y2: g.stringY(s.i, g.boardEnd) - off,
          stroke: 'rgba(255,255,255,.30)', 'stroke-width': 1,
          'stroke-dasharray': s.gauge > 3.2 ? '1 2' : null,
          opacity: s.gauge > 3.2 ? 0.55 : 1,
        }));
      }
    }

    /* ---- tap targets ---- */
    if (opts.onTap) {
      for (const s of g.strings) {
        if (dim.indexOf(s.i) >= 0) continue;
        for (const f of g.frets) {
          const cy = g.stringY(s.i, f.center);
          const hit = el('rect', {
            x: f.x, y: cy - S.row / 2, width: f.width, height: S.row,
            class: 'neck-hit' + (f.open ? '' : ' neck-snap'),
            'data-s': s.i, 'data-f': f.n, tabindex: '0', role: 'button',
            'aria-label': names[s.i] + ' string, fret ' + f.n,
          });
          const fire = () => opts.onTap(s.i, f.n);
          hit.addEventListener('click', fire);
          hit.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
          });
          svg.appendChild(hit);
        }
      }
    }

    /* ---- note markers ---- */
    (opts.markers || []).forEach((m, idx) => {
      const f = g.frets.find(fr => fr.n === m.fret);
      if (!f || m.si == null || m.si >= g.nStrings) return;
      const cy = g.stringY(m.si, f.center);
      const kind = m.kind || 'tone';
      const outside = opts.window && (m.fret < opts.window[0] || m.fret > opts.window[1]);
      const drawKind = outside ? 'ghost' : kind;
      const grp = el('g', {
        class: 'neck-marker is-' + drawKind + (outside ? ' is-outside' : '') +
               (opts.animate && idx < 12 ? ' animate-in' : ''),
        'data-s': m.si, 'data-f': m.fret,
      });
      if (opts.animate && idx < 12) grp.style.animationDelay = (idx * 20) + 'ms';

      if (drawKind === 'highlight') grp.appendChild(el('circle', { cx: f.center, cy, r: S.dot + 4, class: 'neck-halo' }));
      grp.appendChild(el('circle', {
        cx: f.center, cy, r: S.dot, class: 'neck-dot',
        fill: drawKind === 'root' ? 'url(#' + uid + 'rootg)' : null,
      }));
      if (drawKind === 'root') grp.appendChild(el('circle', { cx: f.center, cy, r: S.dot - 4.5, class: 'neck-ring' }));
      if (m.label != null) {
        const txt = String(m.label).replace(/^b(?=[0-9])/, '\u266d');   // b3 -> ♭3
        const t = el('text', {
          x: f.center, y: cy, class: 'neck-dot-label',
          'font-size': txt.length > 1 ? S.label * 0.78 : S.label,
        });
        t.textContent = txt;
        grp.appendChild(t);
      }
      if (drawKind === 'correct' || drawKind === 'wrong') {
        const bx = f.center + S.dot * 0.95, by = cy - S.dot * 0.95;
        grp.appendChild(el('circle', { cx: bx, cy: by, r: 6.5, class: 'neck-badge-bg' }));
        const b = el('text', { x: bx, y: by, class: 'neck-badge' });
        b.textContent = drawKind === 'correct' ? '✓' : '✕';
        grp.appendChild(b);
      }
      // An illegible fingering badge is worse than none, so small boards drop it.
      if (m.finger && S.finger) {
        grp.appendChild(el('circle', { cx: f.center + 9, cy: cy + 9, r: 6.5, class: 'neck-finger-bg' }));
        const ft = el('text', { x: f.center + 9, y: cy + 9, class: 'neck-finger' });
        ft.textContent = m.finger;
        grp.appendChild(ft);
      }
      svg.appendChild(grp);
    });

    /* ---- fret numbers: weight, not dots, marks the navigation frets ---- */
    if (g.showNumbers) {
      const y = g.boardHeight + S.fretNum * 0.55;
      for (const f of g.frets) {
        const marked = INLAY_FRETS.indexOf(f.n) >= 0 || DOUBLE_INLAY_FRETS.indexOf(f.n) >= 0;
        const t = el('text', {
          x: f.center, y, class: 'neck-fretnum' + (marked ? ' is-marked' : ''),
          'font-size': S.fretNum * 0.55,
        });
        t.textContent = f.n;
        svg.appendChild(t);
      }
    }

    if (opts.bare) {
      host.appendChild(svg);
    } else {
      scroll.appendChild(svg);
      host.appendChild(labels);
      host.appendChild(scroll);
    }

    // Only mask/scroll-hint when the board genuinely overflows.
    if (!opts.bare) requestAnimationFrame(() => {
      if (svg.getBoundingClientRect().width > scroll.clientWidth + 2) {
        scroll.classList.add('is-scrollable');
      }
      if (opts.window){
        const lo = g.frets.find(f => f.n === opts.window[0]);
        if (lo) scroll.scrollLeft = Math.max(0, lo.x - 26);
      } else if (opts.scrollToFret != null) api.scrollTo(opts.scrollToFret);
    });

    const api = {
      geometry: g, svg, scroll,
      scrollTo(fret) {
        const f = g.frets.find(fr => fr.n === fret);
        if (f) scroll.scrollLeft = Math.max(0, f.center - scroll.clientWidth / 2);
      },
      marker(si, fret) {
        return svg.querySelector('.neck-marker[data-s="' + si + '"][data-f="' + fret + '"]');
      },
      /** One expanding ring, once — the reward for a correct answer. */
      pulse(si, fret) {
        const f = g.frets.find(fr => fr.n === fret);
        if (!f) return;
        const ring = el('circle', { cx: f.center, cy: g.stringY(si, f.center), r: S.dot, class: 'neck-pulse' });
        svg.appendChild(ring);
        setTimeout(() => ring.remove(), 500);
      },
    };
    return api;
  }

  return { geometry, render, windows, SCALES };
});
