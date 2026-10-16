package com.diakonia.qlccockpit.model

import kotlinx.serialization.Serializable

/** Models of the JSON resources exposed by the QLC+ Cockpit API fork (/api/<name>.json). */

@Serializable
data class ApiInfo(
    val apiVersion: String = "",
    val appName: String = "",
    val appVersion: String = "",
    val workspace: String = "",
    val blackout: Boolean = false,
    val grandMaster: Int = 255,
    val universes: List<UniverseInfo> = emptyList(),
)

@Serializable
data class UniverseInfo(val id: Int, val name: String)

@Serializable
data class FixturesResponse(val fixtures: List<Fixture> = emptyList())

@Serializable
data class Fixture(
    val id: Int,
    val name: String,
    val type: String = "",
    val universe: Int = 0,
    /** zero-based DMX address inside the universe */
    val address: Int = 0,
    val channelsCount: Int = 0,
    val heads: Int = 1,
    val manufacturer: String = "",
    val model: String = "",
    val mode: String = "",
    val channels: List<FixtureChannel> = emptyList(),
) {
    /** 1-based address, as shown to lighting operators */
    val displayAddress: Int get() = address + 1
}

@Serializable
data class FixtureChannel(
    val index: Int,
    val name: String,
    val group: String = "",
    val groupId: Int = ChannelGroup.NO_GROUP,
    val colour: String = "",
    val controlByte: Int = 0,
    val default: Int = 0,
    val capabilities: List<Capability> = emptyList(),
)

@Serializable
data class Capability(
    val min: Int,
    val max: Int,
    val name: String,
    val presetType: Int = 0,
    val color1: String? = null,
    val color2: String? = null,
)

/** Mirrors QLCChannel::Group */
object ChannelGroup {
    const val INTENSITY = 0
    const val COLOUR = 1
    const val GOBO = 2
    const val SPEED = 3
    const val PAN = 4
    const val TILT = 5
    const val SHUTTER = 6
    const val PRISM = 7
    const val BEAM = 8
    const val EFFECT = 9
    const val MAINTENANCE = 10
    const val NOTHING = 11
    const val NO_GROUP = 12
}

@Serializable
data class GroupsResponse(
    val fixtureGroups: List<FixtureGroup> = emptyList(),
    val channelsGroups: List<ChannelsGroup> = emptyList(),
)

@Serializable
data class FixtureGroup(
    val id: Int,
    val name: String,
    val width: Int = 0,
    val height: Int = 0,
    val heads: List<GroupHead> = emptyList(),
)

@Serializable
data class GroupHead(val x: Int, val y: Int, val fixtureId: Int, val head: Int)

@Serializable
data class ChannelsGroup(
    val id: Int,
    val name: String,
    val channels: List<GroupChannel> = emptyList(),
)

@Serializable
data class GroupChannel(val fixtureId: Int, val channel: Int)

@Serializable
data class FunctionsResponse(val functions: List<QlcFunction> = emptyList())

@Serializable
data class QlcFunction(
    val id: Int,
    val name: String,
    val type: String = "",
    val typeId: Int = 0,
    val path: String = "",
    val running: Boolean = false,
    val paused: Boolean = false,
    val fadeIn: Long = 0,
    val fadeOut: Long = 0,
    val duration: Long = 0,
    val totalDuration: Long = 0,
    val currentStep: Int = -1,
    val boundSceneId: Int? = null,
    val steps: List<ChaserStep> = emptyList(),
    val functions: List<Int> = emptyList(),
    val elapsed: Long = 0,
    val tracks: List<ShowTrack> = emptyList(),
) {
    val kind: FunctionKind get() = FunctionKind.fromTypeString(type)
}

@Serializable
data class ChaserStep(
    val index: Int,
    val functionId: Int,
    val functionName: String = "",
    val fadeIn: Long = 0,
    val hold: Long = 0,
    val fadeOut: Long = 0,
    val duration: Long = 0,
    val note: String = "",
)

@Serializable
data class ShowTrack(
    val id: Int,
    val name: String,
    val functions: List<ShowItem> = emptyList(),
)

@Serializable
data class ShowItem(
    val functionId: Int,
    val functionName: String = "",
    val startTime: Long = 0,
    val duration: Long = 0,
)

enum class FunctionKind(val label: String) {
    Scene("Scene"),
    Chaser("Chaser"),
    Sequence("Sequence"),
    EFX("EFX"),
    Collection("Collection"),
    Script("Script"),
    RGBMatrix("RGB Matrix"),
    Show("Show"),
    Audio("Audio"),
    Video("Video"),
    Unknown("?");

    val isStepBased: Boolean get() = this == Chaser || this == Sequence

    companion object {
        /** Function::typeString() values of QLC+ */
        fun fromTypeString(type: String): FunctionKind = when (type) {
            "Scene" -> Scene
            "Chaser" -> Chaser
            "Sequence" -> Sequence
            "EFX" -> EFX
            "Collection" -> Collection
            "Script" -> Script
            "RGBMatrix" -> RGBMatrix
            "Show" -> Show
            "Audio" -> Audio
            "Video" -> Video
            else -> Unknown
        }
    }
}
