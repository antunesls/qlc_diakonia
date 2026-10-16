package com.diakonia.qlccockpit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Highlight
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.diakonia.qlccockpit.data.ApiMode
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.data.SettingsStore
import com.diakonia.qlccockpit.net.ConnectionState
import com.diakonia.qlccockpit.ui.components.HorizontalFader
import com.diakonia.qlccockpit.ui.components.StatusDot
import com.diakonia.qlccockpit.ui.screens.ConnectScreen
import com.diakonia.qlccockpit.ui.screens.FixturesScreen
import com.diakonia.qlccockpit.ui.screens.FunctionsScreen
import com.diakonia.qlccockpit.ui.screens.PlayerScreen
import com.diakonia.qlccockpit.ui.screens.SimpleDeskScreen
import com.diakonia.qlccockpit.ui.screens.VirtualConsoleScreen
import com.diakonia.qlccockpit.ui.theme.CockpitColors
import kotlin.math.roundToInt

enum class Destination(val label: String, val icon: ImageVector) {
    Functions("Funções", Icons.Filled.GridView),
    Player("Player", Icons.Filled.PlayCircle),
    Fixtures("Fixtures", Icons.Filled.Highlight),
    Desk("Mesa DMX", Icons.Filled.Tune),
    Console("Console", Icons.Filled.Dashboard),
    Connection("Conexão", Icons.Filled.Settings),
}

@Composable
fun CockpitApp(
    repository: CockpitRepository,
    settings: SettingsStore,
    stageTheme: Boolean,
    onStageThemeChange: (Boolean) -> Unit,
) {
    val state by repository.state.collectAsStateWithLifecycle()
    CockpitContent(
        state = state,
        repository = repository,
        settings = settings,
        stageTheme = stageTheme,
        onStageThemeChange = onStageThemeChange,
        initialDestination = if (repository.server == null) Destination.Connection else Destination.Functions,
    )
}

@Composable
fun CockpitContent(
    state: CockpitState,
    repository: CockpitRepository,
    settings: SettingsStore,
    stageTheme: Boolean,
    onStageThemeChange: (Boolean) -> Unit,
    initialDestination: Destination,
    initialPlayerFunction: Int? = null,
) {
    var dest by rememberSaveable { mutableStateOf(initialDestination) }
    var playerFunction by rememberSaveable { mutableStateOf(initialPlayerFunction) }

    // jump to the cockpit as soon as a connection is established from the connection screen
    var wasConnected by rememberSaveable { mutableStateOf(state.isConnected) }
    LaunchedEffect(state.isConnected) {
        if (state.isConnected && !wasConnected && dest == Destination.Connection) dest = Destination.Functions
        wasConnected = state.isConnected
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Row(Modifier.fillMaxSize()) {
            NavigationRail(
                containerColor = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxHeight(),
            ) {
                Spacer(Modifier.height(8.dp))
                Destination.entries.forEach { d ->
                    val available = d != Destination.Fixtures || state.mode != ApiMode.Compat
                    NavigationRailItem(
                        selected = dest == d,
                        onClick = { dest = d },
                        enabled = available,
                        icon = { Icon(d.icon, contentDescription = d.label) },
                        label = { Text(d.label) },
                    )
                }
            }

            Column(Modifier.fillMaxSize()) {
                GlobalBar(state, repository)
                Box(Modifier.fillMaxSize().padding(12.dp)) {
                    when (dest) {
                        Destination.Functions -> FunctionsScreen(
                            state, repository,
                            onOpenInPlayer = { playerFunction = it; dest = Destination.Player },
                        )
                        Destination.Player -> PlayerScreen(
                            state, repository,
                            selectedId = playerFunction,
                            onSelect = { playerFunction = it },
                        )
                        Destination.Fixtures -> FixturesScreen(state, repository)
                        Destination.Desk -> SimpleDeskScreen(state, repository)
                        Destination.Console -> VirtualConsoleScreen(state, repository)
                        Destination.Connection -> ConnectScreen(
                            state, repository, settings,
                            stageTheme = stageTheme,
                            onStageThemeChange = onStageThemeChange,
                        )
                    }
                }
            }
        }
    }

    state.lastAlert?.let { text ->
        AlertDialog(
            onDismissRequest = { repository.clearAlert() },
            confirmButton = { TextButton(onClick = { repository.clearAlert() }) { Text("OK") } },
            title = { Text("QLC+") },
            text = { Text(text) },
        )
    }
}

/** Always visible: connection, Grand Master, Blackout and panic stop */
@Composable
private fun GlobalBar(state: CockpitState, repository: CockpitRepository) {
    var confirmStop by rememberSaveable { mutableStateOf(false) }

    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ConnectionBadge(state)

        Spacer(Modifier.weight(1f))

        Text("GM", style = MaterialTheme.typography.labelLarge)
        HorizontalFader(
            value = state.grandMaster / 255f,
            onValueChange = { repository.setGrandMaster((it * 255).roundToInt()) },
            enabled = state.isConnected,
            modifier = Modifier.width(260.dp),
        )
        Text("${(state.grandMaster * 100f / 255f).roundToInt()}%", style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.width(44.dp))

        if (state.mode == ApiMode.Cockpit) {
            Button(
                onClick = { repository.setBlackout(!state.blackout) },
                enabled = state.isConnected,
                colors = if (state.blackout) ButtonDefaults.buttonColors(containerColor = CockpitColors.Danger)
                else ButtonDefaults.filledTonalButtonColors(),
            ) { Text(if (state.blackout) "BLACKOUT ON" else "Blackout") }
        }

        FilledTonalButton(
            onClick = { confirmStop = true },
            enabled = state.isConnected && state.running.isNotEmpty(),
            colors = ButtonDefaults.filledTonalButtonColors(containerColor = CockpitColors.Danger.copy(alpha = 0.25f)),
        ) { Text("Parar tudo") }
    }

    if (confirmStop) {
        AlertDialog(
            onDismissRequest = { confirmStop = false },
            title = { Text("Parar todas as funções?") },
            text = { Text("${state.running.size} função(ões) em execução serão paradas.") },
            confirmButton = {
                Button(
                    onClick = { repository.stopAll(); confirmStop = false },
                    colors = ButtonDefaults.buttonColors(containerColor = CockpitColors.Danger),
                ) { Text("Parar tudo") }
            },
            dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Cancelar") } },
        )
    }
}

@Composable
private fun ConnectionBadge(state: CockpitState) {
    val (text, on, color) = when (val c = state.connection) {
        ConnectionState.Idle -> Triple("Desconectado", false, CockpitColors.Danger)
        is ConnectionState.Connecting -> Triple("Conectando…", true, CockpitColors.Paused)
        ConnectionState.Connected -> Triple(
            buildString {
                append(state.info?.let { "${it.appName} ${it.appVersion}" } ?: "Conectado")
                if (state.mode == ApiMode.Compat) append(" · modo compatível")
                state.latencyMs?.let { append(" · ${it} ms") }
                if (state.loading) append(" · carregando…")
            },
            true, CockpitColors.Running,
        )
        is ConnectionState.Failed -> Triple("Sem conexão: ${c.reason}", true, CockpitColors.Danger)
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusDot(on, color = color)
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}
