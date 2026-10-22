package com.oscardevelopments.deckwell

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import org.robolectric.RuntimeEnvironment
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Renders the deck offscreen so the look can be checked against the mockup without a device. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [33], qualifiers = "w1920dp-h1200dp-land-mdpi")
class RenderTest {
    private val cb = object : DeckView.Callbacks {
        override fun press(k: DKey) {}
        override fun release(k: DKey) {}
        override fun slider(s: DSlider, value: Int) {}
        override fun sliderButton(s: DSlider) {}
        override fun pageChanged(id: String) {}
        override fun pairApprove() {}
        override fun pairCancel() {}
    }

    private fun render(name: String, setup: (DeckView) -> Unit) {
        val ctx = RuntimeEnvironment.getApplication()
        val v = DeckView(ctx, Res(ctx), cb)
        setup(v)
        v.measure(View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1200, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, 1920, 1200)
        val b = Bitmap.createBitmap(1920, 1200, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(b))
        val out = File(System.getProperty("render.out") ?: "build/render"); out.mkdirs()
        File(out, "$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun layout(): Layout = Layout.parse(JSONObject(File(System.getProperty("layout.json")!!).readText()))

    @Test fun main() = render("deck_main") { v ->
        val l = layout(); v.layout = l; v.connected = true; v.rtt = 12; v.pageId = l.roots[0].id
        v.np = NowPlaying("Midnight City", "M83", "Spotify", 97.0, 243.0, false, null, System.currentTimeMillis())
        val strip = l.roots[0].strip
        listOf(64, 40, 82).forEachIndexed { i, x -> strip[i]?.let { s -> v.sliders[s.id] = SliderState(x, true, false) } }
        val st = l.roots[0].keys.filter { it.kind == "status" }
        v.status[st[0].id] = StatusValue("18%", "load 0.42", 0.18, null)
        v.status[st[1].id] = StatusValue("12%", "queries blocked", 0.12, null)
    }

    @Test fun folder() = render("deck_folder") { v ->
        val l = layout(); v.layout = l; v.connected = true; v.rtt = 14
        val f = l.pages.first { it.parent != null }; v.pageId = f.id
        val ssh = f.keys.filter { it.kind == "key" }
        v.feedback[ssh[0].id] = Feedback(true, true, null, null, System.currentTimeMillis() + 60000)
        v.feedback[ssh[2].id] = Feedback(false, false, "exit 255", null, System.currentTimeMillis() + 60000)
        v.feedback[ssh[1].id] = Feedback(true, false, null, "58, 97 %", System.currentTimeMillis() + 60000)
        v.toast = Toast("my-server · uptime · 0.4 s", true, System.currentTimeMillis() + 60000)
        f.keys.filter { it.kind == "status" }.take(1).forEach { v.status[it.id] = StatusValue("18%", "4 cores", 0.18, null) }
    }

    @Test fun offline() = render("deck_offline") { v ->
        v.layout = layout(); v.connected = false; v.myIp = "192.168.1.42"; v.lastPeer = "192.168.1.20"; v.usbPlugged = true
    }

    @Test fun pairingCode() = render("deck_pairing") { v ->
        v.pair = Link.PairPrompt("RSM-DESKTOP", "098195", false)
    }

    @Test fun pairingWaiting() = render("deck_pairing_approved") { v ->
        v.pair = Link.PairPrompt("RSM-DESKTOP", "098195", true)
    }

    private fun sliderPage(n: Int, side: String): Layout {
        val strip = org.json.JSONArray()
        for (i in 0 until n) strip.put(JSONObject().put("id", "s$i").put("control", listOf("master", "app", "mic")[i % 3]).put("label", listOf("Master", "Spotify", "Mic", "Discord", "Chrome", "Game")[i]).put("button", "mute"))
        val keys = org.json.JSONArray()
        for (r in 0 until 3) for (c in 0 until 4) keys.put(JSONObject().put("id", "k$r$c").put("row", r).put("col", c).put("kind", "key").put("label", "Key ${r * 4 + c + 1}").put("glyph", "zap"))
        val page = JSONObject().put("id", "p").put("name", "Sliders").put("cols", 4).put("rows", 3).put("keys", keys).put("strip", strip).put("side", side)
        return Layout.parse(JSONObject().put("pages", org.json.JSONArray().put(page)))
    }

    @Test fun sixSlidersLeft() = render("deck_sliders_6_left") { v ->
        v.layout = sliderPage(6, "left"); v.connected = true
        for (i in 0 until 6) v.sliders["s$i"] = SliderState(listOf(70, 40, 85, 55, 30, 65)[i], true, i == 2)
    }

    @Test fun oneSliderRight() = render("deck_sliders_1_right") { v ->
        v.layout = sliderPage(1, "right"); v.connected = true
        v.sliders["s0"] = SliderState(60, true, false)
        v.status["k00"] = StatusValue("72%", "4 cores", 0.72, true)
    }
}
