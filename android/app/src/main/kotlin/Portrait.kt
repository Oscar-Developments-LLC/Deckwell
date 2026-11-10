package com.oscardevelopments.deckwell

/**
 * Turns a page's landscape grid into its portrait grid. The desktop editor (desktop/ui/portrait.js) runs the
 * same steps so its preview matches the deck exactly. shared/portrait-vector.json checks both. See docs/PROTOCOL.md.
 *
 * A cols x rows page becomes rows x cols (columns and rows swap). Each key gets a starting spot:
 *   reading: its place in reading order stays the same (key 1 stays first, then left to right, top to bottom)
 *   mirror:  row and column swap (row 2, col 4 goes to row 4, col 2)
 * Keys are placed in landscape reading order. If the starting spot is taken or the key doesn't fit there,
 * the next free spot in reading order is used (wrapping to the top). If the key can't fit anywhere at its size,
 * it shrinks (width first, then height) until it does.
 */
object Portrait {
    class Grid(val cols: Int, val rows: Int, val keys: List<DKey>)

    fun of(keys: List<DKey>, cols: Int, rows: Int, mode: String): Grid {
        val pc = rows; val pr = cols
        val occ = BooleanArray(pc * pr)
        val out = ArrayList<DKey>()
        fun fits(r: Int, c: Int, w: Int, h: Int): Boolean {
            if (c + w > pc || r + h > pr) return false
            for (y in r until r + h) for (x in c until c + w) if (occ[y * pc + x]) return false
            return true
        }
        for (k in keys.sortedWith(compareBy<DKey>({ it.row }, { it.col }))) {
            val w0 = k.span.coerceAtMost(cols - k.col).coerceAtLeast(1)
            val h0 = k.vspan.coerceAtMost(rows - k.row).coerceAtLeast(1)
            val start = if (mode == "mirror") k.col * pc + k.row else k.row * cols + k.col
            var placed: DKey? = null
            loop@ for (h in minOf(h0, pr) downTo 1) for (w in minOf(w0, pc) downTo 1) {
                for (t in 0 until pc * pr) {
                    val idx = (start + t) % (pc * pr)
                    val r = idx / pc; val c = idx % pc
                    if (fits(r, c, w, h)) {
                        for (y in r until r + h) for (x in c until c + w) occ[y * pc + x] = true
                        placed = k.at(r, c, w, h)
                        break@loop
                    }
                }
            }
            placed?.let { out.add(it) }
        }
        return Grid(pc, pr, out)
    }
}
