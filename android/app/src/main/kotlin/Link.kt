package com.oscardevelopments.deckwell

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyPair
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * The deck is a TCP server on :8765. The desktop dials in over Wi-Fi (found via the UDP beacon on :8766)
 * or over USB through `adb forward` (Fire OS 4 / Android 4.4 has no `adb reverse`).
 *
 * Every connection must pass auth (or pairing) before it can send the deck anything that matters.
 * After that, every message in both directions is signed. See docs/PROTOCOL.md.
 */
class Link(private val ctx: Context, private val listener: Listener) {
    interface Listener {
        fun onConnected(peer: String, viaUsb: Boolean)
        fun onDisconnected()
        fun onMessage(m: JSONObject)
        /** Show (or update) the pairing screen; null hides it. */
        fun onPairing(p: PairPrompt?)
    }

    /** code is null while the key exchange is still running. */
    data class PairPrompt(val desktopName: String, val code: String?, val approved: Boolean)

    companion object {
        const val PORT = 8765
        const val BEACON_PORT = 8766
        const val PROTO = 2
        const val HANDSHAKE_MS = 15_000L
        const val PAIRING_MS = 180_000L
        /** Only a hint for telling new decks apart; the user names the deck on the desktop while pairing. */
        val deviceModel: String get() = Build.MODEL ?: "Android"
    }

    val store = PairStore(ctx)
    private val main = Handler(Looper.getMainLooper())
    private val tx = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private val conns = CopyOnWriteArrayList<Conn>()
    @Volatile private var active: Conn? = null
    @Volatile private var pairing: Conn? = null
    @Volatile private var running = true
    @Volatile var lastRx = 0L; private set
    private var server: ServerSocket? = null

    val connected get() = active != null

    /** One TCP connection from a desktop, with its own handshake state. */
    private inner class Conn(val s: Socket) {
        val w = OutputStreamWriter(s.getOutputStream(), Charsets.UTF_8)
        val opened = System.currentTimeMillis()
        val nK = Crypto.b64(Crypto.random())
        @Volatile var authed = false
        var sess: ByteArray? = null
        var sendN = 0L
        var recvN = 0L
        // pairing state for this connection
        var pDesk = ""; var pName = ""; var pkD = ""
        var kp: KeyPair? = null; var nK2: ByteArray? = null
        var pKey: ByteArray? = null; var code: String? = null
        @Volatile var approved = false

        val peer: String get() = s.inetAddress?.hostAddress ?: ""
        val viaUsb: Boolean get() = s.inetAddress?.isLoopbackAddress == true

        /** Unsigned write: handshake messages only. */
        fun raw(m: JSONObject, thenClose: Boolean = false) {
            val line = m.toString() + "\n"
            tx.execute { try { w.write(line); w.flush() } catch (_: Exception) { }; if (thenClose) close() }
        }

        fun close() { try { s.close() } catch (_: Exception) { } }
    }

