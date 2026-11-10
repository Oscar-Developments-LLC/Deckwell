package com.oscardevelopments.deckwell

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** The deck's portrait grid must match the editor's preview: shared/portrait-vector.json is made from desktop/ui/portrait.js. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class PortraitTest {
    @Test fun matchesEditor() {
        val v = JSONObject(File(System.getProperty("portrait.vector")!!).readText())
        val cases = v.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val ka = c.getJSONArray("keys")
            val keys = (0 until ka.length()).map { j ->
                val o = ka.getJSONObject(j)
                DKey(o.getString("id"), o.getInt("row"), o.getInt("col"), o.getInt("w"), "key", "", "bottom", null, null, null, null, null, null, null, null, false, vspan = o.getInt("h"))
            }
            val g = Portrait.of(keys, c.getInt("cols"), c.getInt("rows"), c.getString("mode"))
            val e = c.getJSONObject("expect")
            val name = c.getString("name") + " / " + c.getString("mode")
            assertEquals("$name cols", e.getInt("cols"), g.cols)
            assertEquals("$name rows", e.getInt("rows"), g.rows)
            val ea = e.getJSONArray("keys")
            val want = (0 until ea.length()).map { j -> ea.getJSONObject(j).let { "${it.getString("id")}@${it.getInt("row")},${it.getInt("col")} ${it.getInt("w")}x${it.getInt("h")}" } }
            val got = g.keys.map { "${it.id}@${it.row},${it.col} ${it.span}x${it.vspan}" }
            assertEquals(name, want, got)
        }
        println("PortraitTest: ${cases.length()} cases match the editor")
    }
}
