package com.diakonia.qlccockpit.model

import kotlin.math.max

/** What a fixture is emitting right now: colour channels (0..1) and master intensity (0..1). */
data class FixtureLight(val r: Float, val g: Float, val b: Float, val level: Float) {
    /** Overall brightness, 0 = dark */
    val intensity: Float get() = level * max(r, max(g, b))
    val isDark: Boolean get() = intensity < 0.02f
}

/**
 * Derives the emitted light of [fx] from its DMX channel values. [value] receives the channel
 * index inside the fixture (0-based) and returns 0..255.
 */
fun fixtureLight(fx: Fixture, value: (Int) -> Int): FixtureLight {
    fun find(colour: String) = fx.channels.firstOrNull {
        it.groupId == ChannelGroup.INTENSITY && it.colour == colour && it.controlByte == 0
    }?.index
    fun v(ch: Int?) = if (ch == null) 0f else value(ch) / 255f

    val dimmer = fx.channels.firstOrNull {
        it.groupId == ChannelGroup.INTENSITY && (it.colour.isEmpty() || it.colour == "Generic") && it.controlByte == 0
    }?.index
    val level = if (dimmer == null) 1f else v(dimmer)

    val red = find("Red"); val green = find("Green"); val blue = find("Blue")
    val cyan = find("Cyan"); val magenta = find("Magenta"); val yellow = find("Yellow")
    val white = v(find("White"))
    return when {
        red != null && green != null && blue != null ->
            FixtureLight(minOf(1f, v(red) + white), minOf(1f, v(green) + white), minOf(1f, v(blue) + white), level)
        cyan != null && magenta != null && yellow != null ->
            FixtureLight(1f - v(cyan), 1f - v(magenta), 1f - v(yellow), level)
        dimmer != null || white > 0f -> FixtureLight(1f, 0.88f, 0.65f, max(level, white))
        else -> FixtureLight(0.4f, 0.4f, 0.4f, 0f)
    }
}
