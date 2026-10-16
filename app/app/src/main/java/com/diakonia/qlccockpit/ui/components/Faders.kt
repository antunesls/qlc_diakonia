package com.diakonia.qlccockpit.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.diakonia.qlccockpit.ui.theme.CockpitColors
import kotlin.math.roundToInt

/**
 * Value display of a fader: DMX 0-255 or percentage.
 */
fun faderLabel(value: Int, percent: Boolean): String =
    if (percent) "${(value * 100f / 255f).roundToInt()}%" else value.toString()

/**
 * Vertical DMX fader (0..[max]).
 *
 * While the finger is on the fader the local value wins over [value], so echoes coming
 * from QLC+ never fight the operator. Each fader tracks its own pointer, so several
 * faders can be moved at the same time.
 */
@Composable
fun VerticalFader(
    value: Int,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    sublabel: String? = null,
    color: Color = MaterialTheme.colorScheme.primary,
    max: Int = 255,
    percent: Boolean = false,
    enabled: Boolean = true,
    highlighted: Boolean = false,
    onDoubleTap: (() -> Unit)? = null,
) {
    var dragging by remember { mutableStateOf(false) }
    var localValue by remember { mutableIntStateOf(value) }
    val shown = if (dragging) localValue else value
    val haptics = LocalHapticFeedback.current
    val currentOnChange by rememberUpdatedState(onValueChange)
    val currentValue by rememberUpdatedState(value)
    val currentDoubleTap by rememberUpdatedState(onDoubleTap)

    Column(
        modifier = modifier.width(64.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            faderLabel(shown, percent),
            style = MaterialTheme.typography.labelMedium,
            color = if (shown > 0) color else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box(
            modifier = Modifier
                .weight(1f)
                .width(52.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(
                    1.dp,
                    if (highlighted) color else MaterialTheme.colorScheme.outline,
                    RoundedCornerShape(10.dp),
                )
                .pointerInput(enabled, max) {
                    if (!enabled) return@pointerInput
                    var lastTap = 0L
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val now = System.currentTimeMillis()
                        if (now - lastTap < 300 && currentDoubleTap != null) {
                            currentDoubleTap?.invoke()
                            lastTap = 0L
                            return@awaitEachGesture
                        }
                        lastTap = now
                        dragging = true
                        // relative drag: touching the fader does not make the value jump
                        val start = currentValue.toFloat()
                        localValue = currentValue
                        val h = size.height.toFloat().coerceAtLeast(1f)
                        var acc = 0f
                        val pointerId = down.id
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == pointerId } ?: break
                            if (!change.pressed) break
                            acc += change.positionChange().y
                            val nv = (start - acc / h * max).roundToInt().coerceIn(0, max)
                            if (nv != localValue) {
                                if ((nv == 0 || nv == max) && localValue != nv)
                                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                localValue = nv
                                currentOnChange(nv)
                            }
                            change.consume()
                        }
                        dragging = false
                    }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val frac = shown.toFloat() / max
                val fillH = size.height * frac
                drawRoundRect(
                    color = color.copy(alpha = if (enabled) 0.85f else 0.3f),
                    topLeft = Offset(0f, size.height - fillH),
                    size = Size(size.width, fillH),
                    cornerRadius = CornerRadius(10.dp.toPx()),
                )
                // handle
                val y = (size.height - fillH).coerceIn(2.dp.toPx(), size.height - 2.dp.toPx())
                drawLine(Color.White.copy(alpha = 0.9f), Offset(6.dp.toPx(), y), Offset(size.width - 6.dp.toPx(), y), 3.dp.toPx())
            }
        }
        if (label != null) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().height(28.dp),
            )
        }
        if (sublabel != null) {
            Text(sublabel, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Horizontal fader used in toolbars (grand master, intensities, seek) */
@Composable
fun HorizontalFader(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    enabled: Boolean = true,
    onRelease: (() -> Unit)? = null,
) {
    var dragging by remember { mutableStateOf(false) }
    var local by remember { mutableStateOf(value) }
    val shown = if (dragging) local else value
    val currentOnChange by rememberUpdatedState(onValueChange)
    val currentOnRelease by rememberUpdatedState(onRelease)

    Box(
        modifier
            .height(36.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    dragging = true
                    val w = size.width.toFloat().coerceAtLeast(1f)
                    local = (down.position.x / w).coerceIn(0f, 1f)
                    currentOnChange(local)
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) break
                        local = (change.position.x / w).coerceIn(0f, 1f)
                        currentOnChange(local)
                        change.consume()
                    }
                    dragging = false
                    currentOnRelease?.invoke()
                }
            },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            drawRoundRect(
                color = color.copy(alpha = if (enabled) 0.8f else 0.3f),
                size = Size(size.width * shown.coerceIn(0f, 1f), size.height),
                cornerRadius = CornerRadius(8.dp.toPx()),
            )
        }
    }
}

/** Fader with label + value, horizontally laid out */
@Composable
fun LabeledHorizontalFader(
    label: String,
    value: Int,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    percent: Boolean = true,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(44.dp))
        HorizontalFader(
            value = value / 255f,
            onValueChange = { onValueChange((it * 255).roundToInt()) },
            color = color,
            modifier = Modifier.weight(1f),
        )
        Text(
            faderLabel(value, percent),
            style = MaterialTheme.typography.labelLarge,
            textAlign = TextAlign.End,
            modifier = Modifier.width(48.dp).padding(start = 6.dp),
        )
    }
}

/** Running / stopped indicator dot */
@Composable
fun StatusDot(on: Boolean, modifier: Modifier = Modifier, color: Color = CockpitColors.Running) {
    Box(
        modifier
            .width(10.dp)
            .height(10.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(if (on) color else MaterialTheme.colorScheme.outline),
    )
}
