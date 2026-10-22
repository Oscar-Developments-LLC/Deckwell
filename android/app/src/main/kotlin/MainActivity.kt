package com.oscardevelopments.deckwell

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class MainActivity : Activity(), Link.Listener, DeckView.Callbacks {
    private lateinit var res: Res
    private lateinit var deck: DeckView
    private lateinit var link: Link
    private val main = Handler(Looper.getMainLooper())
    private val layoutFile by lazy { File(filesDir, "layout.json") }
    private val prefs by lazy { getSharedPreferences("deck", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN)
        res = Res(this)
        deck = DeckView(this, res, this)
        setContentView(deck)
        immersive()
        deck.pageId = prefs.getString("page", null)
        try { if (layoutFile.exists()) deck.layout = Layout.parse(JSONObject(layoutFile.readText())) } catch (_: Exception) { }
        link = Link(this, this)
        deck.myIp = link.wifiIp()
        link.start()
        registerReceiver(power, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        main.postDelayed(watchdog, 1000)
    }

    override fun onDestroy() {
        super.onDestroy()
        main.removeCallbacksAndMessages(null)
        try { unregisterReceiver(power) } catch (_: Exception) { }
        link.stop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive() }

    @Suppress("DEPRECATION")
    private fun immersive() {
        var flags = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        if (Build.VERSION.SDK_INT >= 19) flags = flags or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        window.decorView.systemUiVisibility = flags
    }

    private val power = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val plugged = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
            val usb = plugged == BatteryManager.BATTERY_PLUGGED_USB
            if (usb != deck.usbPlugged) { deck.usbPlugged = usb; deck.invalidate() }
        }
    }

    /** Drops the link if the desktop stops pinging (Wi-Fi sleep, cable pulled). */
    private val watchdog = object : Runnable {
        override fun run() {
            if (link.connected && System.currentTimeMillis() - link.lastRx > 7000) { link.drop(); onDisconnected() }
            val ip = link.wifiIp()
            if (ip != deck.myIp) { deck.myIp = ip; deck.invalidate() }
            main.postDelayed(this, 1000)
        }
    }

    /* ---------------- link ---------------- */
    override fun onConnected(peer: String, viaUsb: Boolean) {
        deck.connected = true; deck.link = if (viaUsb) "usb" else "wifi"
        if (!viaUsb) deck.lastPeer = peer
        prefs.edit().putString("peer", deck.lastPeer).apply()
        deck.invalidate()
    }

    override fun onDisconnected() {
        if (!deck.connected) return
        deck.connected = false
        if (deck.lastPeer == null) deck.lastPeer = prefs.getString("peer", null)
        deck.invalidate()
    }

    override fun onPairing(p: Link.PairPrompt?) { deck.pair = p }

    override fun onMessage(m: JSONObject) {
        when (m.optString("t")) {
            "hello" -> { deck.link = m.optString("link", deck.link); deck.invalidate() }
            "ping" -> { val r = m.optInt("rtt", 0); if (r != deck.rtt) { deck.rtt = r; deck.invalidate() }; m.optStr("link")?.let { deck.link = it } }
            "layout" -> {
                val lay = Layout.parse(m)
                deck.layout = lay
                try { layoutFile.writeText(m.toString()) } catch (_: Exception) { }
                requestIcons(lay.iconIds())
            }
            "icon" -> { if (!m.optBoolean("missing")) { res.storeIcon(m.optString("id"), m.optString("png")); deck.invalidate() } }
            "np" -> {
                deck.np = if (m.optBoolean("none")) null else NowPlaying(m.optString("title"), m.optString("artist"), m.optString("source"),
                    m.optDouble("pos", 0.0), m.optDouble("dur", 0.0), m.optBoolean("playing"), m.optStr("art"), System.currentTimeMillis())
                deck.np?.art?.let { requestIcons(setOf(it)); res.pruneArt(setOf(it)) }
                deck.invalidate()
            }
            "sliders" -> {
                val v = m.optJSONObject("v") ?: return
                val it = v.keys()
                while (it.hasNext()) {
                    val id = it.next(); val o = v.optJSONObject(id) ?: continue
                    if (deck.sliderDragging(id)) continue
                    deck.sliders[id] = SliderState(o.optInt("value"), o.optBoolean("enabled", true), o.optBoolean("muted"))
                }
                deck.invalidate()
            }
            "status" -> {
                deck.status[m.optString("id")] = StatusValue(m.optStr("value"), m.optStr("sub"), if (m.has("bar")) m.optDouble("bar").takeIf { !it.isNaN() } else null, if (m.has("up")) m.optBoolean("up") else null)
                deck.invalidate()
            }
            "fb" -> {
                val ok = m.optBoolean("ok")
                val dur = if (m.optStr("line") != null) 8000L else if (ok) 2600L else 5000L
                deck.feedback[m.optString("key")] = Feedback(ok, m.optBoolean("ring"), m.optStr("badge"), m.optStr("line"), System.currentTimeMillis() + dur)
                m.optStr("toast")?.let { t -> deck.toast = Toast(t.removePrefix("✓ ").removePrefix("⚠ "), ok, System.currentTimeMillis() + 5000) }
                deck.invalidate()
            }
        }
    }

    private fun requestIcons(ids: Set<String>) {
        val missing = ids.filterNot { res.hasIcon(it) }
        if (missing.isNotEmpty()) link.send(JSONObject().put("t", "need").put("ids", JSONArray(missing)))
    }

    /* ---------------- deck callbacks ---------------- */
    override fun press(k: DKey) { link.send(JSONObject().put("t", "down").put("key", k.id)) }
    override fun release(k: DKey) { link.send(JSONObject().put("t", "up").put("key", k.id)) }
    override fun slider(s: DSlider, value: Int) { link.send(JSONObject().put("t", "set").put("id", s.id).put("value", value)) }
    override fun sliderButton(s: DSlider) {
        link.send(JSONObject().put("t", "sbtn").put("id", s.id))
        deck.sliders[s.id]?.let { deck.sliders[s.id] = SliderState(it.value, it.enabled, !it.muted); deck.holdIncoming[s.id] = SystemClock.uptimeMillis() + 600 }
        deck.invalidate()
    }
    override fun pageChanged(id: String) { prefs.edit().putString("page", id).apply() }
    override fun pairApprove() { link.approvePairing() }
    override fun pairCancel() { link.cancelPairing() }
}
