package com.diakolight.model

import kotlin.math.floor

/**
 * Tap tempo, same behaviour as VCSpeedDial::tap() of QLC+: a pause longer than
 * [resetAfterMs] starts a new measure, and the period is the least-squares fit
 * of the last 16 intervals (a skipped tap counts as two beats).
 * Timing is measured on the tablet so Wi-Fi latency does not add jitter.
 */
class TapTempo(private val resetAfterMs: Long = 1500) {
    private var lastTap = 0L
    private val intervals = ArrayList<Long>()

    /** Registers a tap at [timeMs]; returns the period in ms, or null on the first tap of a measure. */
    fun tap(timeMs: Long): Long? {
        val prev = lastTap
        lastTap = timeMs
        if (prev == 0L || timeMs - prev >= resetAfterMs || timeMs <= prev) {
            intervals.clear()
            return null
        }
        intervals += timeMs - prev
        while (intervals.size > 16) intervals.removeAt(0)
        return period(intervals).takeIf { it > 0 }
    }

    fun reset() {
        lastTap = 0
        intervals.clear()
    }

    val tapCount: Int get() = if (lastTap == 0L) 0 else intervals.size + 1

    companion object {
        fun period(intervals: List<Long>): Long {
            val median = intervals.sorted()[intervals.size / 2].toDouble()
            var n = 1.0; var x = 0.0; var y = 0.0
            var sx = 0.0; var sy = 0.0; var sxx = 0.0; var sxy = 0.0
            for (iv in intervals) {
                n++
                x += floor((median / 2 + iv) / median)
                y += iv
                sx += x; sy += y; sxx += x * x; sxy += x * y
            }
            val denom = n * sxx - sx * sx
            if (denom == 0.0) return intervals.last()
            return ((n * sxy - sx * sy) / denom).toLong()
        }
    }
}
