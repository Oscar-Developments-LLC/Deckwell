/* Portrait grid for a page. Same steps as android/.../Portrait.kt so the editor preview matches the deck.
   shared/portrait-vector.json checks both. See docs/PROTOCOL.md ("Portrait").

   keys: [{ id, row, col, w, h }] in the landscape grid (w and h already clamped to the grid).
   Returns { cols, rows, keys: [{ id, row, col, w, h }] } for the portrait grid (cols and rows swap).
   mode 'reading' keeps each key's place in reading order; 'mirror' swaps its row and column.
   Keys are placed in landscape reading order. A taken or too-small spot moves the key to the next free spot in
   reading order (wrapping to the top). If it can't fit anywhere, it shrinks (width first, then height). */
'use strict';
(function (root) {
  function portraitGrid(keys, cols, rows, mode) {
    const pc = rows, pr = cols, n = pc * pr;
    const occ = new Array(n).fill(false);
    const fits = (r, c, w, h) => {
      if (c + w > pc || r + h > pr) return false;
      for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (occ[y * pc + x]) return false;
      return true;
    };
    const sorted = keys.map((k, i) => [k, i]).sort((a, b) => a[0].row - b[0].row || a[0].col - b[0].col || a[1] - b[1]).map(x => x[0]);
    const out = [];
    for (const k of sorted) {
      const w0 = Math.max(1, Math.min(k.w || 1, cols - k.col)), h0 = Math.max(1, Math.min(k.h || 1, rows - k.row));
      const start = mode === 'mirror' ? k.col * pc + k.row : k.row * cols + k.col;
      let placed = null;
      outer: for (let h = Math.min(h0, pr); h >= 1; h--) for (let w = Math.min(w0, pc); w >= 1; w--) {
        for (let t = 0; t < n; t++) {
          const idx = (start + t) % n, r = Math.floor(idx / pc), c = idx % pc;
          if (fits(r, c, w, h)) {
            for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) occ[y * pc + x] = true;
            placed = { id: k.id, row: r, col: c, w, h };
            break outer;
          }
        }
      }
      if (placed) out.push(placed);
    }
    return { cols: pc, rows: pr, keys: out };
  }
  root.portraitGrid = portraitGrid;
  if (typeof module !== 'undefined') module.exports = { portraitGrid };
})(typeof window !== 'undefined' ? window : globalThis);
