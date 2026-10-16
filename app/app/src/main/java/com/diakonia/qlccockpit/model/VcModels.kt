package com.diakonia.qlccockpit.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/** Mirrors VCWidget::WidgetType of the QLC+ 5 QML UI */
enum class VcWidgetType {
    Unknown, Button, Slider, XYPad, Frame, SoloFrame, Speed, CueList, Label, AudioTriggers, Animation, Clock;

    val isFrame: Boolean get() = this == Frame || this == SoloFrame

    companion object {
        fun fromId(id: Int): VcWidgetType = entries.getOrElse(id) { Unknown }
    }
}

data class VcRect(val x: Float, val y: Float, val w: Float, val h: Float)

/**
 * A Virtual Console widget as described by /vc.json.
 * Type-specific fields are kept in [raw] and read through the helpers below,
 * so new QLC+ fields never break parsing.
 */
data class VcWidget(
    val id: Int,
    val type: VcWidgetType,
    val caption: String,
    val page: Int,
    val geometry: VcRect,
    val visible: Boolean,
    val disabled: Boolean,
    val bgColor: String?,
    val fgColor: String?,
    val children: List<VcWidget>,
    val raw: JsonObject,
) {
    fun int(key: String, def: Int = 0): Int = raw.prim(key)?.intOrNull ?: raw.prim(key)?.doubleOrNull?.toInt() ?: def
    fun long(key: String, def: Long = 0): Long = raw.prim(key)?.longOrNull ?: def
    fun double(key: String, def: Double = 0.0): Double = raw.prim(key)?.doubleOrNull ?: def
    fun bool(key: String, def: Boolean = false): Boolean = raw.prim(key)?.booleanOrNull ?: def
    fun string(key: String): String? = raw.prim(key)?.let { if (it.isString) it.content else it.toString() }
    fun stringList(key: String): List<String> =
        (raw[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
    fun objects(key: String): List<JsonObject> =
        (raw[key] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

    /** Flattened tree including this widget */
    fun flatten(): List<VcWidget> = listOf(this) + children.flatMap { it.flatten() }

    /** Cue list steps (only for CueList widgets) */
    val cueSteps: List<VcCueStep>
        get() = objects("steps").mapIndexed { i, o ->
            VcCueStep(
                index = i,
                functionId = o.prim("funcID")?.content?.toIntOrNull() ?: -1,
                functionName = o.prim("funcName")?.content ?: "",
                fadeIn = o.prim("fadeIn")?.content ?: "",
                hold = o.prim("hold")?.content ?: "",
                fadeOut = o.prim("fadeOut")?.content ?: "",
                note = o.prim("note")?.content ?: "",
            )
        }
}

data class VcCueStep(
    val index: Int,
    val functionId: Int,
    val functionName: String,
    val fadeIn: String,
    val hold: String,
    val fadeOut: String,
    val note: String,
)

data class VcRoot(
    val selectedPage: Int,
    val pages: List<VcWidget>,
) {
    val allWidgets: Map<Int, VcWidget> by lazy {
        pages.flatMap { it.flatten() }.associateBy { it.id }
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }

        fun parse(text: String): VcRoot {
            val root = json.parseToJsonElement(text).jsonObject
            val pages = (root["pages"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::parseWidget) }
                ?: emptyList()
            return VcRoot(
                selectedPage = root.prim("selectedPage")?.intOrNull ?: 0,
                pages = pages,
            )
        }

        private fun parseWidget(o: JsonObject): VcWidget {
            val geo = o["geometry"] as? JsonObject
            return VcWidget(
                id = o.prim("id")?.intOrNull ?: -1,
                type = VcWidgetType.fromId(o.prim("typeId")?.intOrNull ?: 0),
                caption = o.prim("caption")?.content ?: "",
                page = o.prim("page")?.intOrNull ?: 0,
                geometry = VcRect(
                    x = geo?.prim("x")?.doubleOrNull?.toFloat() ?: 0f,
                    y = geo?.prim("y")?.doubleOrNull?.toFloat() ?: 0f,
                    w = geo?.prim("w")?.doubleOrNull?.toFloat() ?: 0f,
                    h = geo?.prim("h")?.doubleOrNull?.toFloat() ?: 0f,
                ),
                visible = o.prim("visible")?.booleanOrNull ?: true,
                disabled = o.prim("disabled")?.booleanOrNull ?: false,
                bgColor = o.prim("bgColor")?.content?.takeIf { it.isNotEmpty() },
                fgColor = o.prim("fgColor")?.content?.takeIf { it.isNotEmpty() },
                children = (o["children"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::parseWidget) }
                    ?: emptyList(),
                raw = o,
            )
        }
    }
}

private fun JsonObject.prim(key: String): JsonPrimitive? {
    val e: JsonElement = this[key] ?: return null
    if (e is JsonNull) return null
    return e as? JsonPrimitive
}

/** Live state of a VC widget, updated from WebSocket pushes */
data class VcWidgetState(
    /** Button: 0 inactive, 127 monitoring, 255 active. Slider: value. Animation: fader level */
    val value: Int? = null,
    val displayValue: String? = null,
    val disabled: Boolean? = null,
    val visible: Boolean? = null,
    /** Cue list */
    val cueIndex: Int? = null,
    val cueStatus: Int? = null,
    val cueNextIndex: Int? = null,
    val sideFader: Int? = null,
    /** Frames */
    val framePage: Int? = null,
    /** Clock: milliseconds (or seconds of day for Clock type) */
    val clockTime: Long? = null,
    val clockRunning: Boolean? = null,
    /** XY pad position */
    val xyX: Double? = null,
    val xyY: Double? = null,
    /** Speed dial */
    val speedTime: Long? = null,
    val speedFactor: Int? = null,
    /** Animation */
    val algorithmIndex: Int? = null,
    val colors: List<String>? = null,
)
