package com.diakonia.qlccockpit.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.model.TapTempo
import com.diakonia.qlccockpit.model.VcWidget
import com.diakonia.qlccockpit.model.VcWidgetState
import com.diakonia.qlccockpit.model.VcWidgetType
import com.diakonia.qlccockpit.ui.components.XYPad
import com.diakonia.qlccockpit.ui.theme.CockpitColors
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlinx.coroutines.delay

/** Renders the QLC+ Virtual Console (/vc.json) scaled to the tablet width. */
@Composable
fun VirtualConsoleScreen(state: CockpitState, repository: CockpitRepository) {
    val vc = state.vc
    if (vc == null || vc.pages.isEmpty()) {
        EmptyHint(if (state.isConnected) "O projeto não tem Virtual Console." else "Conecte-se a um servidor QLC+.")
        return
    }
    val pageIndex = state.vcPage.coerceIn(0, vc.pages.lastIndex)
    val page = vc.pages[pageIndex]

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (vc.pages.size > 1) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                vc.pages.forEachIndexed { i, p ->
                    FilterChip(
                        selected = i == pageIndex,
                        onClick = { repository.vcSelectPage(i) },
                        label = { Text(p.caption.ifEmpty { "Página ${i + 1}" }) },
                    )
                }
            }
        }

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val density = LocalDensity.current
            val visibleChildren = page.children.filter { it.visible }
            val contentW = (visibleChildren.maxOfOrNull { it.geometry.x + it.geometry.w } ?: 1f).coerceAtLeast(1f)
            val contentH = (visibleChildren.maxOfOrNull { it.geometry.y + it.geometry.h } ?: 1f).coerceAtLeast(1f)
            val availPx = with(density) { maxWidth.toPx() }
            // QLC+ px -> tablet px
            val scale = availPx / contentW
            val heightDp = with(density) { (contentH * scale).toDp() }

            Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Box(Modifier.fillMaxWidth().height(heightDp)) {
                    visibleChildren.forEach { w -> PositionedWidget(w, scale, state, repository) }
                }
            }
        }
    }
}

@Composable
private fun PositionedWidget(w: VcWidget, scale: Float, state: CockpitState, repository: CockpitRepository) {
    val live = state.widgets[w.id] ?: VcWidgetState()
    if (live.visible == false || (!w.visible && live.visible != true)) return
    val density = LocalDensity.current
    val wDp = with(density) { (w.geometry.w * scale).toDp() }
    val hDp = with(density) { (w.geometry.h * scale).toDp() }
    Box(
        Modifier
            .offset { IntOffset((w.geometry.x * scale).roundToInt(), (w.geometry.y * scale).roundToInt()) }
            .size(wDp, hDp),
    ) {
        VcWidgetView(w, live, scale, state, repository)
    }
}

private fun widgetBg(w: VcWidget, fallback: Color): Color = w.bgColor?.let { parseHexColor(it) } ?: fallback
private fun widgetFg(w: VcWidget, fallback: Color): Color = w.fgColor?.let { parseHexColor(it) } ?: fallback

