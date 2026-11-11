package com.oscardevelopments.deckwell

import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/** The PC must always get the newest slider position, even when the finger stops moving without lifting. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "w1920dp-h1200dp-land-mdpi")
class SliderTest {
    private val sent = ArrayList<Int>()
    private val cb = object : DeckView.Callbacks {
        override fun press(k: DKey) {}
        override fun release(k: DKey) {}
        override fun slider(s: DSlider, value: Int) { sent.add(value) }
        override fun sliderButton(s: DSlider) {}
        override fun pageChanged(id: String) {}
        override fun pairApprove() {}
        override fun pairCancel() {}
    }
    // One slider on the right: its centre is at x = 1920 - 37 - 92 / 2 = 1837. Track runs from y 994 (0%) up to y 232 (100%).
    private val x = 1837f
    private fun y(pct: Int) = 994f - (994f - 232f) * pct / 100f

    @Test fun newestPositionIsSentWithoutLifting() {
        val ctx = RuntimeEnvironment.getApplication()
        val v = DeckView(ctx, Res(ctx), cb)
        v.measure(View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1200, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, 1920, 1200)
        v.layout = Layout.parse(JSONObject("""{"pages":[{"id":"p","name":"Main","cols":5,"rows":3,"keys":[],"side":"right",
            "strip":[{"id":"s","label":"Master","control":"master","button":"mute"}]}]}"""))
        v.connected = true

        val t = SystemClock.uptimeMillis()
        v.onTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y(20), 0))
        assertEquals("touching the track sends right away", listOf(20), sent)
        v.onTouchEvent(MotionEvent.obtain(t, t + 5, MotionEvent.ACTION_MOVE, x, y(50), 0))
        v.onTouchEvent(MotionEvent.obtain(t, t + 10, MotionEvent.ACTION_MOVE, x, y(80), 0))
        assertEquals("moves inside 30 ms wait their turn", listOf(20), sent)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(40))
        assertEquals("then the newest one goes out, with the finger still down", listOf(20, 80), sent)

        // Default step is 1%, like the Windows slider: odd values are reachable.
        v.onTouchEvent(MotionEvent.obtain(t, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, x, y(37), 0))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(40))
        assertEquals(listOf(20, 80, 37), sent)
        v.onTouchEvent(MotionEvent.obtain(t, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y(37), 0))
        assertEquals("lifting sends the final position", listOf(20, 80, 37, 37), sent)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
        assertEquals("nothing late arrives after lifting", 4, sent.size)
        println("SliderTest: all checks passed")
    }
}
