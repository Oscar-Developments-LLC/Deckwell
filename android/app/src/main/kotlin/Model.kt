package com.oscardevelopments.deckwell

import org.json.JSONArray
import org.json.JSONObject

/** Layout pushed from the desktop. The deck only renders it and reports touches. */
class DKey(
    val id: String, val row: Int, val col: Int, val span: Int, val kind: String,
    val label: String, val labelPos: String, val glyph: String?, val sub: String?, val mono: String?,
    val caps: List<String>?, val icon: String?, val nav: String?, val title: String?, val show: String?, val hold: Boolean,
    /** Page to show after the press runs (app keys with a custom page). */
    val go: String? = null,
    /** Folder / go-to keys with extra steps also report the press to the desktop. */
    val fire: Boolean = false,
    /** Height in keys (panels are 1 to 3 tall; everything else is 1). */
    val vspan: Int = 1,
) {
    val isBack get() = kind == "back"

    /** The same key at another spot and size (used for the portrait grid). */
    fun at(r: Int, c: Int, w: Int, h: Int) = DKey(id, r, c, w, kind, label, labelPos, glyph, sub, mono, caps, icon, nav, title, show, hold, go, fire, h)

    companion object {
        fun parse(o: JSONObject) = DKey(
            o.optString("id"), o.optInt("row"), o.optInt("col"), o.optInt("span", 1).coerceIn(1, 4), o.optString("kind", "key"),
            o.optString("label"), o.optString("labelPos", "bottom"), o.optStr("glyph"), o.optStr("sub"), o.optStr("mono"),
            o.optJSONArray("caps")?.let { a -> (0 until a.length()).map { a.optString(it) } }, o.optStr("icon"), o.optStr("nav"),
            o.optStr("title"), o.optStr("show"), o.optBoolean("hold"), o.optStr("go"), o.optBoolean("fire"),
            o.optInt("vspan", 1).coerceIn(1, 3),
        )

        fun back(parentName: String, row: Int = 0, col: Int = 0) = DKey("__back", row, col, 1, "back", "Back", "bottom", "back", parentName, null, null, null, null, null, null, false)
    }
}

class DSlider(val id: String, val label: String, val control: String, val button: String, val step: Double) {
    companion object {
        fun parse(o: JSONObject) = DSlider(o.optString("id"), o.optString("label"), o.optString("control", "master"), o.optString("button", "mute"), o.optDouble("step", 1.0))
    }
}

/**
 * stripSide is "left" or "right" in landscape; portraitSide is "top" or "bottom" in portrait.
 * An empty strip means the page has no sliders. portraitOrder is "reading" or "mirror" (see Portrait).
 */
class DPage(val id: String, val name: String, val parent: String?, val cols: Int, val rows: Int, val keys: List<DKey>, val strip: List<DSlider?>,
            val stripSide: String = "right", val portraitOrder: String = "reading", val portraitSide: String = "bottom",
            /** Where a folder page's Back key sits (top-left unless the user moved it). */
            val backRow: Int = 0, val backCol: Int = 0) {
    val hasStrip get() = strip.isNotEmpty()
    val stripLeft get() = hasStrip && stripSide == "left"
    val stripTop get() = hasStrip && portraitSide == "top"

    companion object {
        fun parse(o: JSONObject): DPage {
            val keys = ArrayList<DKey>()
            o.optJSONArray("keys")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let { keys.add(DKey.parse(it)) } }
            val strip = ArrayList<DSlider?>()
            o.optJSONArray("strip")?.let { a -> for (i in 0 until a.length()) strip.add(a.optJSONObject(i)?.let { DSlider.parse(it) }) }
            val cols = o.optInt("cols", 5).coerceIn(1, 8)
            val rows = o.optInt("rows", 3).coerceIn(1, 6)
            // Empty slots still take up room, so the deck matches the editor's preview exactly.
            return DPage(o.optString("id"), o.optString("name"), o.optStr("parent"), cols, rows,
                keys.filter { it.row < rows && it.col < cols }, strip.take(6), if (o.optString("side") == "left") "left" else "right",
                if (o.optString("porder") == "mirror") "mirror" else "reading", if (o.optString("pside") == "top") "top" else "bottom",
                o.optInt("backRow", 0).let { if (it in 0 until rows) it else 0 }, o.optInt("backCol", 0).let { if (it in 0 until cols) it else 0 })
        }
    }
}

/** orient is "landscape", "portrait" or "auto" (follow the tablet's rotation). */
class Layout(val pages: List<DPage>, val orient: String = "landscape") {
    private val byId = pages.associateBy { it.id }
    val roots = pages.filter { it.parent == null || byId[it.parent] == null }
    fun page(id: String?) = if (id == null) null else byId[id]

    fun keysOf(p: DPage): List<DKey> {
        val parent = page(p.parent)
        if (parent == null) return p.keys
        // A key that covers the Back key's spot is hidden, the same as in the editor.
        val r = p.backRow; val c = p.backCol
        return listOf(DKey.back(parent.name, r, c)) + p.keys.filterNot { r >= it.row && r < it.row + it.vspan && c >= it.col && c < it.col + it.span }
    }

    fun iconIds(): Set<String> = pages.flatMap { p -> p.keys.mapNotNull { it.icon } }.toSet()

    companion object {
        fun parse(o: JSONObject): Layout {
            val a: JSONArray = o.optJSONArray("pages") ?: JSONArray()
            val orient = when (o.optString("orient")) { "portrait" -> "portrait"; "auto" -> "auto"; else -> "landscape" }
            return Layout((0 until a.length()).mapNotNull { a.optJSONObject(it)?.let { p -> DPage.parse(p) } }, orient)
        }
    }
}

