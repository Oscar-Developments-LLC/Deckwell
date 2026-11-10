// Makes shared/portrait-vector.json from the editor's portrait.js, or checks it with --check.
// The deck's PortraitTest reads the same file, so the editor preview and the deck always agree.
//   node tests/editor/portrait-vector.js          (rewrite the vector)
//   node tests/editor/portrait-vector.js --check  (fail if portrait.js no longer matches it)
'use strict';
const fs = require('fs'), path = require('path');
const { portraitGrid } = require('../../desktop/ui/portrait.js');
const out = path.join(__dirname, '../../shared/portrait-vector.json');

const k = (id, row, col, w, h) => ({ id, row, col, w: w || 1, h: h || 1 });
const full = (cols, rows, skip) => { const a = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!(skip || []).includes(r + ',' + c)) a.push(k(`k${r}${c}`, r, c)); return a; };
const cases = [
  { name: '5x3 with Now Playing', cols: 5, rows: 3, keys: [k('np', 0, 0, 2), ...full(5, 3, ['0,0', '0,1'])] },
  { name: '5x3 gaps', cols: 5, rows: 3, keys: [k('a', 0, 4), k('b', 2, 0), k('c', 1, 2)] },
  { name: 'folder with back key', cols: 4, rows: 3, keys: [k('__back', 0, 0), k('x', 0, 1), k('y', 1, 3), k('z', 2, 2)] },
  { name: '6x2 panel 3x2', cols: 6, rows: 2, keys: [k('p', 0, 0, 3, 2), k('a', 0, 3), k('b', 1, 5)] },
  { name: '8x6 full', cols: 8, rows: 6, keys: full(8, 6) },
  { name: '2x1 Now Playing', cols: 2, rows: 1, keys: [k('np', 0, 0, 2)] },
  { name: '4x3 panel 4x3', cols: 4, rows: 3, keys: [k('big', 0, 0, 4, 3)] },
  { name: '5x3 two panels', cols: 5, rows: 3, keys: [k('p1', 0, 0, 2, 2), k('p2', 0, 3, 2, 3), k('a', 2, 0)] },
];
const vector = { note: 'Portrait grid test cases. Made by tests/editor/portrait-vector.js from desktop/ui/portrait.js.', cases: [] };
for (const c of cases) for (const mode of ['reading', 'mirror'])
  vector.cases.push({ name: c.name, mode, cols: c.cols, rows: c.rows, keys: c.keys, expect: portraitGrid(c.keys, c.cols, c.rows, mode) });
const json = JSON.stringify(vector, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(out, 'utf8') !== json) { console.error('shared/portrait-vector.json is out of date. Run node tests/editor/portrait-vector.js'); process.exit(1); }
  console.log('portrait vector ok (' + vector.cases.length + ' cases)');
} else { fs.writeFileSync(out, json); console.log('wrote ' + vector.cases.length + ' cases'); }
