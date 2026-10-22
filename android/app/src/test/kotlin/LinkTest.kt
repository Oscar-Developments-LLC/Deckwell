package com.oscardevelopments.deckwell

import android.os.Looper
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Socket

/** Plays the desktop's side of docs/PROTOCOL.md against the real Link server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class LinkTest {
    private val msgs = ArrayList<JSONObject>()
    private val prompts = ArrayList<Link.PairPrompt?>()
    private var connectedUsb: Boolean? = null
    private var disconnected = false
    private fun idle() { Thread.sleep(300); shadowOf(Looper.getMainLooper()).idle() }

    private inner class Desk {
        val sock: Socket = run {
            var s: Socket? = null
            for (i in 0 until 50) { try { s = Socket("127.0.0.1", Link.PORT); break } catch (_: Exception) { Thread.sleep(100) } }
            s!!.apply { soTimeout = 5000 }
        }
        val r = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.UTF_8))
        val w = OutputStreamWriter(sock.getOutputStream(), Charsets.UTF_8)
        var sess: ByteArray? = null; var n = 0L; var lastIn = 0L
        fun send(m: JSONObject) { w.write(m.toString() + "\n"); w.flush() }
        fun read(): JSONObject = JSONObject(r.readLine())
        fun signed(m: JSONObject) {
            val p = m.toString(); n++
            send(JSONObject().put("t", "s").put("n", n).put("p", p).put("h", Crypto.envMac(sess!!, "d2k", n, p)))
        }
        fun readSigned(): JSONObject {
            val e = read(); assertEquals("s", e.getString("t"))
            val num = e.getLong("n"); val p = e.getString("p")
            assertTrue(num > lastIn); lastIn = num
            assertEquals(Crypto.envMac(sess!!, "k2d", num, p), e.getString("h"))
            return JSONObject(p)
        }
    }

    @Test fun pairAuthSignAndReject() {
        val link = Link(RuntimeEnvironment.getApplication(), object : Link.Listener {
            override fun onConnected(peer: String, viaUsb: Boolean) { connectedUsb = viaUsb }
            override fun onDisconnected() { disconnected = true }
            override fun onMessage(m: JSONObject) { msgs.add(m) }
            override fun onPairing(p: Link.PairPrompt?) { prompts.add(p) }
        })
        link.store.clear()
        link.start()
        val d = Desk()
        val hello = d.read()
        assertEquals("hello", hello.getString("t")); assertEquals(2, hello.getInt("proto"))
        val deckId = hello.getString("id"); val nK = hello.getString("nonce")
        assertEquals(32, deckId.length)

        // Unsigned commands before auth are ignored.
        d.send(JSONObject().put("t", "layout").put("pages", org.json.JSONArray()))
        // An unknown desktop is turned away.
        d.send(JSONObject().put("t", "auth").put("desk", "ffff").put("nonce", Crypto.b64(Crypto.random())).put("mac", "x"))
        assertEquals("unknown", d.read().getString("reason"))

        // Pairing.
        val deskId = Crypto.hex(Crypto.random(16))
        val kp = Crypto.newKeyPair(); val pkD = Crypto.b64(Crypto.spki(kp))
        d.send(JSONObject().put("t", "pair-start").put("desk", deskId).put("dname", "TEST-PC").put("pk", pkD))
        val commit = d.read(); assertEquals("pair-commit", commit.getString("t"))
        val nD2 = Crypto.b64(Crypto.random())
        d.send(JSONObject().put("t", "pair-nonce").put("n", nD2))
        val reveal = d.read(); assertEquals("pair-reveal", reveal.getString("t"))
        val pkK = reveal.getString("pk"); val nK2 = reveal.getString("n")
        assertEquals(commit.getString("c"), Crypto.commit(Crypto.unb64(pkK), Crypto.unb64(nK2)))
        val t = Crypto.transcript(pkD, pkK, nD2, nK2)
        val k = Crypto.pairKey(Crypto.ecdh(kp.private, Crypto.unb64(pkK)), t)
        idle()
        assertEquals(Crypto.code(t), prompts.last()!!.code)
        assertEquals("TEST-PC", prompts.last()!!.desktopName)

        // pair-done before the user taps Pair is ignored.
        d.send(JSONObject().put("t", "pair-done").put("mac", Crypto.doneMac(k, "desk")))
        idle()
        assertNull(link.store.desktopId)
        link.approvePairing()
        assertEquals("pair-approve", d.read().getString("t"))
        d.send(JSONObject().put("t", "pair-done").put("mac", Crypto.doneMac(k, "desk")))
        val ok = d.read(); assertEquals("pair-ok", ok.getString("t"))
        assertEquals(Crypto.doneMac(k, "deck"), ok.getString("mac"))
        idle()
        assertNull(prompts.last())
        assertEquals(deskId, link.store.desktopId)

        // Auth on the same connection.
        val nD = Crypto.b64(Crypto.random())
        d.send(JSONObject().put("t", "auth").put("desk", deskId).put("nonce", nD).put("mac", Crypto.authMac(k, "desk", nK, nD)))
        val aok = d.read(); assertEquals("auth-ok", aok.getString("t"))
        assertEquals(Crypto.authMac(k, "deck", nK, nD), aok.getString("mac"))
        d.sess = Crypto.sessionKey(k, nK, nD)
        idle()
        assertEquals(true, connectedUsb)
        assertTrue(msgs.none { it.optString("t") == "layout" })

        // Signed traffic both ways.
        d.signed(JSONObject().put("t", "ping").put("ts", 12345).put("rtt", 7))
        d.signed(JSONObject(java.io.File(System.getProperty("layout.json")!!).readText()))
        val pong = d.readSigned()
        assertEquals("pong", pong.getString("t")); assertEquals(12345L, pong.getLong("ts"))
        idle()
        val lay = Layout.parse(msgs.first { it.optString("t") == "layout" })
        assertEquals(5, lay.pages.size)
        link.send(JSONObject().put("t", "down").put("key", "k1"))
        assertEquals("down", d.readSigned().getString("t"))

        // A replayed or forged message gets the connection dropped.
        d.send(JSONObject().put("t", "s").put("n", d.n + 1).put("p", "{\"t\":\"ping\"}").put("h", "AAAA"))
        assertNull(d.r.readLine())
        idle()
        assertTrue(disconnected)

        // Reconnect: auth alone works now, no pairing.
        val d2 = Desk(); val h2 = d2.read(); val nK3 = h2.getString("nonce"); val nD3 = Crypto.b64(Crypto.random())
        d2.send(JSONObject().put("t", "auth").put("desk", deskId).put("nonce", nD3).put("mac", Crypto.authMac(k, "desk", nK3, nD3)))
        assertEquals("auth-ok", d2.read().getString("t"))
        assertNotNull(link.store.key)

        // Wrong MAC from a desktop that claims to be the paired one.
        val d3 = Desk(); d3.read()
        d3.send(JSONObject().put("t", "auth").put("desk", deskId).put("nonce", nD3).put("mac", Crypto.authMac(Crypto.random(32), "desk", "x", nD3)))
        assertEquals("bad-mac", d3.read().getString("reason"))
        assertNull(d3.r.readLine())
        link.stop()
    }
}
