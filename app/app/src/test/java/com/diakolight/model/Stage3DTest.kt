package com.diakonia.qlccockpit.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Stage3DTest {
    private fun par(id: Int, addr: Int, pos: Vec3? = null) = Fixture(
        id = id, name = "PAR $id", universe = 0, address = addr, channelsCount = 6, position = pos,
        channels = listOf(
            FixtureChannel(0, "Dimmer", "Intensity", 0, "Generic"),
            FixtureChannel(1, "Red", "Intensity", 0, "Red"),
            FixtureChannel(2, "Green", "Intensity", 0, "Green"),
            FixtureChannel(3, "Blue", "Intensity", 0, "Blue"),
        ),
    )

    @Test fun cameraTargetProjectsToTheCenter() {
        val cam = OrbitCamera(yaw = 0.7f, pitch = 0.4f, distance = 8f, target = P3(2f, 1f, 3f))
        val p = Projector(cam, 1000f, 600f).project(cam.target)!!
        assertEquals(500f, p.x, 0.5f)
        assertEquals(300f, p.y, 0.5f)
        assertEquals(8f, p.depth, 0.01f)
    }

    @Test fun rightOfTheStageIsRightOnScreenFromTheAudience() {
        val cam = OrbitCamera(yaw = 0f, pitch = 0.2f, distance = 8f, target = P3(0f, 1f, 0f))
        val pr = Projector(cam, 1000f, 600f)
        assertTrue(pr.project(P3(2f, 1f, 0f))!!.x > pr.project(P3(-2f, 1f, 0f))!!.x)
        assertTrue(pr.project(P3(0f, 3f, 0f))!!.y < pr.project(P3(0f, 0f, 0f))!!.y) // higher = smaller y
    }

    @Test fun pointBehindTheCameraIsNotProjected() {
        val cam = OrbitCamera(yaw = 0f, pitch = 0f, distance = 5f, target = P3(0f, 0f, 0f))
        assertNull(Projector(cam, 800f, 600f).project(P3(0f, 0f, 20f)))
    }

    @Test fun layoutUsesMonitorPlacementInMeters() {
        val l = stageLayout(listOf(par(0, 0, Vec3(2830.0, 1593.0, 1000.0))))
        assertEquals(P3(2.83f, 1.593f, 1f), l[0])
    }

    @Test fun unplacedFixturesStandInARowByAddress() {
        val l = stageLayout(listOf(par(2, 16), par(1, 0), par(3, 32)))
        assertTrue(l[1]!!.x < l[2]!!.x && l[2]!!.x < l[3]!!.x)
        assertEquals(0f, l[2]!!.x, 0.001f)
    }

    @Test fun framingCameraKeepsEveryFixtureOnScreen() {
        val l = stageLayout((1..8).map { par(it, it * 16, Vec3(it * 625.0, 1593.0, 1000.0)) })
        val cam = framingCamera(l.values)
        val pr = Projector(cam, 1280f, 800f)
        l.values.forEach {
            val p = assertNotNull(pr.project(it)).let { _ -> pr.project(it)!! }
            assertTrue(p.x in 0f..1280f && p.y in 0f..800f)
        }
    }

    @Test fun lightIsDimmerTimesColour() {
        val fx = par(1, 0)
        val l = fixtureLight(fx) { mapOf(0 to 128, 1 to 255, 2 to 0, 3 to 0)[it] ?: 0 }
        assertEquals(1f, l.r, 0.01f)
        assertEquals(0f, l.g, 0.01f)
        assertEquals(128 / 255f, l.level, 0.01f)
        assertEquals(128 / 255f, l.intensity, 0.01f)
    }

    @Test fun closedDimmerIsDarkEvenWithColour() {
        val l = fixtureLight(par(1, 0)) { mapOf(1 to 255, 2 to 255, 3 to 255)[it] ?: 0 }
        assertTrue(l.isDark)
    }

    @Test fun fixtureWithoutColourChannelsUsesWarmWhite() {
        val dimmerOnly = Fixture(
            id = 5, name = "Dimmer", channelsCount = 1,
            channels = listOf(FixtureChannel(0, "Dimmer", "Intensity", 0, "Generic")),
        )
        val l = fixtureLight(dimmerOnly) { 255 }
        assertEquals(1f, l.intensity, 0.01f)
        assertTrue(l.r >= l.g && l.g >= l.b)
    }
}
