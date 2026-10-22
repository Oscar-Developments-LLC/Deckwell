package com.oscardevelopments.deckwell

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec

/** The deck's crypto must match shared/pairing-vector.json, which every Deckwell app is checked against. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class PairingVectorTest {
    @Test fun matchesSharedVector() {
        val v = JSONObject(File(System.getProperty("pairing.vector")!!).readText())
        fun s(k: String) = v.getString(k)
        val kf = KeyFactory.getInstance("EC")
        val dD = kf.generatePrivate(PKCS8EncodedKeySpec(Crypto.unb64(s("desktopPrivPkcs8"))))
        val dK = kf.generatePrivate(PKCS8EncodedKeySpec(Crypto.unb64(s("deckPrivPkcs8"))))

        val z1 = Crypto.ecdh(dD, Crypto.unb64(s("pkK")))
        val z2 = Crypto.ecdh(dK, Crypto.unb64(s("pkD")))
        assertArrayEquals(z1, z2)
        assertEquals(s("Z"), Crypto.b64(z1))

        assertEquals(s("commit"), Crypto.commit(Crypto.unb64(s("pkK")), Crypto.unb64(s("nK2"))))
        val t = Crypto.transcript(s("pkD"), s("pkK"), s("nD2"), s("nK2"))
        val k = Crypto.pairKey(z1, t)
        assertEquals(s("K"), Crypto.b64(k))
        assertEquals(s("code"), Crypto.code(t))
        assertEquals(s("authDesk"), Crypto.authMac(k, "desk", s("nK"), s("nD")))
        assertEquals(s("authDeck"), Crypto.authMac(k, "deck", s("nK"), s("nD")))
        assertEquals(s("doneDesk"), Crypto.doneMac(k, "desk"))
        assertEquals(s("doneDeck"), Crypto.doneMac(k, "deck"))
        val sess = Crypto.sessionKey(k, s("nK"), s("nD"))
        assertEquals(s("S"), Crypto.b64(sess))
        assertEquals(s("envMac"), Crypto.envMac(sess, s("envDir"), v.getLong("envN"), s("envP")))
    }
}
