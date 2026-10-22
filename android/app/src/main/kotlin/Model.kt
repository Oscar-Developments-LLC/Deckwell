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
) {
    val isBack get() = kind == "back"

    companion object {
        fun parse(o: JSONObject) = DKey(
            o.optString("id"), o.optInt("row"), o.optInt("col"), o.optInt("span", 1).coerceIn(1, 2), o.optString("kind", "key"),
            o.optString("label"), o.optString("labelPos", "bottom"), o.optStr("glyph"), o.optStr("sub"), o.optStr("mono"),
            o.optJSONArray("caps")?.let { a -> (0 until a.length()).map { a.optString(it) } }, o.optStr("icon"), o.optStr("nav"),
            o.optStr("title"), o.optStr("show"), o.optBoolean("hold"), o.optStr("go"), o.optBoolean("fire"),
        )

        fun back(parentName: String) = DKey("__back", 0, 0, 1, "back", "Back", "bottom", "back", parentName, null, null, null, null, null, null, false)
    }
}

class DSlider(val id: String, val label: String, val control: String, val button: String, val step: Double) {
    companion object {
        fun parse(o: JSONObject) = DSlider(o.optString("id"), o.optString("label"), o.optString("control", "master"), o.optString("button", "mute"), o.optDouble("step", 2.0))
    }
}

/** stripSide is "left" or "right"; an empty strip means the page has no sliders. */
class DPage(val id: String, val name: String, val parent: String?, val cols: Int, val rows: Int, val keys: List<DKey>, val strip: List<DSlider?>,
            val stripSide: String = "right") {
    val hasStrip get() = strip.isNotEmpty()
    val stripLeft get() = hasStrip && stripSide == "left"

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
                keys.filter { it.row < rows && it.col < cols }, strip.take(6), if (o.optString("side") == "left") "left" else "right")
        }
    }
}

class Layout(val pages: List<DPage>) {
    private val byId = pages.associateBy { it.id }
    val roots = pages.filter { it.parent == null || byId[it.parent] == null }
    fun page(id: String?) = if (id == null) null else byId[id]

    fun keysOf(p: DPage): List<DKey> {
        val parent = page(p.parent)
        return if (parent != null) listOf(DKey.back(parent.name)) + p.keys.filterNot { it.row == 0 && it.col == 0 } else p.keys
    }

    fun iconIds(): Set<String> = pages.flatMap { p -> p.keys.mapNotNull { it.icon } }.toSet()

    companion object {
        fun parse(o: JSONObject): Layout {
            val a: JSONArray = o.optJSONArray("pages") ?: JSONArray()
            return Layout((0 until a.length()).mapNotNull { a.optJSONObject(it)?.let { p -> DPage.parse(p) } })
        }
    }
}

class NowPlaying(val title: String, val artist: String, val source: String, val pos: Double, val dur: Double, val playing: Boolean, val art: String?, val at: Long)
class SliderState(val value: Int, val enabled: Boolean, val muted: Boolean)
class StatusValue(val value: String?, val sub: String?, val bar: Double?, val up: Boolean?)
class Feedback(val ok: Boolean, val ring: Boolean, val badge: String?, val line: String?, val until: Long)
class Toast(val text: String, val ok: Boolean, val until: Long)

fun JSONObject.optStr(k: String): String? = if (isNull(k) || !has(k)) null else optString(k).takeIf { it.isNotEmpty() }
