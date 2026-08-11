const { test } = require('node:test');
const assert = require('node:assert');
const neck = require('../../shared/neck.js');

test('fret columns are uniform and always wide enough to tap', () => {
  // Real fret spacing crowds toward the bridge, which would make fret 12
  // untappable on a phone. The neck gets its realism from widening toward
  // the bridge instead (see the taper test), so columns stay even.
  const g = neck.geometry({ fromFret: 0, toFret: 12, strings: 5, scale: 'play' });
  const playable = g.frets.filter(f => f.n > 0);
  assert.equal(g.frets.length, 13, 'fret 0 (open) through fret 12');
  for (const f of playable) {
    assert.equal(f.width, playable[0].width, `fret ${f.n} should match the others`);
    assert.ok(f.width >= 44, `fret ${f.n} is only ${f.width}px wide`);
  }
  for (let i = 1; i < g.frets.length; i++) {
    assert.ok(g.frets[i].x > g.frets[i - 1].x, 'fret positions must increase');
  }
});

test('the neck widens toward the bridge, as a real one does', () => {
  const g = neck.geometry({ fromFret: 0, toFret: 12, strings: 5, scale: 'play' });
  const top = g.strings[g.strings.length - 1];
  const bottom = g.strings[0];

  const spreadAtNut = Math.abs(g.stringY(0, g.boardStart) - g.stringY(4, g.boardStart));
  const spreadAtEnd = Math.abs(g.stringY(0, g.boardEnd) - g.stringY(4, g.boardEnd));
  assert.ok(spreadAtEnd > spreadAtNut,
    `strings should splay: ${spreadAtNut.toFixed(1)} at the nut vs ${spreadAtEnd.toFixed(1)} at the end`);
  // Subtle, not a fan: roughly the 0.93 → 1.00 pitch ratio from the spec.
  const ratio = spreadAtEnd / spreadAtNut;
  assert.ok(ratio > 1.03 && ratio < 1.12, `taper ratio ${ratio.toFixed(3)} is wrong`);
  // Every string keeps its vertical order along the whole neck.
  assert.ok(top.i > bottom.i);
  assert.ok(g.stringY(4, g.boardEnd) < g.stringY(0, g.boardEnd), 'highest string stays on top');
});

test('strings are gauged like a real set, lowest fattest, and scale with the board', () => {
  const play = neck.geometry({ fromFret: 0, toFret: 5, strings: 5, scale: 'play' });
  assert.equal(play.strings.length, 5);
  for (let i = 1; i < play.strings.length; i++) {
    assert.ok(play.strings[i].gauge < play.strings[i - 1].gauge,
      `string ${i} should be thinner than string ${i - 1}`);
  }
  assert.ok(Math.abs(play.strings[0].gauge - 4.6) < 0.01, 'low B is the .130 of the set');

  // A 4-string drops the low B and keeps the remaining gauges.
  const four = neck.geometry({ fromFret: 0, toFret: 5, strings: 4, scale: 'play' });
  assert.equal(four.strings.length, 4);
  assert.ok(Math.abs(four.strings[0].gauge - 3.7) < 0.01, 'lowest of a 4-string is the E');

  // Smaller boards scale gauges down rather than keeping fat strings.
  const read = neck.geometry({ fromFret: 0, toFret: 5, strings: 5, scale: 'read' });
  assert.ok(read.strings[0].gauge < play.strings[0].gauge);
});

test('inlay markers sit where players navigate, with the octave pair at 12', () => {
  const g = neck.geometry({ fromFret: 0, toFret: 12, strings: 5 });
  assert.deepEqual(g.inlays.filter(i => !i.double).map(i => i.fret), [3, 5, 7, 9]);
  assert.deepEqual(g.inlays.filter(i => i.double).map(i => i.fret), [12]);
});

test('open position fits a 380px phone card without scrolling', () => {
  // Weeks 1-2 live in open position, so this is the default view.
  const g = neck.geometry({ fromFret: 0, toFret: 5, strings: 5, scale: 'play' });
  assert.ok(g.width <= 330, `open position is ${g.width}px, too wide for a 380px card`);
});

test('a fret window renders only the frets asked for, with no open-string column', () => {
  const g = neck.geometry({ fromFret: 5, toFret: 8, strings: 5 });
  assert.deepEqual(g.frets.map(f => f.n), [5, 6, 7, 8]);
  assert.deepEqual(g.inlays.map(i => i.fret), [5, 7]);
});

test('the fret pager covers the whole neck with overlapping windows', () => {
  const windows = neck.windows(12);
  assert.ok(windows.length >= 2, 'a 12-fret neck needs paging on a phone');
  assert.equal(windows[0][0], 0, 'the first window starts at the nut');
  assert.equal(windows[windows.length - 1][1], 12, 'the last window reaches fret 12');
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i][0] < windows[i - 1][1],
      'windows must overlap so the neck reads as continuous');
  }
});
