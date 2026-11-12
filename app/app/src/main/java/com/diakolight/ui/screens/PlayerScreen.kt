package com.diakonia.qlccockpit.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Card
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.diakonia.qlccockpit.data.ApiMode
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.model.FunctionKind
import com.diakonia.qlccockpit.model.QlcFunction
import com.diakonia.qlccockpit.ui.components.HorizontalFader
import com.diakonia.qlccockpit.ui.components.LabeledHorizontalFader
import com.diakonia.qlccockpit.ui.components.StatusDot
import com.diakonia.qlccockpit.ui.theme.CockpitColors

fun formatMs(ms: Long): String {
    if (ms < 0 || ms == UInt.MAX_VALUE.toLong()) return "∞"
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec / 60) % 60
    val s = totalSec % 60
    val tenth = (ms % 1000) / 100
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d.%d".format(m, s, tenth)
}

@Composable
fun PlayerScreen(
    state: CockpitState,
    repository: CockpitRepository,
    selectedId: Int?,
    onSelect: (Int) -> Unit,
) {
    val playable = remember(state.functions) {
        state.functions
            .filter { it.kind == FunctionKind.Show || it.kind.isStepBased }
            .sortedWith(compareBy({ it.kind != FunctionKind.Show }, { it.name.lowercase() }))
    }
    val selected = playable.firstOrNull { it.id == selectedId } ?: playable.firstOrNull()

    if (playable.isEmpty()) {
        EmptyHint(if (state.isConnected) "O projeto não tem Shows, Chasers ou Sequences." else "Conecte-se a um servidor QLC+.")
        return
    }

    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(Modifier.width(300.dp).fillMaxHeight()) {
            LazyColumn(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(playable, key = { it.id }) { f ->
                    val running = f.id in state.running
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (f.id == selected?.id) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                            .clickable { onSelect(f.id) }
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        StatusDot(running, color = if (f.id in state.paused) CockpitColors.Paused else CockpitColors.Running)
                        Column(Modifier.weight(1f)) {
                            Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(f.kind.label, style = MaterialTheme.typography.labelSmall, color = kindColor(f.kind))
                        }
                    }
                }
            }
        }

        if (selected != null) {
            Card(Modifier.weight(1f).fillMaxHeight()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (selected.kind == FunctionKind.Show) ShowPanel(selected, state, repository)
                    else ChaserPanel(selected, state, repository)
                }
            }
        }
    }
}

