package com.oscardevelopments.deckwell

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import org.robolectric.RuntimeEnvironment
import org.json.JSONObject
import org.junit.Assert.assertEquals
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

    private fun render(name: String, w: Int = 1920, h: Int = 1200, setup: (DeckView) -> Unit) {
        val ctx = RuntimeEnvironment.getApplication()
        val v = DeckView(ctx, Res(ctx), cb)
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        setup(v)
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
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

    /* ---------------- 1.1: portrait, panels, window picker ---------------- */
    private fun mainLive(v: DeckView, l: Layout) {
        v.np = NowPlaying("Midnight City", "M83", "Spotify", 97.0, 243.0, false, null, System.currentTimeMillis())
        l.roots[0].strip.forEachIndexed { i, s -> s?.let { v.sliders[it.id] = SliderState(listOf(64, 40, 82)[i % 3], true, i == 2) } }
        val st = l.roots[0].keys.filter { it.kind == "status" }
        v.status[st[0].id] = StatusValue("18%", "load 0.42", 0.18, null)
        v.status[st[1].id] = StatusValue("12%", "queries blocked", 0.12, null)
    }
    private fun withPage(l: Layout, edit: (JSONObject) -> Unit): Layout {
        val o = JSONObject(File(System.getProperty("layout.json")!!).readText())
        edit(o.getJSONArray("pages").getJSONObject(0))
        return Layout.parse(o)
    }

    @Test fun portraitReading() = render("deck_portrait_reading", 1200, 1920) { v ->
        val l = layout(); v.layout = l; v.connected = true; v.rtt = 12; v.pageId = l.roots[0].id; mainLive(v, l)
    }

    @Test fun portraitMirrorTop() = render("deck_portrait_mirror_top", 1200, 1920) { v ->
        val l = withPage(layout()) { it.put("porder", "mirror").put("pside", "top") }
        v.layout = l; v.connected = true; v.rtt = 12; v.pageId = l.roots[0].id; mainLive(v, l)
    }

    @Test fun portraitSixSliders() = render("deck_portrait_sliders_6", 1200, 1920) { v ->
        v.layout = sliderPage(6, "left"); v.connected = true
        for (i in 0 until 6) v.sliders["s$i"] = SliderState(listOf(70, 40, 85, 55, 30, 65)[i], true, i == 2)
    }

    @Test fun portraitOffline() = render("deck_portrait_offline", 1200, 1920) { v ->
        v.layout = layout(); v.connected = false; v.myIp = "192.168.1.42"; v.lastPeer = "192.168.1.20"; v.usbPlugged = true
    }

    @Test fun portraitPairing() = render("deck_portrait_pairing", 1200, 1920) { v -> v.pair = Link.PairPrompt("RSM-DESKTOP", "098195", false) }

    private fun panelPage(): Layout {
        val keys = org.json.JSONArray()
            .put(JSONObject().put("id", "procs").put("row", 0).put("col", 0).put("span", 3).put("vspan", 2).put("kind", "panel").put("label", "Top processes").put("title", "Top processes"))
            .put(JSONObject().put("id", "temps").put("row", 0).put("col", 3).put("span", 2).put("vspan", 3).put("kind", "panel").put("label", "Temps").put("title", "Server temps"))
            .put(JSONObject().put("id", "cpu").put("row", 2).put("col", 0).put("kind", "status").put("label", "CPU").put("title", "CPU").put("show", "valuebar"))
            .put(JSONObject().put("id", "term").put("row", 2).put("col", 1).put("kind", "key").put("label", "Terminal").put("glyph", "square-terminal"))
            .put(JSONObject().put("id", "snap").put("row", 2).put("col", 2).put("kind", "key").put("label", "Move window").put("glyph", "app-window"))
        val page = JSONObject().put("id", "p").put("name", "Server").put("cols", 5).put("rows", 3).put("keys", keys).put("strip", org.json.JSONArray())
        return Layout.parse(JSONObject().put("pages", org.json.JSONArray().put(page)))
    }
    private fun panelLive(v: DeckView) {
        v.panels["procs"] = PanelValue(listOf("  CPU%  MEM%  NAME", "  38.2   4.1  ffmpeg", "  12.7   9.8  python3", "   6.3   1.2  nginx", "   3.0   2.4  postgres", "   1.1  12.3  java", "   0.8   0.6  sshd", "   0.5   0.3  cron", "   0.2   0.1  systemd"), true)
        v.panels["temps"] = PanelValue(listOf("CPU package   54 C", "Core 0        51 C", "Core 1        53 C", "Core 2        50 C", "Core 3        55 C", "GPU           61 C", "NVMe          42 C"), true)
        v.status["cpu"] = StatusValue("31%", "8 threads", 0.31, true)
    }

    @Test fun panels() = render("deck_panels") { v -> v.layout = panelPage(); v.connected = true; v.rtt = 9; panelLive(v) }
    @Test fun panelsPortrait() = render("deck_panels_portrait", 1200, 1920) { v -> v.layout = panelPage(); v.connected = true; v.rtt = 9; panelLive(v) }

    private fun pick(): WinPick = WinPick.parse(JSONObject("""{"t":"winpick","key":"snap","wins":[
        {"id":"1","app":"Google Chrome","title":"Deckwell - GitHub"},{"id":"2","app":"Visual Studio Code","title":"Hub.cs - Deckwell"},
        {"id":"3","app":"Spotify","title":"Spotify Premium"},{"id":"4","app":"Windows Terminal","title":"PowerShell"},
        {"id":"5","app":"Discord"},{"id":"6","app":"File Explorer","title":"Downloads"}],
      "mons":[{"id":"\\\\.\\DISPLAY1","name":"Display 1","x":0,"y":0,"w":2560,"h":1440,"main":true,
        "zones":[{"id":"z1","name":"Code + chat","x":0,"y":0,"w":0.7,"h":1}]},
        {"id":"\\\\.\\DISPLAY2","name":"Display 2","x":2560,"y":180,"w":1920,"h":1080,"main":false,"zones":[]}]}"""))

    @Test fun pickWindow() = render("deck_pick_window") { v -> v.layout = panelPage(); v.connected = true; v.pick = pick() }
    // Steps after the window: display, then size, then the spot inside that size.
    @Test fun pickDisplay() = render("deck_pick_display") { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[1] } }
    @Test fun pickSize() = render("deck_pick_size") { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[1]; it.monPicked = true } }
    @Test fun pickHalf() = render("deck_pick_half") { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[1]; it.monPicked = true; it.group = "half" } }
    @Test fun pickCorner() = render("deck_pick_corner") { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[1]; it.monPicked = true; it.group = "corner" } }
    @Test fun pickThird2() = render("deck_pick_third_display2") { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[0]; it.mon = 1; it.monPicked = true; it.group = "third" } }
    @Test fun pickDisplayPortrait() = render("deck_pick_display_portrait", 1200, 1920) { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[1] } }
    @Test fun pickSizePortrait() = render("deck_pick_size_portrait", 1200, 1920) { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[1]; it.monPicked = true } }
    @Test fun pickCornerPortrait() = render("deck_pick_corner_portrait", 1200, 1920) { v -> v.layout = panelPage(); v.connected = true; v.pick = pick().also { it.win = it.wins[1]; it.monPicked = true; it.group = "corner" } }

    /** Taps through the picker: window, Display 2, Half, Right half. Back steps back one screen at a time. */
    @Test fun pickFlow() {
        val ctx = RuntimeEnvironment.getApplication()
        var sent = ""
        val v = DeckView(ctx, Res(ctx), object : DeckView.Callbacks {
            override fun press(k: DKey) {}
            override fun release(k: DKey) {}
            override fun slider(s: DSlider, value: Int) {}
            override fun sliderButton(s: DSlider) {}
            override fun pageChanged(id: String) {}
            override fun pairApprove() {}
            override fun pairCancel() {}
            override fun snap(key: String, win: String, mon: String, spot: String) { sent = "$key|$win|$mon|$spot" }
        })
        v.measure(View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1200, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, 1920, 1200)
        v.layout = panelPage(); v.connected = true
        val pk = pick(); v.pick = pk
        val bmp = Bitmap.createBitmap(1920, 1200, Bitmap.Config.ARGB_8888)
        fun tap(x: Float, y: Float) {
            v.draw(Canvas(bmp))
            val t = android.os.SystemClock.uptimeMillis()
            v.dispatchTouchEvent(android.view.MotionEvent.obtain(t, t, android.view.MotionEvent.ACTION_DOWN, x, y, 0))
            v.dispatchTouchEvent(android.view.MotionEvent.obtain(t, t + 50, android.view.MotionEvent.ACTION_UP, x, y, 0))
        }
        tap(700f, 200f); assertEquals("Visual Studio Code", pk.win?.app); assertEquals(false, pk.monPicked)
        tap(1500f, 560f); assertEquals(1, pk.mon); assertEquals(true, pk.monPicked)
        tap(960f, 250f); assertEquals("half", pk.group)
        tap(80f, 1120f); assertEquals("Back goes to sizes", null, pk.group)
        tap(80f, 1120f); assertEquals("Back goes to displays", false, pk.monPicked)
        tap(1500f, 560f); tap(960f, 250f); tap(700f, 250f)
        assertEquals("snap|2|\\\\.\\DISPLAY2|right", sent)
        assertEquals("picker closes after a spot", null, v.pick)
        // Maximize moves the window right away, with no fourth screen.
        sent = ""; val pk2 = pick(); v.pick = pk2
        tap(700f, 200f); tap(500f, 560f); tap(300f, 250f)
        assertEquals("snap|2|\\\\.\\DISPLAY1|max", sent)
    }

    /* ---------------- 1.1: moved Back key, panel text that fills the panel ---------------- */
    @Test fun movedBack() = render("deck_folder_back_moved") { v ->
        val keys = org.json.JSONArray()
            .put(JSONObject().put("id", "a").put("row", 0).put("col", 0).put("kind", "key").put("label", "Lights").put("glyph", "lightbulb"))
            .put(JSONObject().put("id", "b").put("row", 0).put("col", 1).put("kind", "key").put("label", "Fan").put("glyph", "power"))
            .put(JSONObject().put("id", "hid").put("row", 2).put("col", 4).put("kind", "key").put("label", "Hidden by Back"))
        val main = JSONObject().put("id", "m").put("name", "Main").put("cols", 5).put("rows", 3).put("keys", org.json.JSONArray()).put("strip", org.json.JSONArray())
        val f = JSONObject().put("id", "f").put("name", "Room").put("parent", "m").put("cols", 5).put("rows", 3).put("keys", keys).put("strip", org.json.JSONArray()).put("backRow", 2).put("backCol", 4)
        val l = Layout.parse(JSONObject().put("pages", org.json.JSONArray().put(main).put(f)))
        val ks = l.keysOf(l.page("f")!!)
        assertEquals("back sits where it was moved", "__back@2,4", ks.first().let { "${it.id}@${it.row},${it.col}" })
        assertEquals("the key under Back is hidden", listOf("__back", "a", "b"), ks.map { it.id })
        v.layout = l; v.connected = true; v.pageId = "f"
    }

    private val fourBoxes = listOf(
        "+- RAM ---------------+ +- CPU ---------------+", "| Used  12.4 GB       | | Load   8.3%         |", "| Total 30.0 GB       | | Temp   52 C         |",
        "| In use 41%          | | Power  n/a          |", "| Swap   0.0 GB       | | Avg    0.52         |", "+---------------------+ +---------------------+",
        "+- P620 --------------+ +- V100 --------------+", "| Temp   41 C         | | Temp   54 C         |", "| Load   2%           | | Load   37%          |",
        "| Mem    0.3/2.0 GB   | | Mem    1.2/16.0 GB  |", "| Power  n/a          | | Power  39/250 W     |", "+---------------------+ +---------------------+")
    private fun bigPanel(w: Int, h: Int): Layout {
        val keys = org.json.JSONArray().put(JSONObject().put("id", "node").put("row", 0).put("col", 0).put("span", w).put("vspan", h).put("kind", "panel").put("label", "Server").put("title", "Server"))
        val page = JSONObject().put("id", "p").put("name", "Server").put("cols", 5).put("rows", 3).put("keys", keys).put("strip", org.json.JSONArray())
        return Layout.parse(JSONObject().put("pages", org.json.JSONArray().put(page)))
    }
    @Test fun panelFills4x3() = render("deck_panel_fill_4x3") { v -> v.layout = bigPanel(4, 3); v.connected = true; v.panels["node"] = PanelValue(fourBoxes, true) }
    @Test fun panelFills2x2() = render("deck_panel_fill_2x2") { v -> v.layout = bigPanel(2, 2); v.connected = true; v.panels["node"] = PanelValue(fourBoxes, true) }
}
