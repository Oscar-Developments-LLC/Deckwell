package com.oscardevelopments.deckwell

import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Touch-level check of "then show page" and folder keys that also fire steps. JSON matches what Hub.PushLayout sends. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "w1920dp-h1200dp-land-mdpi")
class GoPageTest {
    private val log = ArrayList<String>()
    private val cb = object : DeckView.Callbacks {
        override fun press(k: DKey) { log.add("down:" + k.id) }
        override fun release(k: DKey) { log.add("up:" + k.id) }
        override fun slider(s: DSlider, value: Int) {}
        override fun sliderButton(s: DSlider) {}
        override fun pageChanged(id: String) { log.add("page:$id") }
        override fun pairApprove() {}
        override fun pairCancel() {}
    }
    private val json = """{"t":"layout","pages":[
      {"id":"main","name":"Main","parent":null,"cols":5,"rows":3,"strip":[],"keys":[
        {"id":"spotify","row":0,"col":1,"span":1,"kind":"key","label":"Spotify","go":"spot"},
        {"id":"fold","row":0,"col":2,"span":1,"kind":"key","label":"Games","nav":"games","fire":true},
        {"id":"plain","row":0,"col":3,"span":1,"kind":"key","label":"Mute"},
        {"id":"held","row":0,"col":4,"span":1,"kind":"key","label":"PTT","hold":true,"go":"spot"},
        {"id":"oldfold","row":1,"col":0,"span":1,"kind":"key","label":"Old","nav":"games"}]},
      {"id":"spot","name":"Spotify","parent":"main","cols":5,"rows":3,"strip":[],"keys":[]},
      {"id":"games","name":"Games","parent":"main","cols":5,"rows":3,"strip":[],"keys":[]}]}"""

    // 5x3 page, no strip: key w = 346.8, h = 278, pad 37, top 132, gap 28
    private fun cx(col: Int) = 37f + col * (346.8f + 28f) + 173f
    private fun cy(row: Int) = 132f + row * (278f + 28f) + 139f

    private fun tap(v: DeckView, row: Int, col: Int) {
        val t = SystemClock.uptimeMillis()
        v.onTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, cx(col), cy(row), 0))
        v.onTouchEvent(MotionEvent.obtain(t, t + 80, MotionEvent.ACTION_UP, cx(col), cy(row), 0))
    }

    @Test fun goPage() {
        val ctx = RuntimeEnvironment.getApplication()
        val v = DeckView(ctx, Res(ctx), cb)
        v.measure(View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1200, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, 1920, 1200)
        v.layout = Layout.parse(JSONObject(json)); v.connected = true; v.pageId = "main"
        v.draw(android.graphics.Canvas(android.graphics.Bitmap.createBitmap(1920, 1200, android.graphics.Bitmap.Config.ARGB_8888)))

        tap(v, 0, 1)
        assertEquals("app key: press then page", listOf("down:spotify", "up:spotify", "page:spot"), log); assertEquals("spot", v.pageId)
        log.clear(); tap(v, 0, 0)
        assertEquals("Back key returns", listOf("page:main"), log); assertEquals("main", v.pageId)

        log.clear(); tap(v, 0, 2)
        assertEquals("folder with steps fires + opens", listOf("down:fold", "up:fold", "page:games"), log); assertEquals("games", v.pageId)
        log.clear(); tap(v, 0, 0); log.clear()

        tap(v, 1, 0)
        assertEquals("folder without steps only opens", listOf("page:games"), log)
        log.clear(); tap(v, 0, 0); log.clear()

        tap(v, 0, 3)
        assertEquals("plain key stays", listOf("down:plain", "up:plain"), log); assertEquals("main", v.pageId)

        log.clear(); tap(v, 0, 4)
        assertEquals("hold key: down, up, then page", listOf("down:held", "up:held", "page:spot"), log); assertEquals("spot", v.pageId)
        println("GoPageTest: all checks passed")
    }
}
