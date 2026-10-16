package com.diakonia.qlccockpit.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * 2D pad returning normalized coordinates (0..1, 0..1). Used for Pan/Tilt and VC XY pads.
 * y = 0 is the top of the pad.
 */
@Composable
fun XYPad(
    x: Float,
    y: Float,
    onChange: (Float, Float) -> Unit,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
) {
    var dragging by remember { mutableStateOf(false) }
    var lx by remember { mutableStateOf(x) }
    var ly by remember { mutableStateOf(y) }
    val sx = if (dragging) lx else x
    val sy = if (dragging) ly else y
    val currentOnChange by rememberUpdatedState(onChange)

    Box(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    dragging = true
                    fun update(p: Offset) {
                        lx = (p.x / size.width).coerceIn(0f, 1f)
                        ly = (p.y / size.height).coerceIn(0f, 1f)
                        currentOnChange(lx, ly)
                    }
                    update(down.position)
                    while (true) {
                        val ev = awaitPointerEvent()
                        val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!c.pressed) break
                        update(c.position)
                        c.consume()
                    }
                    dragging = false
                }
            },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val grid = Color.White.copy(alpha = 0.08f)
            for (i in 1..3) {
                val gx = size.width * i / 4
                val gy = size.height * i / 4
                drawLine(grid, Offset(gx, 0f), Offset(gx, size.height), 1f)
                drawLine(grid, Offset(0f, gy), Offset(size.width, gy), 1f)
            }
            val p = Offset(sx * size.width, sy * size.height)
            drawLine(color.copy(alpha = 0.4f), Offset(p.x, 0f), Offset(p.x, size.height), 2f)
            drawLine(color.copy(alpha = 0.4f), Offset(0f, p.y), Offset(size.width, p.y), 2f)
            drawCircle(color, 14.dp.toPx(), p, style = Stroke(3.dp.toPx()))
            drawCircle(color.copy(alpha = 0.5f), 6.dp.toPx(), p)
        }
    }
}

/** HSV colour picker: hue horizontally, saturation vertically, plus a row of quick swatches. */
@Composable
fun ColorPad(
    color: Color,
    onColor: (Color) -> Unit,
    modifier: Modifier = Modifier,
) {
    val currentOnColor by rememberUpdatedState(onColor)
    val hsv = remember(color) {
        val out = FloatArray(3)
        android.graphics.Color.colorToHSV(
            android.graphics.Color.rgb((color.red * 255).roundToInt(), (color.green * 255).roundToInt(), (color.blue * 255).roundToInt()),
            out,
        )
        out
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(2.2f)
                .clip(RoundedCornerShape(12.dp))
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        fun pick(p: Offset) {
                            val h = (p.x / size.width).coerceIn(0f, 1f) * 360f
                            val s = 1f - (p.y / size.height).coerceIn(0f, 1f)
                            currentOnColor(Color.hsv(h, s, 1f))
                        }
                        pick(down.position)
                        while (true) {
                            val ev = awaitPointerEvent()
                            val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!c.pressed) break
                            pick(c.position)
                            c.consume()
                        }
                    }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val hues = (0..6).map { Color.hsv(it * 60f % 360f, 1f, 1f) }
                drawRect(Brush.horizontalGradient(hues))
                drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.White)))
                val p = Offset(hsv[0] / 360f * size.width, (1f - hsv[1]) * size.height)
                drawCircle(Color.Black, 12.dp.toPx(), p, style = Stroke(3.dp.toPx()))
                drawCircle(Color.White, 9.dp.toPx(), p, style = Stroke(2.dp.toPx()))
            }
        }
        Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(
                Color.Red, Color(0xFFFF8000), Color.Yellow, Color.Green, Color.Cyan,
                Color.Blue, Color(0xFF8000FF), Color.Magenta, Color.White,
            ).forEach { c ->
                Box(
                    Modifier
                        .weight(1f)
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(c)
                        .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)
                        .clickable { currentOnColor(c) },
                )
            }
        }
    }
}
