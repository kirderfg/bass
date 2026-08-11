const { test } = require('node:test');
const assert = require('node:assert');
const neck = require('../../shared/neck.js');

test('fret spacing narrows toward the bridge, like a real neck', () => {
  const g = neck.geometry({ fromFret: 0, toFret: 12, strings: 5 });
  const widths = g.frets.slice(1).map(f => f.width);

  assert.equal(g.frets.length, 13, 'fret 0 (open) through fret 12');
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] < widths[i - 1],
      `fret ${i + 1} (${widths[i].toFixed(1)}) should be narrower than fret ${i} (${widths[i - 1].toFixed(1)})`);
  }
  // Positions must march left to right without overlapping.
  for (let i = 1; i < g.frets.length; i++) {
    assert.ok(g.frets[i].x > g.frets[i - 1].x, 'fret positions must increase');
  }
});

test('the taper stays legible: no fret narrower than a fingertip target', () => {
  const g = neck.geometry({ fromFret: 0, toFret: 12, strings: 5, minFretWidth: 44 });
  for (const f of g.frets.slice(1)) {
    assert.ok(f.width >= 44, `fret ${f.n} is only ${f.width.toFixed(1)}px wide`);
  }
  // ...but not so tapered that the neck looks fake.
  const ratio = g.frets[1].width / g.frets[12].width;
  assert.ok(ratio > 1.15 && ratio < 2.2, `taper ratio ${ratio.toFixed(2)} looks wrong`);
});

test('strings are gauged: the lowest string is drawn thickest', () => {
  const five = neck.geometry({ fromFret: 0, toFret: 12, strings: 5 });
  assert.equal(five.strings.length, 5);
  // index 0 is the LOWEST string (B on a 5-string) and must be the fattest
  for (let i = 1; i < five.strings.length; i++) {
    assert.ok(five.strings[i].gauge < five.strings[i - 1].gauge,
      `string ${i} should be thinner than string ${i - 1}`);
  }
  // Top row when rendered is the highest string, so y descends with index.
  for (let i = 1; i < five.strings.length; i++) {
    assert.ok(five.strings[i].y < five.strings[i - 1].y,
      'higher strings render nearer the top');
  }
  const four = neck.geometry({ fromFret: 0, toFret: 12, strings: 4 });
  assert.equal(four.strings.length, 4);
});

test('inlay markers sit at the frets players actually navigate by', () => {
  const g = neck.geometry({ fromFret: 0, toFret: 12, strings: 5 });
  const single = g.inlays.filter(i => !i.double).map(i => i.fret);
  const double = g.inlays.filter(i => i.double).map(i => i.fret);
  assert.deepEqual(single, [3, 5, 7, 9]);
  assert.deepEqual(double, [12], 'fret 12 is the octave and gets the double dot');
});

test('a partial neck window renders only the requested frets', () => {
  const g = neck.geometry({ fromFret: 5, toFret: 8, strings: 5 });
  assert.deepEqual(g.frets.map(f => f.n), [5, 6, 7, 8]);
  assert.ok(!g.frets.some(f => f.n === 0), 'no open-string column when starting at fret 5');
  assert.deepEqual(g.inlays.map(i => i.fret), [5, 7], 'only inlays inside the window');
});
