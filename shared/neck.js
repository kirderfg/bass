/* Shared bass-neck renderer for the Bass Theory Trainer and Bass Live Trainer.
   Draws an SVG fingerboard that reads as an instrument rather than a table.
   Colours come from CSS custom properties so the theme can change without
   touching this file. Loads in the browser as `BassNeck`, and in Node via
   require() so the geometry can be unit-tested. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BassNeck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STRING_H = 30;        // vertical distance between strings
  const PAD_TOP = 18;         // room above the top string
  const PAD_BOTTOM = 18;
  const NUT_W = 9;
  const INLAY_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];
  const DOUBLE_INLAY_FRETS = [12, 24];

  /**
   * Lay out the neck.
   *
   * Real frets crowd together toward the bridge (each is 1/17.817 of the
   * remaining string). Using that spacing verbatim makes fret 12 too narrow
   * to tap, so we blend true spacing with even spacing: enough taper to look
   * like a neck, enough width to stay playable on a phone.
   *
   * @returns {{width, height, frets:[{n,x,width,center}], strings:[{i,y,gauge}], inlays}}
   */
  function geometry(opts) {
    const fromFret = opts.fromFret || 0;
    const toFret = opts.toFret != null ? opts.toFret : 12;
    const nStrings = opts.strings || 5;
    const minFretWidth = opts.minFretWidth || 46;
    const TAPER = 0.55;       // 0 = even spacing, 1 = true fret spacing

    // Fractional distance from the nut, blended.
    const pos = (n) => {
      const trueP = 1 - Math.pow(2, -n / 12);
      const evenP = n / 12;
      return TAPER * trueP + (1 - TAPER) * evenP;
    };

    // Raw (unscaled) widths for the frets in view. Fret 0 is the open-string
    // column and gets the width of fret 1 so open notes have room.
    const raw = [];
    for (let n = fromFret; n <= toFret; n++) {
      raw.push(n === 0 ? pos(1) - pos(0) : pos(n) - pos(n - 1));
    }
    const narrowest = Math.min.apply(null, raw);
    const scale = minFretWidth / narrowest;

    const frets = [];
    let x = fromFret === 0 ? NUT_W : 0;
    for (let i = 0; i < raw.length; i++) {
      const width = raw[i] * scale;
      const n = fromFret + i;
      frets.push({ n, x, width, center: x + width / 2 });
      x += width;
    }

    // Strings: index 0 is the lowest (fattest) and renders at the bottom.
    // Gauges echo a real set (.130 down to .045) so the low B looks low.
    const gaugeFor = (i, total) => {
      const fromTop = total - 1 - i;          // 0 = highest string
      return 1.6 + fromTop * 0.62;
    };
    const strings = [];
    for (let i = 0; i < nStrings; i++) {
      const fromTop = nStrings - 1 - i;
      strings.push({ i, y: PAD_TOP + fromTop * STRING_H, gauge: gaugeFor(i, nStrings) });
    }

    const inRange = (f) => f >= Math.max(1, fromFret) && f <= toFret;
    const inlays = INLAY_FRETS.filter(inRange).map(f => ({ fret: f, double: false }))
      .concat(DOUBLE_INLAY_FRETS.filter(inRange).map(f => ({ fret: f, double: true })))
      .sort((a, b) => a.fret - b.fret);

    return {
      width: x,
      height: PAD_TOP + (nStrings - 1) * STRING_H + PAD_BOTTOM,
      frets, strings, inlays,
      fromFret, toFret, nStrings,
      stringH: STRING_H,
    };
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */

  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  let defsId = 0;

  /**
   * Render a neck into `host`.
   *
   * opts:
   *   strings        ['B','E','A','D','G'] low → high
   *   fromFret/toFret
   *   markers        [{ si, fret, kind, label, finger }]
   *                  kind: root | tone | highlight | correct | wrong | ghost
   *   window         [lo, hi] frets to spotlight; others dimmed
   *   dimStrings     [si, ...] strings to fade out
   *   onTap(si, fret)
   *   scrollToFret   n
   */
  function render(host, opts) {
    const names = opts.strings;
    const g = geometry({
      fromFret: opts.fromFret || 0,
      toFret: opts.toFret != null ? opts.toFret : 12,
      strings: names.length,
      minFretWidth: opts.minFretWidth,
    });
    const uid = 'nk' + (++defsId);
    const showNumbers = opts.showFretNumbers !== false;
    const numbersH = showNumbers ? 20 : 0;

    host.innerHTML = '';
    host.classList.add('neck');

    // String names live OUTSIDE the scrolling area, so they can never be
    // covered by the board when it scrolls.
    const labels = document.createElement('div');
    labels.className = 'neck-labels';
    labels.style.paddingTop = g.strings[0].y - 10 + 'px';
    labels.style.paddingBottom = numbersH + 'px';
    for (let i = names.length - 1; i >= 0; i--) {
      const l = document.createElement('span');
      l.className = 'neck-label' + (i === 0 ? ' is-lowest' : '');
      if (opts.dimStrings && opts.dimStrings.indexOf(i) >= 0) l.classList.add('is-dim');
      l.style.height = g.stringH + 'px';
      l.textContent = names[i];
      labels.appendChild(l);
    }

    const scroll = document.createElement('div');
    scroll.className = 'neck-scroll';

    const svg = el('svg', {
      class: 'neck-svg',
      width: g.width,
      height: g.height + numbersH,
      viewBox: '0 0 ' + g.width + ' ' + (g.height + numbersH),
      role: 'img',
    });

    // ---- defs: fingerboard wood, fret wire, string sheen ----
    const defs = el('defs');
    const wood = el('linearGradient', { id: uid + 'wood', x1: '0', y1: '0', x2: '0', y2: '1' });
    wood.appendChild(el('stop', { offset: '0', 'stop-color': 'var(--fb-wood-hi)' }));
    wood.appendChild(el('stop', { offset: '0.55', 'stop-color': 'var(--fb-wood)' }));
    wood.appendChild(el('stop', { offset: '1', 'stop-color': 'var(--fb-wood-lo)' }));
    defs.appendChild(wood);

    const wire = el('linearGradient', { id: uid + 'wire', x1: '0', y1: '0', x2: '1', y2: '0' });
    wire.appendChild(el('stop', { offset: '0', 'stop-color': 'var(--fb-wire-hi)' }));
    wire.appendChild(el('stop', { offset: '0.5', 'stop-color': 'var(--fb-wire)' }));
    wire.appendChild(el('stop', { offset: '1', 'stop-color': 'var(--fb-wire-lo)' }));
    defs.appendChild(wire);

    const strGrad = el('linearGradient', { id: uid + 'str', x1: '0', y1: '0', x2: '0', y2: '1' });
    strGrad.appendChild(el('stop', { offset: '0', 'stop-color': 'var(--fb-string-hi)' }));
    strGrad.appendChild(el('stop', { offset: '0.45', 'stop-color': 'var(--fb-string)' }));
    strGrad.appendChild(el('stop', { offset: '1', 'stop-color': 'var(--fb-string-lo)' }));
    defs.appendChild(strGrad);
    svg.appendChild(defs);

    // ---- fingerboard ----
    const boardX = g.fromFret === 0 ? NUT_W : 0;
    svg.appendChild(el('rect', {
      x: 0, y: g.strings[g.strings.length - 1].y - g.stringH * 0.6,
      width: g.width,
      height: (g.nStrings - 1) * g.stringH + g.stringH * 1.2,
      rx: 3, fill: 'url(#' + uid + 'wood)',
    }));

    const boardTop = g.strings[g.strings.length - 1].y - g.stringH * 0.6;
    const boardH = (g.nStrings - 1) * g.stringH + g.stringH * 1.2;

    // ---- inlay markers, behind the strings ----
    const midY = boardTop + boardH / 2;
    for (const inlay of g.inlays) {
      const f = g.frets.find(fr => fr.n === inlay.fret);
      if (!f) continue;
      if (inlay.double) {
        svg.appendChild(el('circle', { cx: f.center, cy: midY - g.stringH * 0.75, r: 5.5, class: 'neck-inlay' }));
        svg.appendChild(el('circle', { cx: f.center, cy: midY + g.stringH * 0.75, r: 5.5, class: 'neck-inlay' }));
      } else {
        svg.appendChild(el('circle', { cx: f.center, cy: midY, r: 5.5, class: 'neck-inlay' }));
      }
    }

    // ---- fret wire ----
    for (const f of g.frets) {
      if (f.n === g.fromFret && g.fromFret === 0) continue; // nut drawn separately
      svg.appendChild(el('rect', {
        x: f.x - 1.4, y: boardTop, width: 2.8, height: boardH,
        fill: 'url(#' + uid + 'wire)',
      }));
    }
    // trailing wire on the right edge
    const lastF = g.frets[g.frets.length - 1];
    svg.appendChild(el('rect', {
      x: lastF.x + lastF.width - 1.4, y: boardTop, width: 2.8, height: boardH,
      fill: 'url(#' + uid + 'wire)',
    }));
    if (g.fromFret === 0) {
      svg.appendChild(el('rect', {
        x: 0, y: boardTop, width: NUT_W, height: boardH, rx: 1.5, class: 'neck-nut',
      }));
    }

    // ---- window spotlight (the "moveable box") ----
    if (opts.window) {
      const lo = g.frets.find(f => f.n === opts.window[0]);
      const hi = g.frets.find(f => f.n === opts.window[1]);
      if (lo && hi) {
        svg.appendChild(el('rect', {
          x: lo.x, y: boardTop - 3,
          width: (hi.x + hi.width) - lo.x, height: boardH + 6,
          rx: 6, class: 'neck-window',
        }));
      }
    }

    // ---- strings ----
    for (const s of g.strings) {
      const dim = opts.dimStrings && opts.dimStrings.indexOf(s.i) >= 0;
      svg.appendChild(el('rect', {
        x: g.fromFret === 0 ? NUT_W : 0, y: s.y - s.gauge / 2,
        width: g.width - (g.fromFret === 0 ? NUT_W : 0), height: s.gauge,
        fill: 'url(#' + uid + 'str)', opacity: dim ? 0.25 : 1, rx: s.gauge / 2,
      }));
    }

    // ---- tap targets ----
    if (opts.onTap) {
      for (const s of g.strings) {
        if (opts.dimStrings && opts.dimStrings.indexOf(s.i) >= 0) continue;
        for (const f of g.frets) {
          const hit = el('rect', {
            x: f.x, y: s.y - g.stringH / 2, width: f.width, height: g.stringH,
            class: 'neck-hit', 'data-s': s.i, 'data-f': f.n,
          });
          hit.addEventListener('click', () => opts.onTap(s.i, f.n));
          svg.appendChild(hit);
        }
      }
    }

    // ---- note markers ----
    for (const m of (opts.markers || [])) {
      const s = g.strings[m.si];
      const f = g.frets.find(fr => fr.n === m.fret);
      if (!s || !f) continue;
      const outside = opts.window && (m.fret < opts.window[0] || m.fret > opts.window[1]);
      const grp = el('g', {
        class: 'neck-marker is-' + (m.kind || 'tone') + (outside ? ' is-outside' : ''),
      });
      grp.appendChild(el('circle', { cx: f.center, cy: s.y, r: 13.5, class: 'neck-dot' }));
      if (m.label != null) {
        const t = el('text', { x: f.center, y: s.y, class: 'neck-dot-label' });
        t.textContent = m.label;
        grp.appendChild(t);
      }
      if (m.finger) {
        grp.appendChild(el('circle', { cx: f.center + 11, cy: s.y + 11, r: 7, class: 'neck-finger-bg' }));
        const ft = el('text', { x: f.center + 11, y: s.y + 11, class: 'neck-finger' });
        ft.textContent = m.finger;
        grp.appendChild(ft);
      }
      svg.appendChild(grp);
    }

    // ---- fret numbers ----
    if (showNumbers) {
      const y = g.height + 13;
      for (const f of g.frets) {
        const t = el('text', {
          x: f.center, y,
          class: 'neck-fretnum' + (f.n === 0 ? ' is-open' : '') +
                 (INLAY_FRETS.indexOf(f.n) >= 0 || DOUBLE_INLAY_FRETS.indexOf(f.n) >= 0 ? ' is-marked' : ''),
        });
        t.textContent = f.n === 0 ? 'open' : f.n;
        svg.appendChild(t);
      }
    }

    scroll.appendChild(svg);
    host.appendChild(labels);
    host.appendChild(scroll);

    if (opts.scrollToFret != null) {
      const f = g.frets.find(fr => fr.n === opts.scrollToFret);
      if (f) scroll.scrollLeft = Math.max(0, f.center - scroll.clientWidth / 2);
    }

    return {
      geometry: g,
      svg,
      scrollTo(fret) {
        const f = g.frets.find(fr => fr.n === fret);
        if (f) scroll.scrollLeft = Math.max(0, f.center - scroll.clientWidth / 2);
      },
      markerAt(si, fret) {
        return svg.querySelector('.neck-marker[data-s="' + si + '"][data-f="' + fret + '"]');
      },
    };
  }

  return { geometry, render, STRING_H };
});
