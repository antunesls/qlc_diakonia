package com.diakonia.qlccockpit.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.data.UniverseValues
import com.diakonia.qlccockpit.model.Fixture
import com.diakonia.qlccockpit.model.FixtureChannel
import com.diakonia.qlccockpit.ui.components.VerticalFader
import com.diakonia.qlccockpit.ui.theme.CockpitColors
import kotlinx.coroutines.launch

@Composable
fun SimpleDeskScreen(state: CockpitState, repository: CockpitRepository) {
    var universe by rememberSaveable { mutableStateOf(0) }
    var percent by rememberSaveable { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    var gotoText by remember { mutableStateOf("") }
    val all by repository.universes.values.collectAsStateWithLifecycle()
    val values = all[universe] ?: UniverseValues.EMPTY
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    DisposableEffect(universe) {
        repository.setActiveUniverses(setOf(universe))
        onDispose { repository.setActiveUniverses(emptySet()) }
    }

    /** address -> (fixture, channel) of the selected universe, to name and colour the faders */
    val patch: Map<Int, Pair<Fixture, FixtureChannel>> = remember(state.fixtures, universe) {
        buildMap {
            state.fixtures.filter { it.universe == universe }.forEach { fx ->
                fx.channels.forEach { ch -> put(fx.address + ch.index, fx to ch) }
            }
        }
    }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                state.universes.forEach { u ->
                    FilterChip(selected = universe == u.id, onClick = { universe = u.id }, label = { Text(u.name) })
                }
            }
            OutlinedTextField(
                value = gotoText,
                onValueChange = { t ->
                    gotoText = t.filter(Char::isDigit).take(3)
                    gotoText.toIntOrNull()?.takeIf { it in 1..512 }?.let { ch ->
                        scope.launch { listState.animateScrollToItem(ch - 1) }
                    }
                },
                label = { Text("Ir p/ canal") },
                singleLine = true,
                modifier = Modifier.width(130.dp),
            )
            FilterChip(selected = percent, onClick = { percent = !percent }, label = { Text("%") })
            OutlinedButton(onClick = { confirmReset = true }) { Text("Resetar universo") }
        }
        Text(
            "Toque duplo em um fader devolve o canal ao controle das funções do QLC+.",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        LazyRow(
            state = listState,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.weight(1f),
        ) {
            items(512, key = { it }) { addr ->
                val p = patch[addr]
                VerticalFader(
                    value = values[addr],
                    onValueChange = { repository.setChannel(universe, addr, it) },
                    label = p?.let { (fx, ch) -> "${fx.name}\n${ch.name}" } ?: "",
                    sublabel = "${addr + 1}",
                    color = p?.let { CockpitColors.forGroup(it.second.groupId, it.second.colour) } ?: MaterialTheme.colorScheme.primary,
                    percent = percent,
                    onDoubleTap = { repository.resetChannel(universe, addr) },
                    modifier = Modifier.fillMaxHeight(),
                )
            }
            item { Spacer(Modifier.width(24.dp)) }
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Resetar universo ${universe + 1}?") },
            text = { Text("Todos os valores definidos manualmente neste universo serão liberados.") },
            confirmButton = { Button(onClick = { repository.resetUniverse(universe); confirmReset = false }) { Text("Resetar") } },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Cancelar") } },
        )
    }
}
