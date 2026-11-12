package com.diakolight.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.diakolight.data.CockpitRepository
import com.diakolight.data.CockpitState
import com.diakolight.data.UniverseValues
import com.diakolight.model.Fixture
import com.diakolight.model.FixtureLight
import com.diakolight.model.OrbitCamera
import com.diakolight.model.P3
import com.diakolight.model.Projector
import com.diakolight.model.fixtureLight
import com.diakolight.model.framingCamera
import com.diakolight.model.layoutBounds
import com.diakolight.model.stageLayout
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.tan

/** Direction the beams point: down and a little toward the stage (away from the audience). */
private val BEAM_DIR = P3(0f, -1f, -0.35f).let { it * (1f / it.norm()) }
private const val BEAM_HALF_ANGLE = 0.42f // radians

private class Hit(val id: Int, val at: Offset, val radius: Float)

/**
 * 3D view of the rig: every fixture glows in the colour it is emitting right now.
 * Tapping a fixture opens its channels (same panel as the Fixtures screen).
 */
@Composable
fun Stage3DScreen(state: CockpitState, repository: CockpitRepository, initialSelection: List<Int> = emptyList()) {
    val fixtures = state.fixtures
    if (fixtures.isEmpty()) {
        EmptyHint(if (state.isConnected) "Nenhum fixture no projeto." else "Conecte-se a um servidor QLC+.")
        return
    }

    val universes by repository.universes.values.collectAsStateWithLifecycle()
    val layout = remember(fixtures) { stageLayout(fixtures) }
    val fixturesById = remember(fixtures) { fixtures.associateBy { it.id } }
    var selectedIds by rememberSaveable { mutableStateOf(initialSelection) }
    var camera by remember(layout) { mutableStateOf(framingCamera(layout.values)) }

    // stream every universe that has a fixture: the whole rig is on screen
    DisposableEffect(fixtures) {
        repository.setActiveUniverses(fixtures.map { it.universe }.toSet())
        onDispose { repository.setActiveUniverses(emptySet()) }
    }

    val selected = selectedIds.mapNotNull { fixturesById[it] }
    val primary = selected.firstOrNull()

    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.weight(1f).fillMaxHeight()) {
            StageCanvas(
                fixtures = fixtures,
                layout = layout,
                universes = universes,
                camera = camera,
                selectedIds = selectedIds.toSet(),
                onCamera = { camera = it.limited() },
                onPick = { id -> selectedIds = if (id == null) emptyList() else listOf(id) },
                modifier = Modifier.fillMaxSize(),
            )
            Row(
                Modifier.align(Alignment.TopStart).padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilterChip(false, { camera = framingCamera(layout.values) }, label = { Text("Plateia") })
                FilterChip(false, { camera = framingCamera(layout.values, yaw = 0f, pitch = 1.45f) }, label = { Text("Topo") })
                FilterChip(false, { camera = framingCamera(layout.values, yaw = 1.2f, pitch = 0.25f) }, label = { Text("Lateral") })
                TextButton(onClick = { selectedIds = fixtures.map { it.id } }) { Text("Todos") }
                if (selectedIds.isNotEmpty()) TextButton(onClick = { selectedIds = emptyList() }) { Text("Limpar") }
            }
            Text(
                "Toque num fixture para ajustar · arraste para girar · pinça para zoom",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
            )
        }

        if (primary != null) {
            Card(Modifier.width(640.dp).fillMaxHeight()) {
                Column(Modifier.fillMaxSize()) {
                    Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (selected.size > 1) "${selected.size} fixtures selecionados" else "Canais do fixture",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { selectedIds = emptyList() }) { Text("Fechar") }
                    }
                    Box(Modifier.weight(1f)) {
                        FixtureControl(primary, selected, universes, repository)
                    }
                }
            }
        }
    }
}

@Composable
private fun StageCanvas(
    fixtures: List<Fixture>,
    layout: Map<Int, P3>,
    universes: Map<Int, UniverseValues>,
    camera: OrbitCamera,
    selectedIds: Set<Int>,
    onCamera: (OrbitCamera) -> Unit,
    onPick: (Int?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val measurer = rememberTextMeasurer()
    val hits = remember { ArrayList<Hit>() }
    val cameraNow by androidx.compose.runtime.rememberUpdatedState(camera)
    val onCameraNow by androidx.compose.runtime.rememberUpdatedState(onCamera)
    val onPickNow by androidx.compose.runtime.rememberUpdatedState(onPick)
    val bg = MaterialTheme.colorScheme.background
    val label = MaterialTheme.colorScheme.onSurfaceVariant

    Canvas(
        modifier
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    val c = cameraNow
                    onCameraNow(c.copy(yaw = c.yaw - pan.x * 0.008f, pitch = c.pitch + pan.y * 0.006f, distance = c.distance / zoom))
                }
            }
            .pointerInput(Unit) {
                detectTapGestures { at ->
                    val best = hits.filter { (it.at - at).getDistance() <= max(it.radius, 36.dp.toPx()) }
                        .minByOrNull { (it.at - at).getDistance() }
                    onPickNow(best?.id)
                }
            },
    ) {
        drawRect(bg)
        drawStage(fixtures, layout, universes, camera, selectedIds, measurer, label, hits)
    }
}

