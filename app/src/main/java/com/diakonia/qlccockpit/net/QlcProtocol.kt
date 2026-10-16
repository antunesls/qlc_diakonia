package com.diakonia.qlccockpit.net

import java.util.Base64

/** Messages received from the QLC+ web access WebSocket. */
sealed interface QlcEvent {
    /** Reply to a "QLC+API|<command>|..." request. [args] are the fields after the command name. */
    data class ApiReply(val command: String, val args: List<String>) : QlcEvent

    data class FunctionStatus(val functionId: Int, val running: Boolean) : QlcEvent
    data class GrandMaster(val value: Int) : QlcEvent
    data class VcPage(val page: Int) : QlcEvent
    data class Blackout(val on: Boolean) : QlcEvent
    data class UniverseFrame(val universe: Int, val values: ByteArray) : QlcEvent {
        override fun equals(other: Any?) =
            other is UniverseFrame && other.universe == universe && other.values.contentEquals(values)
        override fun hashCode() = 31 * universe + values.contentHashCode()
    }
    data class ChaserStep(val functionId: Int, val step: Int) : QlcEvent
    data class ShowTime(val functionId: Int, val elapsedMs: Long, val paused: Boolean) : QlcEvent
    data object DocChanged : QlcEvent
    data class Alert(val text: String) : QlcEvent

    /** "<widgetId>|<KIND>|args..." push from a Virtual Console widget */
    data class Widget(val widgetId: Int, val kind: String, val args: List<String>) : QlcEvent

    data class Unknown(val raw: String) : QlcEvent
}

object QlcProtocol {

    fun parse(message: String): QlcEvent {
        val f = message.split('|')
        if (f.isEmpty()) return QlcEvent.Unknown(message)

        return when (f[0]) {
            "QLC+API" -> {
                if (f.size < 2) QlcEvent.Unknown(message)
                else QlcEvent.ApiReply(f[1], f.drop(2))
            }
            "FUNCTION" -> {
                val id = f.getOrNull(1)?.toIntOrNull()
                if (id == null || f.size < 3) QlcEvent.Unknown(message)
                else QlcEvent.FunctionStatus(id, f[2] == "Running")
            }
            "GM_VALUE" -> f.getOrNull(1)?.toIntOrNull()?.let { QlcEvent.GrandMaster(it) } ?: QlcEvent.Unknown(message)
            "VC_PAGE" -> f.getOrNull(1)?.toIntOrNull()?.let { QlcEvent.VcPage(it) } ?: QlcEvent.Unknown(message)
            "BLACKOUT" -> QlcEvent.Blackout(parseBool(f.getOrNull(1)))
            "UNIVERSE" -> {
                val uni = f.getOrNull(1)?.toIntOrNull()
                val data = f.getOrNull(2)
                if (uni == null || data == null) QlcEvent.Unknown(message)
                else runCatching { QlcEvent.UniverseFrame(uni, Base64.getDecoder().decode(data)) }
                    .getOrElse { QlcEvent.Unknown(message) }
            }
            "CHASER_STEP" -> {
                val id = f.getOrNull(1)?.toIntOrNull()
                val step = f.getOrNull(2)?.toIntOrNull()
                if (id == null || step == null) QlcEvent.Unknown(message) else QlcEvent.ChaserStep(id, step)
            }
            "SHOW_TIME" -> {
                val id = f.getOrNull(1)?.toIntOrNull()
                val ms = f.getOrNull(2)?.toLongOrNull()
                if (id == null || ms == null) QlcEvent.Unknown(message)
                else QlcEvent.ShowTime(id, ms, parseBool(f.getOrNull(3)))
            }
            "DOC_CHANGED" -> QlcEvent.DocChanged
            "ALERT" -> QlcEvent.Alert(f.drop(1).joinToString("|"))
            else -> {
                val wid = f[0].toIntOrNull()
                if (wid != null && f.size >= 2) QlcEvent.Widget(wid, f[1], f.drop(2))
                else QlcEvent.Unknown(message)
            }
        }
    }

    /** QLC+ sends booleans as "1"/"0" or "true"/"false" */
    fun parseBool(s: String?): Boolean = s == "1" || s.equals("true", ignoreCase = true)

