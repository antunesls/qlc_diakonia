package com.diakolight.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TapTempoTest {
    @Test
    fun firstTapGivesNothing() {
        assertNull(TapTempo().tap(1000))
    }

    @Test
    fun steadyTapsGiveThePeriod() {
        val t = TapTempo()
        var last: Long? = null
        for (i in 0 until 6) last = t.tap(1000L + i * 500)
        assertEquals(500L, last)
    }

    @Test
    fun jitterIsAveraged() {
        val t = TapTempo()
        var last: Long? = null
        listOf(0L, 510, 990, 1505, 2000, 2495, 3010).forEach { last = t.tap(10_000 + it) }
        assertEquals(500.0, last!!.toDouble(), 10.0)
    }

    @Test
    fun skippedTapCountsAsTwoBeats() {
        val t = TapTempo(resetAfterMs = 3000)
        var last: Long? = null
        listOf(0L, 500, 1000, 2000, 2500, 3000).forEach { last = t.tap(10_000 + it) }
        assertEquals(500.0, last!!.toDouble(), 10.0)
    }

    @Test
    fun longPauseStartsNewMeasure() {
        val t = TapTempo()
        t.tap(1000); t.tap(1500)
        assertNull(t.tap(5000))
        assertEquals(400L, t.tap(5400))
    }
}
