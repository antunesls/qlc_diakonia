package com.diakonia.qlccockpit.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.diakonia.qlccockpit.data.ApiMode
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.model.FunctionKind
import com.diakonia.qlccockpit.model.QlcFunction
import com.diakonia.qlccockpit.ui.components.LabeledHorizontalFader
import com.diakonia.qlccockpit.ui.components.StatusDot
import com.diakonia.qlccockpit.ui.theme.CockpitColors

fun kindColor(kind: FunctionKind): Color = when (kind) {
    FunctionKind.Scene -> Color(0xFF4FC3F7)
    FunctionKind.Chaser -> Color(0xFFFFB74D)
    FunctionKind.Sequence -> Color(0xFFFFD54F)
    FunctionKind.EFX -> Color(0xFFBA68C8)
    FunctionKind.Collection -> Color(0xFF81C784)
    FunctionKind.Script -> Color(0xFF90A4AE)
    FunctionKind.RGBMatrix -> Color(0xFFF06292)
    FunctionKind.Show -> Color(0xFFFF8A65)
    FunctionKind.Audio -> Color(0xFF4DB6AC)
    FunctionKind.Video -> Color(0xFF7986CB)
    FunctionKind.Unknown -> Color(0xFF9E9E9E)
}

@Composable
fun FunctionsScreen(
    state: CockpitState,
    repository: CockpitRepository,
    onOpenInPlayer: (Int) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var kindFilter by rememberSaveable { mutableStateOf<FunctionKind?>(null) }
    var folder by rememberSaveable { mutableStateOf<String?>(null) }
    var onlyRunning by rememberSaveable { mutableStateOf(false) }
    var detail by remember { mutableStateOf<QlcFunction?>(null) }

    val kinds = remember(state.functions) { state.functions.map { it.kind }.distinct().sortedBy { it.ordinal } }
    val folders = remember(state.functions) { state.functions.map { it.path }.filter { it.isNotEmpty() }.distinct().sorted() }
    val shown = remember(state.functions, query, kindFilter, folder, onlyRunning, state.running) {
        state.functions
            .filter { kindFilter == null || it.kind == kindFilter }
            .filter { folder == null || it.path == folder }
            .filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }
            .filter { !onlyRunning || it.id in state.running }
            .sortedWith(compareBy({ it.kind.ordinal }, { it.name.lowercase() }))
    }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                placeholder = { Text("Buscar função") },
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                modifier = Modifier.width(280.dp),
            )
            if (folders.isNotEmpty()) FolderMenu(folders, folder) { folder = it }
            Row(
                Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                FilterChip(selected = onlyRunning, onClick = { onlyRunning = !onlyRunning },
                    label = { Text("Ativas (${state.running.size})") })
                FilterChip(selected = kindFilter == null, onClick = { kindFilter = null }, label = { Text("Todas") })
                kinds.forEach { k ->
                    FilterChip(
                        selected = kindFilter == k,
                        onClick = { kindFilter = if (kindFilter == k) null else k },
                        label = { Text(k.label) },
                    )
                }
            }
        }

        if (state.functions.isEmpty()) {
            EmptyHint(if (state.isConnected) "Nenhuma função no projeto." else "Conecte-se a um servidor QLC+.")
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(170.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(shown, key = { it.id }) { f ->
                    FunctionCard(
                        f = f,
                        running = f.id in state.running,
                        paused = f.id in state.paused,
                        step = state.chaserSteps[f.id],
                        onTap = { repository.toggleFunction(f.id) },
                        onLongPress = { detail = f },
                    )
                }
            }
        }
    }

    detail?.let { f ->
        FunctionDialog(
            f = f,
            state = state,
            repository = repository,
            onDismiss = { detail = null },
            onOpenInPlayer = { detail = null; onOpenInPlayer(f.id) },
        )
    }
}

@Composable
private fun FolderMenu(folders: List<String>, selected: String?, onSelect: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text(selected ?: "Todas as pastas", maxLines = 1) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Todas as pastas") }, onClick = { onSelect(null); open = false })
            folders.forEach { p ->
                DropdownMenuItem(text = { Text(p) }, onClick = { onSelect(p); open = false })
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FunctionCard(
    f: QlcFunction,
    running: Boolean,
    paused: Boolean,
    step: Int?,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val accent = kindColor(f.kind)
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .height(104.dp)
            .clip(shape)
            .background(if (running) accent.copy(alpha = 0.28f) else MaterialTheme.colorScheme.surface)
            .border(if (running) 2.dp else 1.dp, if (running) accent else MaterialTheme.colorScheme.outline, shape)
            .combinedClickable(
                onClick = { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); onTap() },
                onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); onLongPress() },
            )
            .padding(12.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusDot(running, color = if (paused) CockpitColors.Paused else CockpitColors.Running)
            Text(f.kind.label.uppercase(), style = MaterialTheme.typography.labelSmall, color = accent)
            Spacer(Modifier.weight(1f))
            if (step != null && running && f.steps.isNotEmpty())
                Text("${step + 1}/${f.steps.size}", style = MaterialTheme.typography.labelSmall)
        }
        Text(f.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (f.path.isNotEmpty())
            Text(f.path, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun FunctionDialog(
    f: QlcFunction,
    state: CockpitState,
    repository: CockpitRepository,
    onDismiss: () -> Unit,
    onOpenInPlayer: () -> Unit,
) {
    val running = f.id in state.running
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(f.name) },
        text = {
            Column(Modifier.fillMaxWidth().width(420.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${f.kind.label} · ID ${f.id}" + (if (f.path.isNotEmpty()) " · ${f.path}" else ""),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (state.mode == ApiMode.Cockpit) {
                    LabeledHorizontalFader(
                        label = "Int.",
                        value = state.intensities[f.id] ?: 255,
                        onValueChange = { repository.setFunctionIntensity(f.id, it) },
                        color = kindColor(f.kind),
                    )
                    if (running) {
                        val paused = f.id in state.paused
                        OutlinedButton(onClick = { repository.pauseFunction(f.id, !paused) }) {
                            Text(if (paused) "Retomar" else "Pausar")
                        }
                    }
                }
                if (f.kind == FunctionKind.Collection && f.functions.isNotEmpty()) {
                    Text("Contém: " + f.functions.joinToString { state.functionsById[it]?.name ?: "#$it" },
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = {
            Button(onClick = { repository.setFunctionRunning(f.id, !running) }) {
                Text(if (running) "Parar" else "Executar")
            }
        },
        dismissButton = {
            Row {
                if (f.kind.isStepBased || f.kind == FunctionKind.Show)
                    TextButton(onClick = onOpenInPlayer) { Text("Abrir no Player") }
                TextButton(onClick = onDismiss) { Text("Fechar") }
            }
        },
    )
}

@Composable
fun EmptyHint(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleMedium)
    }
}