class NowPlaying(val title: String, val artist: String, val source: String, val pos: Double, val dur: Double, val playing: Boolean, val art: String?, val at: Long)
class SliderState(val value: Int, val enabled: Boolean, val muted: Boolean)
class StatusValue(val value: String?, val sub: String?, val bar: Double?, val up: Boolean?)
class PanelValue(val lines: List<String>, val up: Boolean?)
class Feedback(val ok: Boolean, val ring: Boolean, val badge: String?, val line: String?, val until: Long)
class Toast(val text: String, val ok: Boolean, val until: Long)

fun JSONObject.optStr(k: String): String? = if (isNull(k) || !has(k)) null else optString(k).takeIf { it.isNotEmpty() }

/** The window picker a Window picker key opens on the deck. See docs/PROTOCOL.md ("winpick"). */
class WinItem(val id: String, val app: String, val title: String?, val icon: String?)
class SnapZone(val id: String, val name: String, val x: Double, val y: Double, val w: Double, val h: Double)
class Monitor(val id: String, val name: String, val x: Int, val y: Int, val w: Int, val h: Int, val main: Boolean, val zones: List<SnapZone>)
class WinPick(val key: String, val wins: List<WinItem>, val mons: List<Monitor>) {
    /** Steps: 1 window, 2 display (skipped with one display), 3 size (Maximize, Half, ...), 4 the spot inside that size. */
    var win: WinItem? = null
    var mon = mons.indexOfFirst { it.main }.coerceAtLeast(0)
    /** True once a display is chosen, or right away when there's only one. */
    var monPicked = false
    /** The size picked on step 3 (a Group id, or "zones"). Null while on step 3. */
    var group: String? = null
    var scroll = 0f

    companion object {
        fun parse(m: JSONObject): WinPick {
            val wins = ArrayList<WinItem>()
            m.optJSONArray("wins")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let { o -> wins.add(WinItem(o.optString("id"), o.optString("app"), o.optStr("title"), o.optStr("icon"))) } }
            val mons = ArrayList<Monitor>()
            m.optJSONArray("mons")?.let { a ->
                for (i in 0 until a.length()) a.optJSONObject(i)?.let { o ->
                    val zones = ArrayList<SnapZone>()
                    o.optJSONArray("zones")?.let { z -> for (j in 0 until z.length()) z.optJSONObject(j)?.let { q ->
                        zones.add(SnapZone(q.optString("id"), q.optString("name"), q.optDouble("x", 0.0), q.optDouble("y", 0.0), q.optDouble("w", 1.0), q.optDouble("h", 1.0)))
                    } }
                    mons.add(Monitor(o.optString("id"), o.optString("name"), o.optInt("x"), o.optInt("y"), o.optInt("w", 1920).coerceAtLeast(1), o.optInt("h", 1080).coerceAtLeast(1), o.optBoolean("main"), zones))
                }
            }
            return WinPick(m.optString("key"), wins, mons)
        }

        /** Built-in spots: id, name, and the part of the screen (x, y, w, h as fractions). Matches desktop/SnapSpots.cs. */
        val SPOTS = listOf(
            Spot("max", "Maximize", 0.0, 0.0, 1.0, 1.0), Spot("left", "Left half", 0.0, 0.0, 0.5, 1.0), Spot("right", "Right half", 0.5, 0.0, 0.5, 1.0),
            Spot("top", "Top half", 0.0, 0.0, 1.0, 0.5), Spot("bottom", "Bottom half", 0.0, 0.5, 1.0, 0.5),
            Spot("third-l", "Left third", 0.0, 0.0, 1 / 3.0, 1.0), Spot("third-c", "Middle third", 1 / 3.0, 0.0, 1 / 3.0, 1.0), Spot("third-r", "Right third", 2 / 3.0, 0.0, 1 / 3.0, 1.0),
            Spot("two-l", "Left two-thirds", 0.0, 0.0, 2 / 3.0, 1.0), Spot("two-r", "Right two-thirds", 1 / 3.0, 0.0, 2 / 3.0, 1.0),
            Spot("tl", "Top left", 0.0, 0.0, 0.5, 0.5), Spot("tr", "Top right", 0.5, 0.0, 0.5, 0.5), Spot("bl", "Bottom left", 0.0, 0.5, 0.5, 0.5), Spot("br", "Bottom right", 0.5, 0.5, 0.5, 0.5),
            Spot("center", "Center", 0.15, 0.1, 0.7, 0.8),
        )
        fun spot(id: String): Spot? = SPOTS.firstOrNull { it.id == id }

        /** Sizes on step 3. A size with one spot moves the window right away; the others open step 4.
         *  [preview] is what its tile draws. A monitor's own zones are added after these as "Your zones". */
        val GROUPS = listOf(
            Group("max", "Maximize", "", listOf("max"), listOf("max")),
            Group("half", "Half", "Which half?", listOf("left", "right", "top", "bottom"), listOf("left", "right")),
            Group("third", "Third", "Which third?", listOf("third-l", "third-c", "third-r"), listOf("third-l", "third-c", "third-r")),
            Group("two", "Two-thirds", "Which two-thirds?", listOf("two-l", "two-r"), listOf("two-l")),
            Group("corner", "Corner", "Which corner?", listOf("tl", "tr", "bl", "br"), listOf("tl", "tr", "bl", "br")),
            Group("center", "Center", "", listOf("center"), listOf("center")),
        )
    }
}
class Group(val id: String, val name: String, val ask: String, val spots: List<String>, val preview: List<String>)
class Spot(val id: String, val name: String, val x: Double, val y: Double, val w: Double, val h: Double)