private fun DrawScope.drawStage(
    fixtures: List<Fixture>,
    layout: Map<Int, P3>,
    universes: Map<Int, UniverseValues>,
    camera: OrbitCamera,
    selectedIds: Set<Int>,
    measurer: TextMeasurer,
    labelColor: Color,
    hits: MutableList<Hit>,
) {
    val pr = Projector(camera, size.width, size.height)
    val (lo, hi) = layoutBounds(layout.values)

    // floor grid, 1 m
    val gx0 = (lo.x - 3).toInt(); val gx1 = (hi.x + 3).toInt() + 1
    val gz0 = (lo.z - 5).toInt(); val gz1 = (hi.z + 4).toInt() + 1
    val gridColor = Color.White.copy(alpha = 0.07f)
    for (x in gx0..gx1) line(pr, P3(x.toFloat(), 0f, gz0.toFloat()), P3(x.toFloat(), 0f, gz1.toFloat()), gridColor)
    for (z in gz0..gz1) line(pr, P3(gx0.toFloat(), 0f, z.toFloat()), P3(gx1.toFloat(), 0f, z.toFloat()), gridColor)

    val lights = fixtures.associate { fx ->
        val vals = universes[fx.universe] ?: UniverseValues.EMPTY
        fx.id to fixtureLight(fx) { ch -> vals[fx.address + ch] }
    }

    // far to near, so near beams and bodies end up on top
    val ordered = fixtures.mapNotNull { fx -> layout[fx.id]?.let { fx to it } }
        .sortedByDescending { (_, p) -> pr.project(p)?.depth ?: 0f }

    hits.clear()
    for ((fx, pos) in ordered) {
        val light = lights.getValue(fx.id)
        // stand line to the floor
        line(pr, pos, P3(pos.x, 0f, pos.z), Color.White.copy(alpha = 0.12f))
        if (!light.isDark) drawBeam(pr, pos, light)
    }
    for ((fx, pos) in ordered) {
        val p = pr.project(pos) ?: continue
        val light = lights.getValue(fx.id)
        val radius = pr.scale(0.2f, p.depth)
        val selected = fx.id in selectedIds
        val glow = Color(light.r, light.g, light.b)
        val lit = glow.copy(alpha = 1f)

        // body
        drawCircle(Color(0xFF1B1E26), radius * 1.18f, Offset(p.x, p.y))
        drawCircle(
            Brush.radialGradient(
                listOf(blend(lit, light.intensity), blend(lit, light.intensity * 0.45f)),
                center = Offset(p.x, p.y), radius = radius,
            ),
            radius, Offset(p.x, p.y),
        )
        drawCircle(
            if (selected) Color.White else Color.White.copy(alpha = 0.25f),
            radius * 1.18f, Offset(p.x, p.y), style = Stroke(if (selected) 4f else 1.5f),
        )
        val text = measurer.measure(fx.name, TextStyle(fontSize = 12.sp, color = if (selected) Color.White else labelColor))
        drawText(text, topLeft = Offset(p.x - text.size.width / 2f, p.y + radius * 1.3f))
        hits += Hit(fx.id, Offset(p.x, p.y), radius * 1.3f)
    }
}

/** A color fading to the dark body color as [k] goes to 0 */
private fun blend(c: Color, k: Float): Color {
    val a = k.coerceIn(0f, 1f)
    return Color(0.1f + (c.red - 0.1f) * a, 0.11f + (c.green - 0.11f) * a, 0.14f + (c.blue - 0.14f) * a)
}

private fun DrawScope.line(pr: Projector, a: P3, b: P3, color: Color) {
    val pa = pr.project(a) ?: return
    val pb = pr.project(b) ?: return
    drawLine(color, Offset(pa.x, pa.y), Offset(pb.x, pb.y), strokeWidth = 1.2f)
}

/** Light cone from [pos] down to its spot on the floor, plus the glow of the spot */
private fun DrawScope.drawBeam(pr: Projector, pos: P3, light: FixtureLight) {
    val apex = pr.project(pos) ?: return
    val t = if (BEAM_DIR.y < -0.01f) pos.y / -BEAM_DIR.y else return
    val center = pos + BEAM_DIR * t
    val r = t * tan(BEAM_HALF_ANGLE)
    val color = Color(light.r / max(max(light.r, light.g), max(light.b, 0.001f)),
        light.g / max(max(light.r, light.g), max(light.b, 0.001f)),
        light.b / max(max(light.r, light.g), max(light.b, 0.001f)))
    val strength = light.intensity.coerceIn(0f, 1f)

    // spot on the floor: projected circle
    val ring = (0 until 28).mapNotNull { i ->
        val a = (i / 28f) * 2f * PI.toFloat()
        pr.project(P3(center.x + r * cos(a), 0f, center.z + r * sin(a)))
    }
    if (ring.size < 6) return
    val spot = Path().apply {
        moveTo(ring[0].x, ring[0].y)
        ring.drop(1).forEach { lineTo(it.x, it.y) }
        close()
    }
    val c = pr.project(center) ?: return
    val spotRadius = max(ring.maxOf { it.x } - ring.minOf { it.x }, 1f) / 2f
    drawPath(spot, Brush.radialGradient(
        listOf(color.copy(alpha = 0.55f * strength), color.copy(alpha = 0.10f * strength)),
        center = Offset(c.x, c.y), radius = spotRadius,
    ))

    // cone: apex to the left-most and right-most points of the spot
    val left = ring.minByOrNull { it.x }!!
    val right = ring.maxByOrNull { it.x }!!
    val cone = Path().apply {
        moveTo(apex.x, apex.y)
        lineTo(left.x, left.y)
        lineTo(right.x, right.y)
        close()
    }
    drawPath(cone, Brush.linearGradient(
        listOf(color.copy(alpha = 0.34f * strength), color.copy(alpha = 0.08f * strength)),
        start = Offset(apex.x, apex.y), end = Offset(c.x, c.y),
    ))
}