@Composable
private fun VcWidgetView(
    w: VcWidget,
    live: VcWidgetState,
    scale: Float,
    state: CockpitState,
    repository: CockpitRepository,
) {
    val disabled = live.disabled ?: w.disabled
    val shape = RoundedCornerShape(6.dp)
    val surface = MaterialTheme.colorScheme.surface
    val baseModifier = Modifier.fillMaxSize().padding(1.dp).clip(shape)

    when (w.type) {
        VcWidgetType.Frame, VcWidgetType.SoloFrame -> {
            val multi = w.bool("multiPageMode")
            val current = live.framePage ?: w.int("currentPage")
            val total = w.int("totalPages", 1)
            val labels = w.stringList("pageLabels")
            val collapsed = w.bool("isCollapsed")
            Box(
                baseModifier
                    .background(widgetBg(w, surface.copy(alpha = 0.6f)))
                    .border(1.dp, if (w.type == VcWidgetType.SoloFrame) CockpitColors.Danger.copy(alpha = 0.6f)
                    else MaterialTheme.colorScheme.outline, shape),
            ) {
                if (!collapsed) {
                    w.children
                        .filter { !multi || it.page == current }
                        .forEach { child -> PositionedWidget(child, scale, state, repository) }
                }
                if (w.bool("showHeader", true) && (w.caption.isNotEmpty() || multi)) {
                    Row(
                        Modifier.fillMaxWidth().height(28.dp).background(Color.Black.copy(alpha = 0.35f)).padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(w.caption, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.labelMedium, color = widgetFg(w, MaterialTheme.colorScheme.onSurface))
                        if (multi && total > 1) {
                            IconButton(onClick = { repository.vcFrame(w.id, "PREV_PG") }, Modifier.size(28.dp)) {
                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Página anterior")
                            }
                            Text(labels.getOrNull(current)?.ifEmpty { null } ?: "${current + 1}/$total",
                                style = MaterialTheme.typography.labelSmall)
                            IconButton(onClick = { repository.vcFrame(w.id, "NEXT_PG") }, Modifier.size(28.dp)) {
                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Próxima página")
                            }
                        }
                    }
                }
            }
        }

        VcWidgetType.Button -> {
            val value = live.value ?: when (w.int("state")) { 2 -> 255; 1 -> 127; else -> 0 }
            val flash = w.int("actionType") == 1
            val accent = widgetBg(w, MaterialTheme.colorScheme.surfaceVariant)
            val currentDisabled by rememberUpdatedState(disabled)
            val palette = w.stringList("palette").map { parseHexColor(it) ?: Color.Gray }
            val selectable = palette.size > 1
            val selected = live.paletteIndex ?: w.int("paletteIndex")
            val density = LocalDensity.current
            val chipPx = with(density) { PALETTE_CHIP.toPx() }
            val gapPx = with(density) { PALETTE_GAP.toPx() }
            val stripPx = chipPx + 2 * gapPx
            val sizePx = remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
            Box(
                baseModifier
                    .onSizeChanged { sizePx.value = it }
                    .background(accent)
                    .border(
                        if (value > 0) 3.dp else 1.dp,
                        when (value) { 255 -> CockpitColors.Running; 127 -> CockpitColors.Paused; else -> MaterialTheme.colorScheme.outline },
                        shape,
                    )
                    .pointerInput(w.id, flash, selectable, stripPx, gapPx, chipPx) {
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            if (currentDisabled) return@awaitEachGesture
                            // a tap on a palette chip only picks the color, it never switches the button
                            if (selectable && down.position.y >= sizePx.value.height - stripPx - gapPx) {
                                val idx = ((down.position.x - gapPx) / (chipPx + gapPx)).toInt()
                                if (idx in palette.indices) repository.vcButtonColor(w.id, idx)
                                do {
                                    val ev = awaitPointerEvent()
                                } while (ev.changes.any { it.pressed })
                                return@awaitEachGesture
                            }
                            repository.vcButton(w.id, true)
                            // flash buttons are held; toggle buttons react to the press only
                            do {
                                val ev = awaitPointerEvent()
                            } while (ev.changes.any { it.pressed })
                            if (flash) repository.vcButton(w.id, false)
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    w.caption, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis,
                    color = widgetFg(w, MaterialTheme.colorScheme.onSurface),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(4.dp),
                )
                if (value == 255) {
                    Box(Modifier.fillMaxSize().background(CockpitColors.Running.copy(alpha = 0.18f)))
                }
                if (palette.isNotEmpty()) {
                    Row(
                        Modifier.align(Alignment.BottomStart).padding(start = PALETTE_GAP, bottom = PALETTE_GAP),
                        horizontalArrangement = Arrangement.spacedBy(PALETTE_GAP),
                    ) {
                        palette.forEachIndexed { i, c ->
                            val on = selectable && i == selected
                            Box(
                                Modifier.size(PALETTE_CHIP).clip(CircleShape).background(c)
                                    .border(if (on) 2.dp else 1.dp, if (on) Color.White else Color(0x80000000), CircleShape),
                            )
                        }
                    }
                }
            }
        }

        VcWidgetType.Slider -> {
            val value = live.value ?: w.int("value")
            Column(
                baseModifier.background(widgetBg(w, surface)).border(1.dp, MaterialTheme.colorScheme.outline, shape).padding(4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(live.displayValue ?: "$value", style = MaterialTheme.typography.labelSmall)
                VcSliderBar(value, enabled = !disabled, modifier = Modifier.weight(1f).fillMaxWidth()) {
                    repository.vcSlider(w.id, it)
                }
                if (w.bool("monitor")) {
                    // follows the real DMX channel; touching the slider overrides it until released
                    val overriding = live.overriding ?: w.bool("isOverriding")
                    TextButton(onClick = { repository.vcSliderFollow(w.id) }, enabled = overriding && !disabled) {
                        Text(if (overriding) "SEGUIR" else "AUTO", style = MaterialTheme.typography.labelSmall)
                    }
                }
                Text(w.caption, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelSmall, color = widgetFg(w, MaterialTheme.colorScheme.onSurface))
            }
        }

        VcWidgetType.CueList -> VcCueListView(w, live, state, repository, baseModifier.background(widgetBg(w, surface)))

        VcWidgetType.Label -> Box(baseModifier.background(widgetBg(w, Color.Transparent)), contentAlignment = Alignment.Center) {
            Text(w.caption, textAlign = TextAlign.Center, color = widgetFg(w, MaterialTheme.colorScheme.onSurface))
        }

        VcWidgetType.Clock -> {
            val type = w.int("clockType") // 0 clock, 1 stopwatch, 2 countdown
            val t = live.clockTime ?: w.long("currentTime")
            val running = live.clockRunning ?: w.bool("running")
            Column(
                baseModifier.background(widgetBg(w, surface)).border(1.dp, MaterialTheme.colorScheme.outline, shape),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    if (type == 0) clockOfDay(t) else formatMs(t).substringBefore('.'),
                    style = MaterialTheme.typography.titleLarge,
                    color = widgetFg(w, MaterialTheme.colorScheme.onSurface),
                )
                if (type != 0) Row {
                    IconButton(onClick = { repository.vcClock(w.id, "CLOCK_PLAY") }) {
                        Icon(if (running) Icons.Filled.Stop else Icons.Filled.PlayArrow, "Play/Pause")
                    }
                    IconButton(onClick = { repository.vcClock(w.id, "CLOCK_RESET") }) { Icon(Icons.Filled.Refresh, "Reset") }
                }
            }
        }

        VcWidgetType.XYPad -> {
            val pos = w.raw["position"] as? kotlinx.serialization.json.JsonObject
            fun jd(k: String) = (pos?.get(k) as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull() ?: 0.0
            val x = live.xyX ?: jd("x")
            val y = live.xyY ?: jd("y")
            Column(baseModifier.background(widgetBg(w, surface)).padding(2.dp)) {
                Text(w.caption, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                XYPad(
                    x = (x / XY_MAX).toFloat(), y = (y / XY_MAX).toFloat(),
                    onChange = { nx, ny -> repository.vcXYPad(w.id, nx * XY_MAX, ny * XY_MAX) },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        VcWidgetType.Speed -> {
            val time = live.speedTime ?: w.long("currentTime")
            val factor = live.speedFactor ?: w.int("currentFactor", SPEED_ONE)
            val mult = SPEED_MULT.getOrNull(factor) ?: 1.0
            val effective = (time * mult).roundToLong()
            Column(
                baseModifier.background(widgetBg(w, surface)).border(1.dp, MaterialTheme.colorScheme.outline, shape),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(w.caption, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                Text(
                    formatMs(effective) + if (effective > 0) "  ·  ${(60000.0 / effective).roundToInt()} BPM" else "",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    "tap ${formatMs(time)}  ×  ${SPEED_LABEL.getOrElse(factor) { "1" }}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row {
                    TextButton(onClick = { repository.vcSpeed(w.id, "SPEED_DOWN") }) { Text("÷2") }
                    TextButton(onClick = { repository.vcSpeed(w.id, "SPEED_APPLY") }) { Text("Aplicar") }
                    TextButton(onClick = { repository.vcSpeed(w.id, "SPEED_UP") }) { Text("×2") }
                }
                TapPad(
                    enabled = !disabled,
                    onPeriod = { repository.vcSpeed(w.id, "SPEED_TIME", it) },
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
                )
            }
        }

        VcWidgetType.Animation -> {
            val level = live.value ?: w.int("faderLevel")
            val algos = w.stringList("algorithms")
            val algo = live.algorithmIndex ?: w.int("algorithmIndex")
            var open by remember { mutableStateOf(false) }
            Column(baseModifier.background(widgetBg(w, surface)).border(1.dp, MaterialTheme.colorScheme.outline, shape).padding(4.dp)) {
                Text(w.caption, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                Row(Modifier.weight(1f)) {
                    VcSliderBar(level, !disabled, Modifier.weight(0.35f)) { repository.vcMatrix(w.id, "MATRIX_SLIDER", it) }
                    Box(Modifier.weight(0.65f)) {
                        TextButton(onClick = { open = true }) { Text(algos.getOrNull(algo) ?: "Algoritmo", maxLines = 2) }
                        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                            algos.forEachIndexed { i, name ->
                                DropdownMenuItem(text = { Text(name) }, onClick = {
                                    repository.vcMatrix(w.id, "MATRIX_COMBO", i); open = false
                                })
                            }
                        }
                    }
                }
            }
        }

        VcWidgetType.AudioTriggers -> {
            val enabled = (live.value ?: if (w.bool("enabled")) 255 else 0) > 0
            Box(
                baseModifier
                    .background(if (enabled) CockpitColors.Running.copy(alpha = 0.3f) else surface)
                    .border(1.dp, MaterialTheme.colorScheme.outline, shape)
                    .clickable(enabled = !disabled) { repository.vcAudioTriggers(w.id, !enabled) },
                contentAlignment = Alignment.Center,
            ) { Text("${w.caption}\n${if (enabled) "ON" else "OFF"}", textAlign = TextAlign.Center) }
        }

        VcWidgetType.Unknown -> Unit
    }
}

private const val XY_MAX = 256.0

private fun clockOfDay(t: Long): String {
    // Clock widgets push the seconds of the day
    val secs = if (t > 86_400) t / 1000 else t
    return "%02d:%02d:%02d".format((secs / 3600) % 24, (secs / 60) % 60, secs % 60)
}

/** Absolute-position slider used by VC widgets (0..255, touch point = value) */
@Composable
private fun VcSliderBar(value: Int, enabled: Boolean, modifier: Modifier, onChange: (Int) -> Unit) {
    var dragging by remember { mutableStateOf(false) }
    var local by remember { mutableStateOf(value) }
    val shown = if (dragging) local else value
    val currentOnChange by rememberUpdatedState(onChange)
    val color = MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.surfaceVariant
    Box(
        modifier
            .padding(horizontal = 4.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(track)
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown()
                    dragging = true
                    fun upd(y: Float) {
                        local = ((1f - y / size.height) * 255).roundToInt().coerceIn(0, 255)
                        currentOnChange(local)
                    }
                    upd(down.position.y)
                    while (true) {
                        val ev = awaitPointerEvent()
                        val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!c.pressed) break
                        upd(c.position.y)
                        c.consume()
                    }
                    dragging = false
                }
            },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val h = size.height * shown / 255f
            drawRoundRect(color.copy(alpha = if (enabled) 0.85f else 0.3f), Offset(0f, size.height - h), Size(size.width, h), CornerRadius(6.dp.toPx()))
        }
    }
}

@Composable
private fun VcCueListView(
    w: VcWidget,
    live: VcWidgetState,
    state: CockpitState,
    repository: CockpitRepository,
    modifier: Modifier,
) {
    val steps = remember(w) { w.cueSteps }
    val status = live.cueStatus ?: w.int("playbackStatus") // 0 stopped, 1 playing, 2 paused
    val current = live.cueIndex ?: w.int("playbackIndex", -1)
    val chaserId = w.int("chaserId", -1)
    val chaserSteps = state.functionsById[chaserId]?.steps.orEmpty()

    Column(modifier.border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp))) {
        Row(
            Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.3f)).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(w.caption.ifEmpty { "Cue list" }, Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.labelMedium)
            IconButton(onClick = { repository.vcCue(w.id, "PREV") }) { Icon(Icons.Filled.SkipPrevious, "Anterior") }
            IconButton(onClick = { repository.vcCue(w.id, "PLAY") }) {
                Icon(Icons.Filled.PlayArrow, "Play", tint = if (status == 1) CockpitColors.Running else MaterialTheme.colorScheme.onSurface)
            }
            IconButton(onClick = { repository.vcCue(w.id, "STOP") }) { Icon(Icons.Filled.Stop, "Stop") }
            IconButton(onClick = { repository.vcCue(w.id, "NEXT") }) { Icon(Icons.Filled.SkipNext, "Próximo") }
        }
        LazyColumn(Modifier.fillMaxSize()) {
            itemsIndexed(steps) { i, s ->
                val active = i == current && status != 0
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(if (active) CockpitColors.Running.copy(alpha = 0.3f) else Color.Transparent)
                        .clickable { repository.vcCueStep(w.id, i) }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("${i + 1}", style = MaterialTheme.typography.labelLarge)
                    Text(
                        s.functionName.ifEmpty { chaserSteps.getOrNull(i)?.functionName ?: "#${s.functionId}" },
                        Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    val note = s.note.ifEmpty { chaserSteps.getOrNull(i)?.note.orEmpty() }
                    if (note.isNotEmpty()) Text(note, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
    }
}

/**
 * Tap tempo pad of a speed dial. Taps are timed on finger down (not on release)
 * and the measured period is sent as SPEED_TIME, which QLC+ applies at once.
 */
@Composable
private fun TapPad(enabled: Boolean, onPeriod: (Long) -> Unit, modifier: Modifier = Modifier) {
    val tempo = remember { TapTempo() }
    val haptics = LocalHapticFeedback.current
    val send by rememberUpdatedState(onPeriod)
    var taps by remember { mutableIntStateOf(0) }
    var tick by remember { mutableIntStateOf(0) }
    var flash by remember { mutableStateOf(false) }
    val bg by animateColorAsState(
        if (flash) CockpitColors.Accent else CockpitColors.Accent.copy(alpha = 0.18f),
        animationSpec = tween(if (flash) 0 else 250),
        label = "tap",
    )
    LaunchedEffect(tick) {
        if (tick == 0) return@LaunchedEffect
        flash = true
        delay(60)
        flash = false
        delay(1500)
        tempo.reset()
        taps = 0
    }
    Box(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .border(1.dp, CockpitColors.Accent, RoundedCornerShape(6.dp))
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown()
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    tempo.tap(down.uptimeMillis)?.let(send)
                    taps = tempo.tapCount
                    tick++
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (taps < 2) "TAP" else "TAP  ($taps)",
            style = MaterialTheme.typography.titleMedium,
            color = if (flash) Color.Black else MaterialTheme.colorScheme.onSurface,
        )
    }
}

/** QLC+ VCSpeedDial::SpeedMultiplier indexes: None, Zero, 1/16 .. 1/2, 1, 2 .. 16. */
private val SPEED_MULT = listOf(1.0, 0.0, 1.0 / 16, 1.0 / 8, 1.0 / 4, 1.0 / 2, 1.0, 2.0, 4.0, 8.0, 16.0)
private val SPEED_LABEL = listOf("1", "0", "1/16", "1/8", "1/4", "1/2", "1", "2", "4", "8", "16")
private const val SPEED_ONE = 6

private val PALETTE_CHIP = 22.dp
private val PALETTE_GAP = 6.dp

