package com.oscardevelopments.deckwell

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.util.Base64
import java.io.File

/** Fonts, glyph bitmaps (white, tinted at draw time) and the icon cache. */
class Res(private val ctx: Context) {
    val regular: Typeface = font("inter_regular")
    val medium: Typeface = font("inter_medium")
    val semibold: Typeface = font("inter_semibold")
    val mono: Typeface = font("mono_regular")
    val monoBold: Typeface = font("mono_bold")

    private fun font(n: String): Typeface = try { Typeface.createFromAsset(ctx.assets, "fonts/$n.ttf") } catch (_: Exception) { Typeface.DEFAULT }

    private val glyphs = HashMap<String, Bitmap?>()
    fun glyph(name: String?): Bitmap? {
        if (name == null) return null
        return glyphs.getOrPut(name) {
            val id = ctx.resources.getIdentifier("g_" + name.replace('-', '_'), "drawable", ctx.packageName)
            if (id == 0) null else BitmapFactory.decodeResource(ctx.resources, id, BitmapFactory.Options().apply { inScaled = false })
        }
    }

    private val iconDir = File(ctx.filesDir, "icons").apply { mkdirs() }
    private val icons = object : LinkedHashMap<String, Bitmap?>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap?>?) = size > 80
    }

    fun hasIcon(id: String) = File(iconDir, "$id.png").exists()

    fun icon(id: String?): Bitmap? {
        if (id == null) return null
        icons[id]?.let { return it }
        val f = File(iconDir, "$id.png")
        if (!f.exists()) return null
        val b = try { BitmapFactory.decodeFile(f.absolutePath) } catch (_: Throwable) { null }
        icons[id] = b
        return b
    }

    fun storeIcon(id: String, b64: String) {
        if (id.contains('/') || id.contains("..")) return
        try {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            File(iconDir, "$id.png").writeBytes(bytes)
            icons.remove(id)
        } catch (_: Exception) { }
    }

    fun pruneArt(keep: Set<String>) {
        iconDir.listFiles()?.filter { it.name.startsWith("np-") }?.sortedByDescending { it.lastModified() }?.drop(20)
            ?.filter { it.nameWithoutExtension !in keep }?.forEach { it.delete() }
    }
}
