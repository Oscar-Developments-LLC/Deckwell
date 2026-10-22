package com.oscardevelopments.deckwell

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.View
import android.view.animation.DecelerateInterpolator
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Draws the whole deck in a 1920x1200 design space (the Kindle Fire HDX 7" panel it was first built for), scaled to fit.
 * Geometry matches the desktop editor's geom() so what you build is what you get.
 */
@SuppressLint("ViewConstructor")
class DeckView(ctx: Context, private val res: Res, private val cb: Callbacks) : View(ctx) {
    interface Callbacks {
        fun press(k: DKey)
        fun release(k: DKey)
        fun slider(s: DSlider, value: Int)
        fun sliderButton(s: DSlider)
        fun pageChanged(id: String)
        fun pairApprove()
        fun pairCancel()
    }

    companion object {
        const val W = 1920f; const val H = 1200f; const val PAD = 37f; const val TOP = 132f; const val BOTTOM = 178f; const val GAP = 28f
        const val STRIP_GAP = 60f; const val SLIDER_GAP = 50f
        /** Width of a slider strip with n sliders (3 sliders = 376, the original fixed strip). */
        fun stripW(n: Int) = n * SBTN + (n - 1).coerceAtLeast(0) * SLIDER_GAP
        const val TRACK_TOP = 232f; const val TRACK_BOTTOM = 994f; const val SBTN_TOP = 1010f; const val SBTN = 92f
        val ACCENT = Color.parseColor("#8f84e6"); val ACCENT2 = Color.parseColor("#b9b1f2")
        val TEXT = Color.parseColor("#e8e7f0"); val TEXT2 = Color.parseColor("#a4a6b5"); val TEXT3 = Color.parseColor("#8d8fa0")
        val DANGER = Color.parseColor("#e27f8c")
    }

    /* ---------------- state ---------------- */
    var layout: Layout? = null
        set(v) { field = v; if (v != null && v.page(pageId) == null) pageId = v.roots.firstOrNull()?.id; invalidate() }
    var pageId: String? = null
    var connected = false
    var link = "wifi"
    var rtt = 0
    var lastPeer: String? = null
    var usbPlugged = false
    var myIp: String? = null
    var np: NowPlaying? = null
    val sliders = HashMap<String, SliderState>()
    val status = HashMap<String, StatusValue>()
    val feedback = HashMap<String, Feedback>()
    var toast: Toast? = null
    /** Non-null while a computer is pairing with this deck. */
    var pair: Link.PairPrompt? = null
        set(v) { field = v; pairDown = 0; invalidate() }

    /* ---------------- transform ---------------- */
    private var sc = 1f; private var ox = 0f; private var oy = 0f
    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        sc = min(w / W, h / H); ox = (w - W * sc) / 2f; oy = (h - H * sc) / 2f
    }

    /* ---------------- paints ---------------- */
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    private val bp = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val rf = RectF()
    private val path = Path()
    private val clockFmt = SimpleDateFormat("HH:mm", Locale.US)
    private val bgShader by lazy { LinearGradient(0f, 0f, W * 0.3f, H, Color.parseColor("#1e2030"), Color.parseColor("#141624"), Shader.TileMode.CLAMP) }
    private val keyShaders = HashMap<Int, Shader>()
    private fun keyShader(h: Float) = keyShaders.getOrPut(h.roundToInt()) { LinearGradient(0f, 0f, 0f, h, Color.parseColor("#232533"), Color.parseColor("#1f212e"), Shader.TileMode.CLAMP) }

    private data class Geom(val w: Float, val h: Float, val availW: Float, val gridH: Float, val x0: Float)
    private fun geom(pg: DPage): Geom {
        val sw = if (pg.hasStrip) stripW(pg.strip.size) + STRIP_GAP else 0f
        val availW = W - 2 * PAD - sw
        val availH = H - TOP - BOTTOM
        val w = (availW - (pg.cols - 1) * GAP) / pg.cols
        val h = min((availH - (pg.rows - 1) * GAP) / pg.rows, w)
        return Geom(w, h, availW, pg.rows * h + (pg.rows - 1) * GAP, PAD + if (pg.stripLeft) sw else 0f)
    }
    private fun keyRect(g: Geom, row: Int, col: Int, span: Int, dx: Float, out: RectF) {
        val l = g.x0 + col * (g.w + GAP) + dx; val t = TOP + row * (g.h + GAP)
        out.set(l, t, l + span * g.w + (span - 1) * GAP, t + g.h)
    }

    /* ---------------- drawing helpers ---------------- */
    private fun text(c: Canvas, s: String, x: Float, y: Float, size: Float, tf: Typeface, color: Int, align: Paint.Align = Paint.Align.LEFT, spacing: Float = 0f) {
        tp.typeface = tf; tp.textSize = size; tp.color = color; tp.textAlign = align
        if (spacing != 0f && android.os.Build.VERSION.SDK_INT >= 21) tp.letterSpacing = spacing
        if (spacing != 0f && android.os.Build.VERSION.SDK_INT < 21) {
            // manual tracking for API 19
            var cx = when (align) { Paint.Align.CENTER -> x - width(s, size, tf, spacing) / 2; Paint.Align.RIGHT -> x - width(s, size, tf, spacing); else -> x }
            tp.textAlign = Paint.Align.LEFT
            for (ch in s) { val str = ch.toString(); c.drawText(str, cx, y, tp); cx += tp.measureText(str) + spacing * size }
            return
        }
        c.drawText(s, x, y, tp)
        if (android.os.Build.VERSION.SDK_INT >= 21) tp.letterSpacing = 0f
    }
    private fun width(s: String, size: Float, tf: Typeface, spacing: Float = 0f): Float {
        tp.typeface = tf; tp.textSize = size
        return tp.measureText(s) + if (spacing != 0f) spacing * size * s.length else 0f
    }
    private fun fit(s: String, size: Float, tf: Typeface, maxW: Float): String {
        if (width(s, size, tf) <= maxW) return s
        var n = s.length
        while (n > 1 && width(s.substring(0, n) + "…", size, tf) > maxW) n--
        return s.substring(0, n).trimEnd() + "…"
    }
    private fun glyph(c: Canvas, name: String?, cx: Float, cy: Float, size: Float, color: Int) {
        val b = res.glyph(name) ?: return
        bp.colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN); bp.alpha = 255
        rf.set(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2)
        c.drawBitmap(b, null, rf, bp)
        bp.colorFilter = null
    }
    private fun round(c: Canvas, l: Float, t: Float, r: Float, b: Float, rad: Float, color: Int) {
        p.shader = null; p.style = Paint.Style.FILL; p.color = color; rf.set(l, t, r, b); c.drawRoundRect(rf, rad, rad, p)
    }
    private fun stroke(c: Canvas, l: Float, t: Float, r: Float, b: Float, rad: Float, color: Int, w: Float) {
        p.shader = null; p.style = Paint.Style.STROKE; p.strokeWidth = w; p.color = color; rf.set(l, t, r, b); c.drawRoundRect(rf, rad, rad, p); p.style = Paint.Style.FILL
    }

    /* ---------------- frame ---------------- */
    override fun onDraw(c: Canvas) {
        c.drawColor(Color.parseColor("#111320"))
        c.save(); c.translate(ox, oy); c.scale(sc, sc)
        p.color = Color.WHITE; p.shader = bgShader; c.drawRect(0f, 0f, W, H, p); p.shader = null
        val lay = layout; val pg = lay?.page(pageId)
        val pr = pair
        if (pr != null) {
            drawPairing(c, pr)
            c.restore(); postInvalidateDelayed(60); return
        }
        if (!connected) {
            drawDisconnected(c)
            c.restore(); postInvalidateDelayed(60); return
        }
        if (lay == null || pg == null) {
            drawWaiting(c, lay)
            c.restore(); postInvalidateDelayed(500); return
        }
        drawTopBar(c, lay, pg)
        c.save(); c.clipRect(0f, TOP - 24f, W, H)
        drawPage(c, lay, pg, pageOffset)
        if (pageOffset != 0f) neighbor(lay, pg, if (pageOffset < 0) 1 else -1)?.let { drawPage(c, lay, it, pageOffset + if (pageOffset < 0) W else -W) }
        c.restore()
        drawDots(c, lay, pg)
        c.restore()
        scheduleRedraw()
    }

    private fun scheduleRedraw() {
        val now = System.currentTimeMillis()
        var next = 60_000 - now % 60_000
        if (np?.playing == true) next = min(next, 1000 - now % 1000)
        toast?.let { if (it.until > now) next = min(next, it.until - now) }
        feedback.values.forEach { if (it.until > now) next = min(next, it.until - now) }
        postInvalidateDelayed(max(16, next))
    }

    /* ---------------- top bar ---------------- */
    private fun drawTopBar(c: Canvas, lay: Layout, pg: DPage) {
        val base = 76f
        val parent = lay.page(pg.parent)
        if (parent == null) {
            text(c, pg.name, PAD, base, 34f, res.semibold, TEXT)
            text(c, "${pg.cols} × ${pg.rows}", PAD + width(pg.name, 34f, res.semibold) + 22f, base, 26f, res.regular, Color.parseColor("#8f91a3"))
        } else {
            text(c, parent.name, PAD, base, 32f, res.regular, Color.parseColor("#8f91a3"))
            val x = PAD + width(parent.name, 32f, res.regular) + 22f
            glyph(c, "chevron-right", x + 12f, 64f, 26f, Color.parseColor("#6f7284"))
            text(c, pg.name, x + 46f, base, 34f, res.semibold, TEXT)
        }
        val now = System.currentTimeMillis()
        var xr = W - PAD
        val t = toast?.takeIf { it.until > now }
        if (t == null) {
            val clock = clockFmt.format(Date())
            text(c, clock, xr, base + 1f, 28f, res.regular, TEXT2, Paint.Align.RIGHT)
            xr -= width(clock, 28f, res.regular) + 28f
        }
        // link pill
        val label = (if (link == "usb") "USB" else "Wi-Fi") + " · $rtt ms"
        val pw = 26f + 12f + 14f + width(label, 26f, res.regular) + 28f
        round(c, xr - pw, 35f, xr, 93f, 29f, Color.parseColor("#2a2c3b"))
        p.color = ACCENT; c.drawCircle(xr - pw + 32f, 64f, 7f, p)
        text(c, label, xr - pw + 52f, 73f, 26f, res.regular, Color.parseColor("#d6d7e0"))
        xr -= pw + 22f
        if (t != null) {
            val maxW = xr - 520f
            val msg = fit(t.text, 24f, res.mono, maxW - 90f)
            val tw = 22f + 26f + 16f + width(msg, 24f, res.mono) + 24f
            round(c, xr - tw, 36f, xr, 92f, 12f, Color.parseColor(if (t.ok) "#23213d" else "#2b1f2b"))
            stroke(c, xr - tw + 1f, 37f, xr - 1f, 91f, 12f, Color.parseColor(if (t.ok) "#4a4380" else "#6e3a4c"), 2f)
            glyph(c, if (t.ok) "check" else "alert", xr - tw + 22f + 13f, 64f, 26f, if (t.ok) ACCENT else DANGER)
            text(c, msg, xr - tw + 22f + 26f + 16f, 72f, 24f, res.mono, Color.parseColor("#dcdaf0"))
        }
    }

    /* ---------------- page ---------------- */
    private fun drawPage(c: Canvas, lay: Layout, pg: DPage, dx: Float) {
        val g = geom(pg)
        val keys = lay.keysOf(pg)
        val occ = HashSet<Int>()
        for (k in keys) for (i in 0 until min(k.span, pg.cols - k.col)) occ.add(k.row * 16 + k.col + i)
        for (r in 0 until pg.rows) for (col in 0 until pg.cols) if (!occ.contains(r * 16 + col)) {
            keyRect(g, r, col, 1, dx, rf)
            stroke(c, rf.left + 1f, rf.top + 1f, rf.right - 1f, rf.bottom - 1f, 24f, Color.parseColor("#25273a"), 2f)
        }
        for (k in keys) {
            keyRect(g, k.row, k.col, min(k.span, pg.cols - k.col), dx, rf)
            drawKey(c, k, RectF(rf), lay.page(pg.parent) != null)
        }
        if (pg.hasStrip) drawStrip(c, pg, dx)
    }

    private fun drawKey(c: Canvas, k: DKey, r: RectF, inFolder: Boolean) {
        val now = System.currentTimeMillis()
        val fb = feedback[k.id]?.takeIf { it.until > now }
        val pressed = pressedKey?.id == k.id && !swiping
        c.save()
        if (pressed) c.scale(0.965f, 0.965f, r.centerX(), r.centerY())
        // ring glow sits outside the key
        if (fb != null && fb.ring) {
            for ((w, a) in listOf(22f to 16, 14f to 30, 8f to 55)) stroke(c, r.left - w / 2 + 3, r.top - w / 2 + 3, r.right + w / 2 - 3, r.bottom + w / 2 - 3, 24f + w / 2, Color.argb(a, 143, 132, 230), w)
        }
        c.save(); c.translate(r.left, r.top)
        p.color = Color.WHITE; p.shader = keyShader(r.height()); p.style = Paint.Style.FILL
        rf.set(0f, 0f, r.width(), r.height()); c.drawRoundRect(rf, 24f, 24f, p); p.shader = null
        if (pressed) round(c, 0f, 0f, r.width(), r.height(), 24f, Color.argb(40, 255, 255, 255))
        stroke(c, 1f, 1f, r.width() - 1f, r.height() - 1f, 23f, Color.parseColor("#2c2e3d"), 2f)
        p.color = Color.argb(9, 255, 255, 255); c.drawRect(24f, 2f, r.width() - 24f, 4f, p)
        if (fb != null && fb.ring) stroke(c, 2.5f, 2.5f, r.width() - 2.5f, r.height() - 2.5f, 22f, ACCENT, 5f)
        c.restore()
        when (k.kind) {
            "np" -> drawNp(c, r)
            "status" -> drawStatus(c, k, r)
            else -> drawStd(c, k, r, inFolder, fb)
        }
        if (fb != null && fb.ring) {
            p.color = ACCENT; c.drawCircle(r.right - 34f, r.top + 34f, 18f, p)
            glyph(c, "check", r.right - 34f, r.top + 34f, 22f, Color.WHITE)
        }
        if (fb != null && fb.badge != null) {
            val bw = 20f + 22f + 8f + width(fb.badge, 20f, res.monoBold) + 16f
            val bx = r.right - 18f - bw; val by = r.top + 14f
            round(c, bx, by, bx + bw, by + 38f, 8f, Color.parseColor("#eeeef3"))
            glyph(c, "alert", bx + 20f + 11f, by + 19f, 22f, Color.parseColor("#26272f"))
            text(c, fb.badge, bx + 20f + 22f + 8f, by + 26f, 20f, res.monoBold, Color.parseColor("#26272f"))
        }
        c.restore()
    }

    private fun drawStd(c: Canvas, k: DKey, r: RectF, inFolder: Boolean, fb: Feedback?) {
        val icon = res.icon(k.icon)
        val iconH = when { icon != null || k.mono != null -> 108f; k.caps != null && k.caps.isNotEmpty() -> 49f; k.glyph != null -> 64f; else -> 0f }
        val showLabel = k.labelPos != "hidden" && k.label.isNotEmpty()
        val sub = fb?.line ?: (if (inFolder || k.isBack) k.sub else null)
        val labCap = 19f; val subCap = 14f
        val gapIL = if (iconH > 0 && showLabel) 24f else 0f
        val block = iconH + gapIL + (if (showLabel) labCap else 0f) + (if (sub != null) 14f + subCap else 0f)
        var y = r.top + (r.height() - block) / 2f - 2f
        val cx = r.centerX()
        val top = k.labelPos == "top"
        val maxW = r.width() - 28f
        fun drawLabel() {
            text(c, fit(k.label, 26f, res.medium, maxW), cx, y + labCap, 26f, res.medium, Color.parseColor("#e9e8f0"), Paint.Align.CENTER)
            y += labCap
        }
        fun drawIcon() {
            when {
                icon != null -> { rf.set(cx - 54f, y, cx + 54f, y + 108f); bp.colorFilter = null; c.drawBitmap(icon, null, rf, bp) }
                k.mono != null -> {
                    p.color = Color.WHITE; p.shader = LinearGradient(0f, y, 0f, y + 108f, Color.parseColor("#575a69"), Color.parseColor("#44475a"), Shader.TileMode.CLAMP)
                    rf.set(cx - 54f, y, cx + 54f, y + 108f); c.drawRoundRect(rf, 22f, 22f, p); p.shader = null
                    text(c, k.mono, cx, y + 54f + 14.5f, 40f, res.medium, Color.parseColor("#eeeef4"), Paint.Align.CENTER)
                }
                k.caps != null && k.caps.isNotEmpty() -> {
                    val ws = k.caps.map { max(46f, width(it, 22f, res.semibold) + 20f) }
                    var x = cx - (ws.sum() + 10f * (ws.size - 1)) / 2f
                    k.caps.forEachIndexed { i, s ->
                        round(c, x, y + 3f, x + ws[i], y + 49f, 8f, Color.argb(90, 0, 0, 0))
                        p.color = Color.WHITE; p.shader = LinearGradient(0f, y, 0f, y + 46f, Color.parseColor("#43465a"), Color.parseColor("#383a4b"), Shader.TileMode.CLAMP)
                        rf.set(x, y, x + ws[i], y + 46f); c.drawRoundRect(rf, 8f, 8f, p); p.shader = null
                        text(c, s, x + ws[i] / 2f, y + 31f, 22f, res.semibold, Color.parseColor("#e5e5ee"), Paint.Align.CENTER)
                        x += ws[i] + 10f
                    }
                }
                k.glyph != null -> glyph(c, k.glyph, cx, y + 32f, 64f, Color.parseColor("#ecebf4"))
            }
            y += iconH
        }
        if (top && showLabel) { drawLabel(); y += gapIL; drawIcon() } else { drawIcon(); y += gapIL; if (showLabel) drawLabel() }
        if (sub != null) {
            y += 14f
            text(c, fit(sub, 19f, res.mono, maxW), cx, y + subCap, 19f, res.mono, if (fb?.line != null) ACCENT2 else Color.parseColor("#9a9cab"), Paint.Align.CENTER)
        }
    }

    private fun drawStatus(c: Canvas, k: DKey, r: RectF) {
        val v = status[k.id]
        val x = r.left + 26f; val maxW = r.width() - 52f
        text(c, fit(k.title ?: k.label, 24f, res.regular, maxW), x, r.top + 48f, 24f, res.regular, Color.parseColor("#b4b6c4"))
        text(c, fit(v?.value ?: "—", 62f, res.monoBold, maxW), x, r.top + 117f, 62f, res.monoBold, TEXT)
        v?.sub?.let { text(c, fit(it, 23f, res.regular, maxW), x, r.top + 156f, 23f, res.regular, TEXT3) }
        when (k.show) {
            "updown" -> { p.color = when (v?.up) { true -> Color.parseColor("#5fcf8f"); false -> DANGER; else -> Color.parseColor("#3a3c4b") }; c.drawCircle(r.right - 36f, r.top + 38f, 9f, p) }
            "value" -> {}
            else -> {
                val by = r.bottom - 30f
                round(c, x, by, r.right - 26f, by + 6f, 3f, Color.parseColor("#3a3c4b"))
                val f = (v?.bar ?: 0.0).coerceIn(0.0, 1.0).toFloat()
                if (f > 0) round(c, x, by, x + (r.right - 26f - x) * f, by + 6f, 3f, ACCENT)
            }
        }
    }

    private fun drawNp(c: Canvas, r: RectF) {
        val n = np
        val side = min(206f, r.height() - 50f)
        val ax = r.left + 26f; val ay = r.top + (r.height() - side) / 2f
        val yb = r.top + (r.height() - 256f) / 2f
        val art = res.icon(n?.art)
        rf.set(ax, ay, ax + side, ay + side)
        if (art != null) {
            val sh = BitmapShader(art, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            val m = Matrix(); m.setRectToRect(RectF(0f, 0f, art.width.toFloat(), art.height.toFloat()), rf, Matrix.ScaleToFit.FILL); sh.setLocalMatrix(m)
            bp.color = Color.WHITE; bp.shader = sh; c.drawRoundRect(rf, 14f, 14f, bp); bp.shader = null
        } else {
            c.save(); path.reset(); path.addRoundRect(rf, 14f, 14f, Path.Direction.CW); c.clipPath(path)
            c.drawColor(Color.parseColor("#2a2b31"))
            p.color = Color.parseColor("#34363f"); p.style = Paint.Style.STROKE; p.strokeWidth = 18f * 1.414f / 1.414f * 1.0f
            var d = -side
            while (d < side * 2) { c.drawLine(ax + d, ay + side, ax + d + side, ay, p); d += 36f * 1.414f }
            p.style = Paint.Style.FILL
            c.restore()
            text(c, "album art", ax + side / 2, ay + side / 2 + 7f, 19f, res.mono, Color.parseColor("#9b9da8"), Paint.Align.CENTER)
        }
        val tx = ax + side + 30f; val maxW = r.right - 26f - tx
        text(c, "NOW PLAYING", tx, yb + 57f, 20f, res.medium, ACCENT2, spacing = 0.12f)
        text(c, fit(n?.title?.ifEmpty { null } ?: "Nothing playing", 30f, res.semibold, maxW), tx, yb + 99f, 30f, res.semibold, TEXT)
        val sub = if (n == null) "Windows media" else listOf(n.artist, n.source).filter { it.isNotEmpty() }.joinToString(" · ")
        text(c, fit(sub, 24f, res.regular, maxW), tx, yb + 140f, 24f, res.regular, Color.parseColor("#a9abb9"))
        round(c, tx, yb + 176f, r.right - 26f, yb + 182f, 3f, Color.parseColor("#3a3c4b"))
        var pos = n?.pos ?: 0.0
        if (n != null && n.playing) pos += (System.currentTimeMillis() - n.at) / 1000.0
        val dur = n?.dur ?: 0.0
        if (dur > 0) { pos = pos.coerceIn(0.0, dur); round(c, tx, yb + 176f, tx + (r.right - 26f - tx) * (pos / dur).toFloat(), yb + 182f, 3f, ACCENT) }
        text(c, if (dur > 0) "${mmss(pos)} / ${mmss(dur)}" else "0:00 / 0:00", tx, yb + 208f, 20f, res.regular, TEXT3)
    }
    private fun mmss(s: Double): String { val t = s.roundToInt(); return "${t / 60}:${(t % 60).toString().padStart(2, '0')}" }

    /* ---------------- sliders ---------------- */
    private fun stripX(pg: DPage, i: Int, dx: Float): Float {
        val left = if (pg.stripLeft) PAD else W - PAD - stripW(pg.strip.size)
        return left + dx + SBTN / 2f + i * (SBTN + SLIDER_GAP)
    }

    private fun drawStrip(c: Canvas, pg: DPage, dx: Float) {
        pg.strip.forEachIndexed { i, s ->
            if (s == null) return@forEachIndexed
            val cx = stripX(pg, i, dx)
            val st = sliders[s.id]
            val enabled = st?.enabled ?: true
            val v = (if (dragSlider?.id == s.id) dragValue else st?.value ?: 0).coerceIn(0, 100)
            text(c, fit(s.label, 22f, res.regular, 130f), cx, 158f, 22f, res.regular, if (enabled) Color.parseColor("#a7a9b8") else TEXT3, Paint.Align.CENTER)
            text(c, if (enabled) "$v" else "—", cx, 208f, 26f, res.semibold, if (enabled) TEXT else TEXT3, Paint.Align.CENTER)
            round(c, cx - 6f, TRACK_TOP, cx + 6f, TRACK_BOTTOM, 6f, Color.parseColor("#3b3d4c"))
            val fy = TRACK_BOTTOM - (TRACK_BOTTOM - TRACK_TOP) * v / 100f
            if (enabled) {
                for ((w, a) in listOf(30f to 14, 20f to 26)) round(c, cx - w / 2, fy, cx + w / 2, TRACK_BOTTOM + (w - 12) / 2, w / 2, Color.argb(a, 143, 132, 230))
                p.color = Color.WHITE; p.shader = LinearGradient(0f, TRACK_TOP, 0f, TRACK_BOTTOM, Color.parseColor("#9489e8"), Color.parseColor("#6c5fbd"), Shader.TileMode.CLAMP)
                rf.set(cx - 6f, fy, cx + 6f, TRACK_BOTTOM); c.drawRoundRect(rf, 6f, 6f, p); p.shader = null
            } else round(c, cx - 6f, fy, cx + 6f, TRACK_BOTTOM, 6f, Color.parseColor("#4a4c5a"))
            // thumb
            round(c, cx - 42f, fy - 14f, cx + 42f, fy + 26f, 12f, Color.argb(70, 0, 0, 0))
            round(c, cx - 41f, fy - 16f, cx + 41f, fy + 23f, 11f, Color.argb(60, 0, 0, 0))
            p.color = Color.WHITE; p.shader = LinearGradient(0f, fy - 18f, 0f, fy + 18f, if (enabled) Color.parseColor("#dcdfe9") else Color.parseColor("#777a88"), if (enabled) Color.parseColor("#a8acbf") else Color.parseColor("#5d606e"), Shader.TileMode.CLAMP)
            rf.set(cx - 40f, fy - 18f, cx + 40f, fy + 18f); c.drawRoundRect(rf, 10f, 10f, p); p.shader = null
            p.color = Color.argb(if (enabled) 200 else 60, 255, 255, 255); c.drawRect(cx - 30f, fy - 17f, cx + 30f, fy - 16f, p)
            // button
            if (s.button != "none") {
                val pressedBtn = pressedSliderBtn?.id == s.id
                p.color = Color.WHITE; p.shader = keyShader(SBTN); c.save(); c.translate(cx - SBTN / 2, SBTN_TOP)
                if (pressedBtn) c.scale(0.95f, 0.95f, SBTN / 2, SBTN / 2)
                rf.set(0f, 0f, SBTN, SBTN); c.drawRoundRect(rf, 18f, 18f, p); p.shader = null
                stroke(c, 1f, 1f, SBTN - 1f, SBTN - 1f, 17f, Color.parseColor("#2c2e3d"), 2f)
                c.restore()
                val muted = st?.muted == true
                val g = when { s.control == "mic" -> if (muted) "mic-off" else "mic"; muted -> "volume-x"; s.control == "master" -> "volume-2"; else -> "volume-1" }
                glyph(c, g, cx, SBTN_TOP + SBTN / 2, 38f, if (muted) DANGER else Color.parseColor("#d9d9e3"))
            }
        }
    }

    /* ---------------- dots ---------------- */
    private fun drawDots(c: Canvas, lay: Layout, pg: DPage) {
        val y = if (pg.hasStrip) 1136f else min(1136f, TOP + geom(pg).gridH + 52f)
        if (lay.page(pg.parent) != null) { round(c, W / 2 - 14f, y - 3f, W / 2 + 14f, y + 3f, 3f, ACCENT); return }
        val n = lay.roots.size; if (n < 2) return
        val idx = lay.roots.indexOfFirst { it.id == pg.id }
        val total = 28f + (n - 1) * 6f + (n - 1) * 12f
        var x = W / 2 - total / 2
        for (i in 0 until n) {
            val w = if (i == idx) 28f else 6f
            round(c, x, y - 3f, x + w, y + 3f, 3f, if (i == idx) ACCENT else Color.parseColor("#4a4c5e"))
            x += w + 12f
        }
    }

    /* ---------------- disconnected ---------------- */
    private val spinStart = System.currentTimeMillis()
    private fun drawDisconnected(c: Canvas) {
        val x = 113f
        glyph(c, "unplug", x + 60f, 339f, 120f, Color.parseColor("#7b6fd0"))
        text(c, "Can't reach desktop", x, 533f, 78f, res.semibold, Color.parseColor("#eceaf5"))
        val wifiLine = when {
            myIp == null -> "Wi-Fi · not connected"
            lastPeer != null && lastPeer != "127.0.0.1" -> "Wi-Fi · $lastPeer:${Link.PORT} — timed out"
            else -> "Wi-Fi · waiting on $myIp:${Link.PORT}"
        }
        val wifiWaiting = myIp != null && (lastPeer == null || lastPeer == "127.0.0.1")
        statusLine(c, x, 642f, wifiLine, spinning = wifiWaiting, bright = false)
        statusLine(c, x, 755f, if (usbPlugged) "USB (ADB) — connecting…" else "USB (ADB) — not plugged in", spinning = usbPlugged, bright = usbPlugged)
        text(c, "Keys unlock when either link is back. Is the desktop app open?", x, 900f, 48f, res.regular, TEXT3)
        val me = myIp?.let { "This device · $it · port ${Link.PORT}  (type this into Deck IP on the desktop)" } ?: "This device · no Wi-Fi · use USB only on the desktop"
        text(c, me, x, 1010f, 34f, res.mono, Color.parseColor("#7b7e92"))
    }
    private fun drawWaiting(c: Canvas, lay: Layout?) {
        val x = 113f
        glyph(c, "check", x + 60f, 339f, 120f, ACCENT)
        text(c, "Connected to desktop", x, 533f, 78f, res.semibold, Color.parseColor("#eceaf5"))
        val how = (if (link == "usb") "USB" else "Wi-Fi") + " · $rtt ms"
        statusLine(c, x, 642f, how, spinning = false, bright = true, icon = "check")
        text(c, if (lay == null) "Waiting for the layout from the editor…" else "No pages yet. Add one in the Deckwell editor.", x, 780f, 48f, res.regular, TEXT3)
    }

    /* ---------------- pairing ---------------- */
    private val cancelBtn = RectF(113f, 960f, 553f, 1080f)
    private val pairBtn = RectF(593f, 960f, 1033f, 1080f)
    private var pairDown = 0 // 1 = Cancel held, 2 = Pair held

    private fun drawPairing(c: Canvas, pr: Link.PairPrompt) {
        val x = 113f
        glyph(c, "link", x + 60f, 250f, 120f, ACCENT)
        text(c, fit("Pair with ${pr.desktopName}?", 78f, res.semibold, W - 2 * x), x, 444f, 78f, res.semibold, Color.parseColor("#eceaf5"))
        val code = pr.code
        if (code == null) {
            statusLine(c, x, 640f, "Setting up a secure link…", spinning = true, bright = true)
        } else {
            text(c, code.substring(0, 3) + " " + code.substring(3), x - 8f, 720f, 220f, res.monoBold, ACCENT2, spacing = 0.04f)
            if (pr.approved) statusLine(c, x, 838f, "Now type the code into Deckwell on your computer.", spinning = true, bright = true)
            else text(c, "Type this code into Deckwell on your computer, then tap Pair.", x, 856f, 50f, res.regular, TEXT2)
        }
        round(c, cancelBtn.left, cancelBtn.top, cancelBtn.right, cancelBtn.bottom, 26f, if (pairDown == 1) Color.parseColor("#2c2e3d") else Color.parseColor("#222433"))
        stroke(c, cancelBtn.left, cancelBtn.top, cancelBtn.right, cancelBtn.bottom, 26f, Color.parseColor("#3a3c4e"), 3f)
        text(c, "Cancel", cancelBtn.centerX(), cancelBtn.centerY() + 20f, 54f, res.medium, TEXT, Paint.Align.CENTER)
        if (code != null && !pr.approved) {
            round(c, pairBtn.left, pairBtn.top, pairBtn.right, pairBtn.bottom, 26f, if (pairDown == 2) ACCENT2 else ACCENT)
            text(c, "Pair", pairBtn.centerX(), pairBtn.centerY() + 20f, 54f, res.semibold, Color.parseColor("#14152a"), Paint.Align.CENTER)
        }
    }

    private fun pairTouch(e: MotionEvent, x: Float, y: Float): Boolean {
        val pr = pair ?: return false
        val canPair = pr.code != null && !pr.approved
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { pairDown = if (cancelBtn.contains(x, y)) 1 else if (canPair && pairBtn.contains(x, y)) 2 else 0; invalidate() }
            MotionEvent.ACTION_UP -> {
                if (pairDown == 1 && cancelBtn.contains(x, y)) cb.pairCancel()
                else if (pairDown == 2 && canPair && pairBtn.contains(x, y)) cb.pairApprove()
                pairDown = 0; invalidate()
            }
            MotionEvent.ACTION_CANCEL -> { pairDown = 0; invalidate() }
        }
        return true
    }

    private fun statusLine(c: Canvas, x: Float, cy: Float, s: String, spinning: Boolean, bright: Boolean, icon: String = "x") {
        if (icon != "x") glyph(c, icon, x + 20f, cy, 40f, ACCENT)
        else if (spinning) {
            c.save(); c.rotate(((System.currentTimeMillis() - spinStart) % 1200) / 1200f * 360f, x + 20f, cy)
            glyph(c, "loader", x + 20f, cy, 42f, Color.parseColor("#8a84b8")); c.restore()
        } else glyph(c, "x", x + 20f, cy, 40f, TEXT3)
        text(c, s, x + 70f, cy + 18f, 50f, res.regular, if (bright) Color.parseColor("#e2e1ea") else TEXT2)
    }

    /* ---------------- touch ---------------- */
    private var pressedKey: DKey? = null
    private var pressedRect = RectF()
    private var holdSent = false
    private var pressedSliderBtn: DSlider? = null
    private var dragSlider: DSlider? = null
    private var dragValue = 0
    private var lastSliderSend = 0L
    private var downX = 0f; private var downY = 0f
    private var swiping = false
    private var pageOffset = 0f
    private var anim: ValueAnimator? = null
    private var velX = 0f; private var lastMoveX = 0f; private var lastMoveT = 0L

    private fun neighbor(lay: Layout, pg: DPage, dir: Int): DPage? {
        if (lay.page(pg.parent) != null) return null
        val i = lay.roots.indexOfFirst { it.id == pg.id }
        return lay.roots.getOrNull(i + dir)
    }

    private fun hitKey(lay: Layout, pg: DPage, x: Float, y: Float): Pair<DKey, RectF>? {
        val g = geom(pg); val r = RectF()
        for (k in lay.keysOf(pg)) { keyRect(g, k.row, k.col, min(k.span, pg.cols - k.col), 0f, r); if (r.contains(x, y)) return k to r }
        return null
    }

    private fun sliderAt(pg: DPage, x: Float, y: Float, button: Boolean): DSlider? {
        if (!pg.hasStrip) return null
        pg.strip.forEachIndexed { i, s ->
            if (s == null) return@forEachIndexed
            val cx = stripX(pg, i, 0f)
            if (button) { if (s.button != "none" && abs(x - cx) < SBTN / 2 + 8 && y in SBTN_TOP - 8..SBTN_TOP + SBTN + 8) return s }
            else if (abs(x - cx) < 64f && y in 130f..(TRACK_BOTTOM + 10f)) return s
        }
        return null
    }

    private fun sliderValue(s: DSlider, y: Float): Int {
        val raw = ((TRACK_BOTTOM - y) / (TRACK_BOTTOM - TRACK_TOP) * 100f).coerceIn(0f, 100f)
        val step = s.step.coerceIn(1.0, 25.0)
        return ((raw / step).roundToInt() * step).roundToInt().coerceIn(0, 100)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val x = (e.x - ox) / sc; val y = (e.y - oy) / sc
        if (pairTouch(e, x, y)) return true
        val lay = layout; val pg = lay?.page(pageId)
        if (!connected || lay == null || pg == null) return true
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                anim?.cancel(); if (pageOffset != 0f) settle(lay, pg)
                downX = x; downY = y; swiping = false; lastMoveX = x; lastMoveT = e.eventTime; velX = 0f
                sliderAt(pg, x, y, button = true)?.let { pressedSliderBtn = it; invalidate(); return true }
                sliderAt(pg, x, y, button = false)?.let { s ->
                    dragSlider = s; dragValue = sliderValue(s, y); cb.slider(s, dragValue); lastSliderSend = e.eventTime; invalidate(); return true
                }
                hitKey(lay, pg, x, y)?.let { (k, r) ->
                    pressedKey = k; pressedRect.set(r); holdSent = false
                    if (k.hold) { cb.press(k); holdSent = true }
                    invalidate()
                }
            }
            MotionEvent.ACTION_MOVE -> {
                dragSlider?.let { s ->
                    val v = sliderValue(s, y)
                    if (v != dragValue) { dragValue = v; invalidate(); if (e.eventTime - lastSliderSend > 40) { cb.slider(s, v); lastSliderSend = e.eventTime } }
                    return true
                }
                val dx = x - downX
                if (!swiping && abs(dx) > 34f && abs(dx) > abs(y - downY) * 1.2f && lay.page(pg.parent) == null && lay.roots.size > 1) {
                    swiping = true
                    pressedKey?.let { if (holdSent) cb.release(it) }; pressedKey = null; pressedSliderBtn = null
                }
                if (swiping) {
                    val dt = (e.eventTime - lastMoveT).coerceAtLeast(1)
                    velX = (x - lastMoveX) / dt; lastMoveX = x; lastMoveT = e.eventTime
                    val hasNext = neighbor(lay, pg, if (dx < 0) 1 else -1) != null
                    pageOffset = if (hasNext) dx else dx * 0.3f
                    invalidate()
                } else if (pressedKey != null && !pressedRect.contains(x, y) && abs(y - downY) + abs(dx) > 40f) {
                    pressedKey?.let { if (holdSent) cb.release(it) }; pressedKey = null; invalidate()
                }
            }
            MotionEvent.ACTION_UP -> {
                dragSlider?.let { s -> cb.slider(s, dragValue); sliders[s.id] = SliderState(dragValue, sliders[s.id]?.enabled ?: true, sliders[s.id]?.muted ?: false); dragSlider = null; holdIncoming[s.id] = e.eventTime + 900; invalidate(); return true }
                pressedSliderBtn?.let { s -> if (sliderAt(pg, x, y, button = true)?.id == s.id) cb.sliderButton(s); pressedSliderBtn = null; invalidate(); return true }
                if (swiping) { finishSwipe(lay, pg); return true }
                val k = pressedKey; pressedKey = null
                if (k != null) {
                    if (holdSent) { cb.release(k); k.go?.let { navigate(it) } }
                    else if (pressedRect.contains(x, y)) tap(lay, pg, k)
                }
                invalidate()
            }
            MotionEvent.ACTION_CANCEL -> {
                pressedKey?.let { if (holdSent) cb.release(it) }; pressedKey = null; pressedSliderBtn = null; dragSlider = null
                if (swiping) finishSwipe(lay, pg)
                invalidate()
            }
        }
        return true
    }

    /** Incoming slider values are ignored briefly after a drag so the thumb doesn't jump back. */
    val holdIncoming = HashMap<String, Long>()
    fun sliderDragging(id: String) = dragSlider?.id == id || (holdIncoming[id] ?: 0) > android.os.SystemClock.uptimeMillis()

    private fun tap(lay: Layout, pg: DPage, k: DKey) {
        when {
            k.isBack -> navigate(pg.parent)
            k.nav != null -> { if (k.fire) { cb.press(k); cb.release(k) }; navigate(k.nav) }
            else -> { cb.press(k); cb.release(k); k.go?.let { navigate(it) } }
        }
    }

    fun navigate(id: String?) {
        val lay = layout ?: return
        if (lay.page(id) == null) return
        pageId = id; pageOffset = 0f; cb.pageChanged(id!!); invalidate()
    }

    private fun finishSwipe(lay: Layout, pg: DPage) {
        swiping = false
        val dir = if (pageOffset < 0) 1 else -1
        val target = neighbor(lay, pg, dir)
        val go = target != null && (abs(pageOffset) > W * 0.22f || abs(velX) > 1.2f && Math.signum(velX) == Math.signum(pageOffset))
        val end = if (go) -dir * W else 0f
        anim = ValueAnimator.ofFloat(pageOffset, end).apply {
            duration = 240; interpolator = DecelerateInterpolator(1.6f)
            addUpdateListener { pageOffset = it.animatedValue as Float; invalidate() }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: Animator) { if (go && target != null) navigate(target.id) else { pageOffset = 0f; invalidate() } }
            })
            start()
        }
    }

    private fun settle(lay: Layout, pg: DPage) {
        pageOffset = 0f
    }
}