    /**
     * Parse the payload of a getChannelsValues reply: repeated "<ch 1-based>|<value>|<type>|<override>".
     * Returns pairs of (0-based channel inside the universe, value).
     */
    fun parseChannelsValues(args: List<String>): List<Pair<Int, Int>> {
        val out = ArrayList<Pair<Int, Int>>(args.size / 4)
        var i = 0
        while (i + 1 < args.size) {
            val ch = args[i].toIntOrNull()
            val v = args[i + 1].toIntOrNull()
            if (ch != null && v != null) out += (ch - 1) to v
            i += 4
        }
        return out
    }

    /** Parse "QLC+API|getFunctionsList|id|name|id|name..." args */
    fun parseIdNameList(args: List<String>): List<Pair<Int, String>> {
        val out = ArrayList<Pair<Int, String>>()
        var i = 0
        while (i + 1 < args.size) {
            args[i].toIntOrNull()?.let { out += it to args[i + 1] }
            i += 2
        }
        return out
    }
}

/** Builders of the messages sent to QLC+. Pipes inside free text are replaced to keep framing intact. */
object QlcCommands {
    private fun api(vararg parts: Any) = "QLC+API|" + parts.joinToString("|")

    // --- upstream API ---
    fun isProjectLoaded() = api("isProjectLoaded")
    fun getFunctionsList() = api("getFunctionsList")
    fun getFunctionType(id: Int) = api("getFunctionType", id)
    fun getFunctionStatus(id: Int) = api("getFunctionStatus", id)
    fun setFunctionStatus(id: Int, running: Boolean) = api("setFunctionStatus", id, if (running) 1 else 0)
    fun getChannelsValues(universe0: Int, startAddr0: Int, count: Int) =
        api("getChannelsValues", universe0 + 1, startAddr0 + 1, count)
    fun resetChannel(universe0: Int, address0: Int) = api("sdResetChannel", universe0 * 512 + address0 + 1)
    fun resetUniverse(universe0: Int) = api("sdResetUniverse", universe0 + 1)

    /** Simple Desk absolute channel (universe and address are 0-based) */
    fun channel(universe0: Int, address0: Int, value: Int) = "CH|${universe0 * 512 + address0 + 1}|${value.coerceIn(0, 255)}"
    fun grandMaster(value: Int) = "GM_VALUE|${value.coerceIn(0, 255)}"
    fun vcPage(page: Int) = "VC_PAGE|$page"
    fun widget(widgetId: Int, vararg parts: Any) = "$widgetId|" + parts.joinToString("|") { it.toString().replace('|', '/') }
    const val POLL = "POLL"

    // --- Cockpit API fork ---
    fun getApiVersion() = api("getApiVersion")
    fun setFixtureChannel(fixtureId: Int, channel: Int, value: Int) =
        api("setFixtureChannel", fixtureId, channel, value.coerceIn(0, 255))
    fun setFixtureChannels(fixtureId: Int, values: Map<Int, Int>) =
        api("setFixtureChannels", fixtureId, values.entries.joinToString(",") { "${it.key}:${it.value.coerceIn(0, 255)}" })
    fun releaseFixture(fixtureId: Int) = api("releaseFixture", fixtureId)
    fun subscribeUniverse(universe0: Int, on: Boolean) = api("subscribeUniverse", universe0, if (on) 1 else 0)
    fun setFunctionIntensity(id: Int, value: Int) = api("setFunctionIntensity", id, value.coerceIn(0, 255))
    fun pauseFunction(id: Int, paused: Boolean) = api("pauseFunction", id, if (paused) 1 else 0)
    fun seekFunction(id: Int, ms: Long) = api("seekFunction", id, ms.coerceAtLeast(0))
    fun chaserNext(id: Int) = api("chaserStep", id, "NEXT")
    fun chaserPrev(id: Int) = api("chaserStep", id, "PREV")
    fun chaserGoto(id: Int, index: Int) = api("chaserStep", id, index)
    fun stopAllFunctions() = api("stopAllFunctions")
    fun blackout(on: Boolean) = api("blackout", if (on) 1 else 0)
    fun queryBlackout() = api("blackout")
}