@Composable
private fun TransportButton(icon: ImageVector, label: String, onClick: () -> Unit, primary: Boolean = false, enabled: Boolean = true) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (primary) {
            FilledIconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(72.dp)) {
                Icon(icon, label, Modifier.size(40.dp))
            }
        } else {
            FilledTonalIconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(64.dp)) {
                Icon(icon, label, Modifier.size(32.dp))
            }
        }
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun ColumnScope.ShowPanel(show: QlcFunction, state: CockpitState, repository: CockpitRepository) {
    val running = show.id in state.running
    val paused = show.id in state.paused
    val elapsed = state.showTimes[show.id] ?: 0L
    val total = show.totalDuration.takeIf { it > 0 } ?: show.tracks.flatMap { it.functions }
        .maxOfOrNull { it.startTime + it.duration } ?: 0L
    val cockpit = state.mode == ApiMode.Cockpit
    var seeking by remember { mutableStateOf<Float?>(null) }

    Text(show.name, style = MaterialTheme.typography.titleLarge)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        TransportButton(Icons.Filled.Stop, "Stop", { repository.setFunctionRunning(show.id, false) }, enabled = running)
        TransportButton(
            if (running && !paused) Icons.Filled.Pause else Icons.Filled.PlayArrow,
            if (running && !paused) "Pausar" else "Play",
            {
                when {
                    !running -> repository.setFunctionRunning(show.id, true)
                    cockpit -> repository.pauseFunction(show.id, !paused)
                }
            },
            primary = true,
            enabled = !running || cockpit,
        )
        Spacer(Modifier.width(24.dp))
        Column {
            Text(
                formatMs(seeking?.let { (it * total).toLong() } ?: elapsed),
                fontFamily = FontFamily.Monospace, fontSize = 40.sp,
                color = if (paused) CockpitColors.Paused else MaterialTheme.colorScheme.onSurface,
            )
            Text("de ${formatMs(total)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    if (cockpit && total > 0) {
        HorizontalFader(
            value = seeking ?: (elapsed.toFloat() / total).coerceIn(0f, 1f),
            onValueChange = { seeking = it },
            onRelease = {
                seeking?.let { repository.seekFunction(show.id, (it * total).toLong()) }
                seeking = null
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }

    if (show.tracks.isNotEmpty()) {
        Text("Tracks", style = MaterialTheme.typography.titleMedium)
        ShowTimeline(show, if (running) elapsed else -1L, total, Modifier.fillMaxWidth().weight(1f))
    } else if (!cockpit) {
        Text("Linha do tempo e seek disponíveis com o QLC+ do fork Cockpit.",
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ShowTimeline(show: QlcFunction, elapsed: Long, total: Long, modifier: Modifier) {
    val trackColors = listOf(
        Color(0xFF4FC3F7), Color(0xFFFFB74D), Color(0xFFBA68C8), Color(0xFF81C784), Color(0xFFF06292), Color(0xFFFFD54F),
    )
    LazyColumn(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        itemsIndexed(show.tracks, key = { _, t -> t.id }) { i, track ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(track.name, Modifier.width(140.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelLarge)
                Box(
                    Modifier
                        .weight(1f)
                        .height(36.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    val c = trackColors[i % trackColors.size]
                    Canvas(Modifier.fillMaxSize()) {
                        if (total <= 0) return@Canvas
                        track.functions.forEach { item ->
                            val x = size.width * item.startTime / total
                            val w = (size.width * item.duration / total).coerceAtLeast(3f)
                            drawRoundRect(c.copy(alpha = 0.7f), Offset(x, 4f), Size(w, size.height - 8f), CornerRadius(4f))
                        }
                        if (elapsed >= 0) {
                            val px = size.width * elapsed / total
                            drawLine(Color.White, Offset(px, 0f), Offset(px, size.height), 3f)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.ChaserPanel(chaser: QlcFunction, state: CockpitState, repository: CockpitRepository) {
    val running = chaser.id in state.running
    val current = if (running) state.chaserSteps[chaser.id] ?: -1 else -1
    val cockpit = state.mode == ApiMode.Cockpit
    val listState = rememberLazyListState()

    LaunchedEffect(current) {
        if (current >= 0) listState.animateScrollToItem((current - 2).coerceAtLeast(0))
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(chaser.name, style = MaterialTheme.typography.titleLarge)
            Text(
                "${chaser.kind.label} · ${chaser.steps.size} steps" +
                    if (current >= 0) " · step ${current + 1}" else "",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (cockpit) {
            LabeledHorizontalFader(
                label = "Int.",
                value = state.intensities[chaser.id] ?: 255,
                onValueChange = { repository.setFunctionIntensity(chaser.id, it) },
                color = kindColor(chaser.kind),
                modifier = Modifier.width(320.dp),
            )
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        TransportButton(Icons.Filled.Stop, "Stop", { repository.setFunctionRunning(chaser.id, false) }, enabled = running)
        TransportButton(Icons.Filled.SkipPrevious, "Anterior", { repository.chaserPrev(chaser.id) }, enabled = cockpit && running)
        TransportButton(
            if (running) Icons.Filled.SkipNext else Icons.Filled.PlayArrow,
            if (running) "GO" else "Play",
            { if (running && cockpit) repository.chaserNext(chaser.id) else repository.setFunctionRunning(chaser.id, true) },
            primary = true,
        )
        if (cockpit && running) {
            val paused = chaser.id in state.paused
            TransportButton(if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause, if (paused) "Retomar" else "Pausar",
                { repository.pauseFunction(chaser.id, !paused) })
        }
    }

    if (chaser.steps.isEmpty()) {
        Text(
            if (cockpit) "Este chaser não tem steps." else "Lista de steps disponível com o QLC+ do fork Cockpit (ou use a cue list no Console).",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }

    LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxSize()) {
        items(chaser.steps, key = { it.index }) { step ->
            val isCurrent = step.index == current
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (isCurrent) kindColor(chaser.kind).copy(alpha = 0.3f) else MaterialTheme.colorScheme.surfaceVariant)
                    .border(if (isCurrent) 2.dp else 0.dp, if (isCurrent) kindColor(chaser.kind) else Color.Transparent, RoundedCornerShape(10.dp))
                    .clickable(enabled = cockpit) { repository.chaserGoto(chaser.id, step.index) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("${step.index + 1}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.width(36.dp))
                Column(Modifier.weight(1f)) {
                    Text(step.functionName.ifEmpty { "#${step.functionId}" }, style = MaterialTheme.typography.bodyLarge)
                    if (step.note.isNotEmpty())
                        Text(step.note, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    "in ${formatMs(step.fadeIn)}  hold ${formatMs(step.hold)}  out ${formatMs(step.fadeOut)}",
                    style = MaterialTheme.typography.labelMedium,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

