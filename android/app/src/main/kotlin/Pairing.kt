package com.oscardevelopments.deckwell

import android.content.Context
import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Crypto for the v2 link protocol. Must match docs/PROTOCOL.md byte for byte (checked by PairingVectorTest). */
object Crypto {
    private val rng = SecureRandom()

    fun b64(b: ByteArray): String = Base64.encodeToString(b, Base64.NO_WRAP)
    fun unb64(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)
    fun random(n: Int = 16) = ByteArray(n).also { rng.nextBytes(it) }
    fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)
    fun hmac(key: ByteArray, msg: String): ByteArray =
        Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(msg.toByteArray(Charsets.UTF_8)) }

    /** Constant-time compare of two b64 MACs. */
    fun same(a: String?, b: String?): Boolean {
        if (a == null || b == null || a.length != b.length) return false
        var d = 0
        for (i in a.indices) d = d or (a[i].code xor b[i].code)
        return d == 0
    }

    fun newKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").run { initialize(ECGenParameterSpec("secp256r1"), rng); generateKeyPair() }
    fun spki(kp: KeyPair): ByteArray = kp.public.encoded
    fun ecdh(priv: PrivateKey, otherSpki: ByteArray): ByteArray {
        val pub = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(otherSpki))
        return KeyAgreement.getInstance("ECDH").run { init(priv); doPhase(pub, true); generateSecret() }
    }

    fun commit(spki: ByteArray, nonce: ByteArray) = b64(sha256(spki + nonce))
    fun transcript(pkD: String, pkK: String, nD2: String, nK2: String) = "$pkD|$pkK|$nD2|$nK2"
    fun pairKey(z: ByteArray, t: String) = hmac(z, "DW2 pair|$t")
    fun code(t: String): String {
        val h = sha256("DW2 code|$t".toByteArray(Charsets.UTF_8))
        val v = ((h[0].toLong() and 0xff) shl 24) or ((h[1].toLong() and 0xff) shl 16) or ((h[2].toLong() and 0xff) shl 8) or (h[3].toLong() and 0xff)
        return (v % 1_000_000).toString().padStart(6, '0')
    }
    fun authMac(k: ByteArray, role: String, nK: String, nD: String) = b64(hmac(k, "DW2 auth $role|$nK|$nD"))
    fun sessionKey(k: ByteArray, nK: String, nD: String) = hmac(k, "DW2 session|$nK|$nD")
    fun doneMac(k: ByteArray, role: String) = b64(hmac(k, "DW2 done $role"))
    fun envMac(s: ByteArray, dir: String, n: Long, p: String) = b64(hmac(s, "$dir|$n|$p"))
}

/** This deck's identity and the one desktop it is paired with. */
class PairStore(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    val deckId: String = prefs.getString("deckId", null) ?: Crypto.hex(Crypto.random(16)).also { prefs.edit().putString("deckId", it).apply() }
    val desktopId: String? get() = prefs.getString("desk", null)
    val desktopName: String? get() = prefs.getString("dname", null)
    val key: ByteArray? get() = prefs.getString("key", null)?.let { Crypto.unb64(it) }

    fun keyFor(desk: String): ByteArray? = if (desk == desktopId) key else null

    fun save(desk: String, name: String, k: ByteArray) {
        prefs.edit().putString("desk", desk).putString("dname", name).putString("key", Crypto.b64(k)).commit()
    }

    fun clear() { prefs.edit().remove("desk").remove("dname").remove("key").commit() }
}