    fun start() {
        Thread({ acceptLoop() }, "deck-accept").start()
        Thread({ beaconLoop() }, "deck-beacon").start()
        Thread({ gcLoop() }, "deck-gc").start()
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) { }
        conns.forEach { it.close() }
    }

    private fun acceptLoop() {
        while (running) {
            try {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress(PORT))
                server = ss
                while (running) {
                    val s = ss.accept()
                    s.tcpNoDelay = true
                    s.keepAlive = true
                    accept(s)
                }
            } catch (e: Exception) {
                if (running) Thread.sleep(1500)
            }
        }
    }

    private fun accept(s: Socket) {
        val c = Conn(s)
        conns.add(c)
        c.raw(JSONObject().put("t", "hello").put("proto", PROTO).put("id", store.deckId).put("nonce", c.nK)
            .put("name", deviceModel).put("model", Build.MODEL).put("ip", wifiIp() ?: "")
            .put("w", ctx.resources.displayMetrics.widthPixels).put("h", ctx.resources.displayMetrics.heightPixels))
        Thread({ readLoop(c) }, "deck-rx").start()
    }

    /** Closes connections that never finish auth, so a stranger can't hold one open. */
    private fun gcLoop() {
        while (running) {
            val now = System.currentTimeMillis()
            for (c in conns) if (!c.authed && now - c.opened > (if (pairing === c) PAIRING_MS else HANDSHAKE_MS)) c.close()
            try { Thread.sleep(1000) } catch (_: Exception) { }
        }
    }

    private fun readLoop(c: Conn) {
        try {
            val r = BufferedReader(InputStreamReader(c.s.getInputStream(), Charsets.UTF_8), 1 shl 16)
            while (running) {
                val line = r.readLine() ?: break
                val m = try { JSONObject(line) } catch (_: Exception) { continue }
                if (c.authed) {
                    val inner = open(c, m) ?: break   // bad signature: hang up
                    if (c !== active) continue
                    lastRx = System.currentTimeMillis()
                    if (inner.optString("t") == "ping") send(JSONObject().put("t", "pong").put("ts", inner.optLong("ts")))
                    main.post { listener.onMessage(inner) }
                } else handshake(c, m)
            }
        } catch (_: Exception) { }
        c.close()
        conns.remove(c)
        if (pairing === c) endPairing(c)
        if (active === c) { active = null; main.post { listener.onDisconnected() } }
    }

    /** Checks a signed envelope and returns the inner message, or null if it is forged or replayed. */
    private fun open(c: Conn, m: JSONObject): JSONObject? {
        if (m.optString("t") != "s") return null
        val n = m.optLong("n", -1); val p = m.optString("p", ""); val sess = c.sess ?: return null
        if (n <= c.recvN || !Crypto.same(m.optString("h"), Crypto.envMac(sess, "d2k", n, p))) return null
        c.recvN = n
        return try { JSONObject(p) } catch (_: Exception) { null }
    }

    private fun handshake(c: Conn, m: JSONObject) {
        try {
            when (m.optString("t")) {
                "auth" -> {
                    val desk = m.optString("desk"); val nD = m.optString("nonce")
                    val k = store.keyFor(desk)
                    if (k == null || nD.isEmpty()) { c.raw(JSONObject().put("t", "auth-fail").put("reason", "unknown")); return }
                    if (!Crypto.same(m.optString("mac"), Crypto.authMac(k, "desk", c.nK, nD))) {
                        c.raw(JSONObject().put("t", "auth-fail").put("reason", "bad-mac"), thenClose = true); return
                    }
                    c.raw(JSONObject().put("t", "auth-ok").put("mac", Crypto.authMac(k, "deck", c.nK, nD)))
                    c.sess = Crypto.sessionKey(k, c.nK, nD)
                    promote(c)
                }
                "pair-start" -> {
                    synchronized(lock) {
                        val other = pairing
                        if (other != null && other !== c && conns.contains(other)) {
                            c.raw(JSONObject().put("t", "pair-cancel").put("reason", "busy")); return
                        }
                        pairing = c
                    }
                    c.pDesk = m.optString("desk"); c.pName = m.optString("dname").ifEmpty { "your computer" }; c.pkD = m.optString("pk")
                    c.pKey = null; c.code = null; c.approved = false
                    val kp = Crypto.newKeyPair(); val n = Crypto.random()
                    c.kp = kp; c.nK2 = n
                    c.raw(JSONObject().put("t", "pair-commit").put("c", Crypto.commit(Crypto.spki(kp), n)))
                    prompt(c)
                }
                "pair-nonce" -> {
                    if (pairing !== c) return
                    val kp = c.kp ?: return; val nK2 = c.nK2 ?: return
                    val pkK = Crypto.b64(Crypto.spki(kp)); val nK2s = Crypto.b64(nK2)
                    val t = Crypto.transcript(c.pkD, pkK, m.optString("n"), nK2s)
                    c.pKey = Crypto.pairKey(Crypto.ecdh(kp.private, Crypto.unb64(c.pkD)), t)
                    c.code = Crypto.code(t)
                    c.raw(JSONObject().put("t", "pair-reveal").put("pk", pkK).put("n", nK2s))
                    prompt(c)
                }
                "pair-done" -> {
                    if (pairing !== c) return
                    val k = c.pKey ?: return
                    if (!c.approved) return
                    if (!Crypto.same(m.optString("mac"), Crypto.doneMac(k, "desk"))) {
                        c.raw(JSONObject().put("t", "pair-cancel").put("reason", "bad-mac")); endPairing(c); return
                    }
                    store.save(c.pDesk, c.pName, k)
                    c.raw(JSONObject().put("t", "pair-ok").put("mac", Crypto.doneMac(k, "deck")))
                    endPairing(c)
                }
                "pair-cancel" -> if (pairing === c) endPairing(c)
            }
        } catch (_: Exception) {
            c.raw(JSONObject().put("t", "pair-cancel").put("reason", "error"))
            if (pairing === c) endPairing(c)
        }
    }

    private fun prompt(c: Conn) {
        val p = PairPrompt(c.pName, c.code, c.approved)
        main.post { if (pairing === c) listener.onPairing(p) }
    }

    private fun endPairing(c: Conn) {
        synchronized(lock) { if (pairing === c) pairing = null else return }
        main.post { listener.onPairing(null) }
    }

    /** The user tapped Pair on the deck. */
    fun approvePairing() {
        val c = pairing ?: return
        if (c.code == null || c.approved) return
        c.approved = true
        c.raw(JSONObject().put("t", "pair-approve"))
        prompt(c)
    }

    /** The user tapped Cancel on the deck. */
    fun cancelPairing() {
        val c = pairing ?: return
        c.raw(JSONObject().put("t", "pair-cancel").put("reason", "user"))
        endPairing(c)
    }

    private fun promote(c: Conn) {
        c.authed = true
        val old = active
        active = c
        lastRx = System.currentTimeMillis()
        if (old != null && old !== c) old.close()
        main.post { listener.onConnected(c.peer, c.viaUsb) }
    }

    /** Hangs up on the current desktop (heartbeat lost). */
    fun drop() {
        val c = active ?: return
        active = null
        c.close()
    }

    /** Signed send to the paired desktop. Dropped if nobody has passed auth. */
    fun send(m: JSONObject) {
        val c = active ?: return
        val p = m.toString()
        tx.execute {
            val sess = c.sess
            if (!c.authed || sess == null) return@execute
            c.sendN++
            val env = JSONObject().put("t", "s").put("n", c.sendN).put("p", p).put("h", Crypto.envMac(sess, "k2d", c.sendN, p))
            try { c.w.write(env.toString() + "\n"); c.w.flush() } catch (_: Exception) { }
        }
    }

    @Suppress("DEPRECATION")
    fun wifiIp(): String? {
        return try {
            val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ip = wm.connectionInfo?.ipAddress ?: 0
            if (ip == 0) null else "${ip and 0xff}.${ip shr 8 and 0xff}.${ip shr 16 and 0xff}.${ip shr 24 and 0xff}"
        } catch (_: Exception) { null }
    }

    @Suppress("DEPRECATION")
    private fun broadcastTargets(): List<InetAddress> {
        val out = ArrayList<InetAddress>()
        try {
            val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val d = wm.dhcpInfo
            if (d != null && d.ipAddress != 0) {
                val b = (d.ipAddress and d.netmask) or d.netmask.inv()
                out.add(InetAddress.getByAddress(byteArrayOf((b and 0xff).toByte(), (b shr 8 and 0xff).toByte(), (b shr 16 and 0xff).toByte(), (b shr 24 and 0xff).toByte())))
            }
        } catch (_: Exception) { }
        try { out.add(InetAddress.getByName("255.255.255.255")) } catch (_: Exception) { }
        return out
    }

    private fun beaconLoop() {
        var sock: DatagramSocket? = null
        while (running) {
            try {
                if (sock == null) sock = DatagramSocket().apply { broadcast = true }
                if (wifiIp() != null) {
                    val payload = "DECKWELL1 $PORT $deviceModel".toByteArray(Charsets.UTF_8)
                    for (addr in broadcastTargets()) sock.send(DatagramPacket(payload, payload.size, addr, BEACON_PORT))
                }
            } catch (_: Exception) { try { sock?.close() } catch (_: Exception) { }; sock = null }
            Thread.sleep(2000)
        }
        sock?.close()
    }
}
