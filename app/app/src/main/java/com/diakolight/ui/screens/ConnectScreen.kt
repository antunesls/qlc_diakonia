package com.diakonia.qlccockpit.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.diakonia.qlccockpit.data.ApiMode
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.data.SettingsStore
import com.diakonia.qlccockpit.net.ServerConfig
import com.diakonia.qlccockpit.net.ServerScanner
import kotlinx.coroutines.launch

@Composable
fun ConnectScreen(
    state: CockpitState,
    repository: CockpitRepository,
    settings: SettingsStore,
    stageTheme: Boolean,
    onStageThemeChange: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val last = remember { settings.recentServers().firstOrNull() }
    var host by rememberSaveable { mutableStateOf(repository.server?.host ?: last?.host ?: "") }
    var port by rememberSaveable { mutableStateOf((repository.server?.port ?: last?.port ?: 9999).toString()) }
    var user by rememberSaveable { mutableStateOf(last?.user ?: "") }
    var password by rememberSaveable { mutableStateOf(last?.password ?: "") }
    var recents by remember { mutableStateOf(settings.recentServers()) }
    var autoConnect by remember { mutableStateOf(settings.autoConnect) }
    val found = remember { mutableStateListOf<String>() }
    var scanning by remember { mutableStateOf(false) }

    fun connect(cfg: ServerConfig) {
        settings.remember(cfg)
        recents = settings.recentServers()
        repository.connect(cfg)
    }

    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Card(Modifier.weight(1f).fillMaxSize()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Servidor QLC+", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Inicie o QLC+ 5 com a Web Access habilitada (qlcplus-qml -w) no computador da mesa. " +
                        "Use o build do fork Cockpit para ter fixtures, steps e DMX ao vivo.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = host, onValueChange = { host = it.trim() },
                        label = { Text("Endereço IP / host") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = port, onValueChange = { port = it.filter(Char::isDigit).take(5) },
                        label = { Text("Porta") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.width(120.dp),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = user, onValueChange = { user = it }, singleLine = true,
                        label = { Text("Usuário (se usar -wa)") }, modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = password, onValueChange = { password = it }, singleLine = true,
                        label = { Text("Senha") }, visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        enabled = host.isNotBlank(),
                        onClick = { connect(ServerConfig(host, port.toIntOrNull() ?: 9999, user, password)) },
                    ) { Text("Conectar") }
                    OutlinedButton(onClick = { repository.disconnect() }, enabled = repository.server != null) {
                        Text("Desconectar")
                    }
                    if (state.isConnected) {
                        OutlinedButton(onClick = { repository.reload() }) { Text("Recarregar projeto") }
                    }
                }
                state.error?.let { Text("Erro: $it", color = MaterialTheme.colorScheme.error) }
                if (state.isConnected) {
                    Text(
                        when (state.mode) {
                            ApiMode.Cockpit -> "API Cockpit detectada: todos os recursos disponíveis."
                            ApiMode.Compat -> "QLC+ oficial detectado: modo compatível (sem lista de fixtures e steps; DMX por polling)."
                            ApiMode.Unknown -> "Detectando recursos…"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        "${state.functions.size} funções · ${state.fixtures.size} fixtures · " +
                            "${state.vc?.allWidgets?.size ?: 0} widgets no Virtual Console",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                HorizontalDivider()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Conectar automaticamente ao abrir", Modifier.weight(1f))
                    Switch(checked = autoConnect, onCheckedChange = { autoConnect = it; settings.autoConnect = it })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Tema de palco")
                        Text("Vermelho e escuro, preserva a visão no escuro",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = stageTheme, onCheckedChange = onStageThemeChange)
                }
            }
        }

        Card(Modifier.weight(1f).fillMaxSize()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Na rede", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    if (scanning) CircularProgressIndicator(Modifier.padding(end = 12.dp).width(20.dp), strokeWidth = 2.dp)
                    OutlinedButton(
                        enabled = !scanning,
                        onClick = {
                            found.clear()
                            scanning = true
                            scope.launch {
                                ServerScanner.scan(context, port.toIntOrNull() ?: 9999) { h -> if (h !in found) found += h }
                                scanning = false
                            }
                        },
                    ) { Text("Procurar QLC+") }
                }
                if (!scanning && found.isEmpty()) {
                    Text("Toque em Procurar para varrer a rede Wi-Fi (porta ${port.ifEmpty { "9999" }}).",
                        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
                LazyColumn(Modifier.weight(1f, fill = false)) {
                    items(found) { h ->
                        ListItem(
                            headlineContent = { Text(h) },
                            supportingContent = { Text("porta ${port.ifEmpty { "9999" }}") },
                            trailingContent = {
                                Button(onClick = {
                                    host = h
                                    connect(ServerConfig(h, port.toIntOrNull() ?: 9999, user, password))
                                }) { Text("Conectar") }
                            },
                        )
                    }
                }
                Spacer(Modifier.padding(4.dp))
                Text("Recentes", style = MaterialTheme.typography.titleMedium)
                LazyColumn(Modifier.weight(1f)) {
                    items(recents, key = { "${it.host}:${it.port}" }) { s ->
                        ListItem(
                            headlineContent = { Text("${s.host}:${s.port}") },
                            supportingContent = { if (s.user.isNotEmpty()) Text("usuário ${s.user}") },
                            trailingContent = {
                                Row {
                                    Button(onClick = {
                                        host = s.host; port = s.port.toString(); user = s.user; password = s.password
                                        connect(s)
                                    }) { Text("Conectar") }
                                    IconButton(onClick = { settings.forget(s); recents = settings.recentServers() }) {
                                        Icon(Icons.Filled.Delete, contentDescription = "Esquecer")
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}
