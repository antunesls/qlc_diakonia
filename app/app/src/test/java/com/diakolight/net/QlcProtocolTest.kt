package com.diakonia.qlccockpit.net

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class QlcProtocolTest {

    @Test
    fun parsesApiReplies() {
        val e = QlcProtocol.parse("QLC+API|getFunctionsList|0|Scene 1|3|My|Chaser") as QlcEvent.ApiReply
        assertEquals("getFunctionsList", e.command)
        assertEquals(listOf("0", "Scene 1", "3", "My", "Chaser"), e.args)

        val v = QlcProtocol.parse("QLC+API|getApiVersion|cockpit-1") as QlcEvent.ApiReply
        assertEquals(listOf("cockpit-1"), v.args)
    }

    @Test
    fun parsesIdNameList() {
        assertEquals(
            listOf(0 to "Scene 1", 3 to "Blue"),
            QlcProtocol.parseIdNameList(listOf("0", "Scene 1", "3", "Blue")),
        )
        assertEquals(emptyList<Pair<Int, String>>(), QlcProtocol.parseIdNameList(emptyList()))
    }

    @Test
    fun parsesChannelsValues() {
        // <ch 1-based>|<value>|<type>|<override>
        val args = "1|255|0.#FF0000|0|2|10||1".split('|')
        assertEquals(listOf(0 to 255, 1 to 10), QlcProtocol.parseChannelsValues(args))
    }

    @Test
    fun parsesPushes() {
        assertEquals(QlcEvent.FunctionStatus(5, true), QlcProtocol.parse("FUNCTION|5|Running"))
        assertEquals(QlcEvent.FunctionStatus(5, false), QlcProtocol.parse("FUNCTION|5|Stopped"))
        assertEquals(QlcEvent.GrandMaster(128), QlcProtocol.parse("GM_VALUE|128|50%"))
        assertEquals(QlcEvent.VcPage(2), QlcProtocol.parse("VC_PAGE|2"))
        assertEquals(QlcEvent.Blackout(true), QlcProtocol.parse("BLACKOUT|1"))
        assertEquals(QlcEvent.ChaserStep(7, 3), QlcProtocol.parse("CHASER_STEP|7|3"))
        assertEquals(QlcEvent.ShowTime(9, 12500, true), QlcProtocol.parse("SHOW_TIME|9|12500|1"))
        assertEquals(QlcEvent.DocChanged, QlcProtocol.parse("DOC_CHANGED"))
        assertEquals(QlcEvent.Alert("a|b"), QlcProtocol.parse("ALERT|a|b"))
    }

    @Test
    fun parsesUniverseFrame() {
        val bytes = ByteArray(512) { (it % 256).toByte() }
        val msg = "UNIVERSE|1|" + Base64.getEncoder().encodeToString(bytes)
        val e = QlcProtocol.parse(msg) as QlcEvent.UniverseFrame
        assertEquals(1, e.universe)
        assertArrayEquals(bytes, e.values)
    }

    @Test
    fun parsesWidgetPushes() {
        assertEquals(QlcEvent.Widget(12, "BUTTON", listOf("255")), QlcProtocol.parse("12|BUTTON|255"))
        assertEquals(
            QlcEvent.Widget(3, "CUE_STATE", listOf("1", "4", "5", "0", "1")),
            QlcProtocol.parse("3|CUE_STATE|1|4|5|0|1"),
        )
        assertTrue(QlcProtocol.parse("garbage") is QlcEvent.Unknown)
        assertTrue(QlcProtocol.parse("FUNCTION|x|Running") is QlcEvent.Unknown)
    }

    @Test
    fun buildsCommands() {
        assertEquals("CH|1|255", QlcCommands.channel(0, 0, 255))
        assertEquals("CH|513|0", QlcCommands.channel(1, 0, -4))
        assertEquals("QLC+API|getChannelsValues|1|1|512", QlcCommands.getChannelsValues(0, 0, 512))
        assertEquals("QLC+API|setFunctionStatus|4|1", QlcCommands.setFunctionStatus(4, true))
        assertEquals("QLC+API|setFixtureChannel|2|3|100", QlcCommands.setFixtureChannel(2, 3, 100))
        assertEquals("QLC+API|setFixtureChannels|2|0:255,1:300".replace("300", "255"),
            QlcCommands.setFixtureChannels(2, linkedMapOf(0 to 255, 1 to 300)))
        assertEquals("QLC+API|chaserStep|8|NEXT", QlcCommands.chaserNext(8))
        assertEquals("QLC+API|chaserStep|8|2", QlcCommands.chaserGoto(8, 2))
        assertEquals("QLC+API|sdResetChannel|514", QlcCommands.resetChannel(1, 1))
        assertEquals("10|STEP|3", QlcCommands.widget(10, "STEP", 3))
        assertEquals("10|CUE_STEP_NOTE|1|a/b", QlcCommands.widget(10, "CUE_STEP_NOTE", 1, "a|b"))
        assertEquals("GM_VALUE|255", QlcCommands.grandMaster(999))
    }
}
