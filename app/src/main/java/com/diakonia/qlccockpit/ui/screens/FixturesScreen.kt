package com.diakonia.qlccockpit.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.data.UniverseValues
import com.diakonia.qlccockpit.model.ChannelGroup
import com.diakonia.qlccockpit.model.Fixture
import com.diakonia.qlccockpit.model.FixtureChannel
import com.diakonia.qlccockpit.ui.components.ColorPad
import com.diakonia.qlccockpit.ui.components.VerticalFader
import com.diakonia.qlccockpit.ui.components.XYPad
import com.diakonia.qlccockpit.ui.theme.CockpitColors
import kotlin.math.roundToInt

/** Fixture channels that make a colour mixer */
private data class ColorChannels(val r: Int?, val g: Int?, val b: Int?, val c: Int?, val m: Int?, val y: Int?) {
    val isRgb get() = r != null && g != null && b != null
    val isCmy get() = c != null && m != null && y != null
    val usable get() = isRgb || isCmy
}

private fun Fixture.colorChannels(): ColorChannels {
    fun find(colour: String) = channels.firstOrNull {
        it.groupId == ChannelGroup.INTENSITY && it.colour == colour && it.controlByte == 0
    }?.index
    return ColorChannels(find("Red"), find("Green"), find("Blue"), find("Cyan"), find("Magenta"), find("Yellow"))
}

private fun Fixture.channelOf(group: Int, lsb: Boolean = false): Int? =
    channels.firstOrNull { it.groupId == group && (it.controlByte == 1) == lsb }?.index

/** The channel of [target] that corresponds to [src] of another fixture (for multi-selection) */
private fun matchChannel(target: Fixture, src: FixtureChannel): Int? =
    target.channels.firstOrNull { it.name == src.name }?.index
        ?: target.channels.firstOrNull {
            it.groupId == src.groupId && it.colour == src.colour && it.controlByte == src.controlByte
        }?.index

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FixturesScreen(state: CockpitState, repository: CockpitRepository) {
    var groupFilter by rememberSaveable { mutableStateOf<Int?>(null) }
    var selectedIds by rememberSaveable { mutableStateOf(listOfNotNull(state.fixtures.lastOrNull()?.id)) }
    val universes by repository.universes.values.collectAsStateWithLifecycle()

    val fixturesById = remember(state.fixtures) { state.fixtures.associateBy { it.id } }
    val listed = remember(state.fixtures, state.groups, groupFilter) {
        val grp = state.groups.fixtureGroups.firstOrNull { it.id == groupFilter }
        if (grp == null) state.fixtures
        else grp.heads.map { it.fixtureId }.distinct().mapNotNull { fixturesById[it] }
    }
    val selected = selectedIds.mapNotNull { fixturesById[it] }
    val primary = selected.firstOrNull()

    DisposableEffect(selected.map { it.universe }.toSet()) {
        repository.setActiveUniverses(selected.map { it.universe }.toSet())
        onDispose { repository.setActiveUniverses(emptySet()) }
    }

    if (state.fixtures.isEmpty()) {
        EmptyHint(if (state.isConnected) "Nenhum fixture no projeto." else "Conecte-se a um servidor QLC+.")
        return
    }

    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(Modifier.width(300.dp).fillMaxHeight()) {
            Column(Modifier.padding(8.dp)) {
                if (state.groups.fixtureGroups.isNotEmpty()) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(groupFilter == null, { groupFilter = null }, label = { Text("Todos") })
                        state.groups.fixtureGroups.forEach { g ->
                            FilterChip(groupFilter == g.id, { groupFilter = g.id }, label = { Text(g.name) })
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { selectedIds = listed.map { it.id } }) { Text("Selecionar todos") }
                    TextButton(onClick = { selectedIds = emptyList() }, enabled = selectedIds.isNotEmpty()) { Text("Limpar") }
                }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    items(listed, key = { it.id }) { fx ->
                        val isSel = fx.id in selectedIds
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (fx.id == primary?.id) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent,
                                )
                                .clickable { selectedIds = listOf(fx.id) }
                                .padding(vertical = 4.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = isSel,
                                onCheckedChange = { on -> selectedIds = if (on) selectedIds + fx.id else selectedIds - fx.id },
                            )
                            FixtureSwatch(fx, universes[fx.universe] ?: UniverseValues.EMPTY)
                            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                                Text(fx.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    "U${fx.universe + 1} · ${fx.displayAddress} · ${fx.channelsCount}ch",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }

        Card(Modifier.weight(1f).fillMaxHeight()) {
            if (primary == null) {
                EmptyHint("Selecione um ou mais fixtures.")
            } else {
                FixtureControl(primary, selected, universes, repository)
            }
        }
    }
}

/** Small dot showing the current colour/intensity output of the fixture */
@Composable
private fun FixtureSwatch(fx: Fixture, values: UniverseValues) {
    val cc = remember(fx) { fx.colorChannels() }
    val dimmer = fx.channelOf(ChannelGroup.INTENSITY)?.takeIf { idx ->
        fx.channels[idx].colour.isEmpty() || fx.channels[idx].colour == "Generic"
    }
    fun v(ch: Int?) = ch?.let { values[fx.address + it] } ?: 0
    val level = dimmer?.let { v(it) / 255f } ?: 1f
    val color = when {
        cc.isRgb -> Color(v(cc.r) / 255f * level, v(cc.g) / 255f * level, v(cc.b) / 255f * level)
        cc.isCmy -> Color((255 - v(cc.c)) / 255f * level, (255 - v(cc.m)) / 255f * level, (255 - v(cc.y)) / 255f * level)
        dimmer != null -> Color(level, level * 0.85f, level * 0.6f)
        else -> Color.DarkGray
    }
    Box(
        Modifier
            .size(18.dp)
            .clip(CircleShape)
            .background(color)
            .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FixtureControl(
    primary: Fixture,
    selected: List<Fixture>,
    universes: Map<Int, UniverseValues>,
    repository: CockpitRepository,
) {
    val values = universes[primary.universe] ?: UniverseValues.EMPTY
    var focusChannel by remember(primary.id) { mutableStateOf<Int?>(null) }
    val cc = remember(primary) { primary.colorChannels() }
    val pan = remember(primary) { primary.channelOf(ChannelGroup.PAN) }
    val panFine = remember(primary) { primary.channelOf(ChannelGroup.PAN, lsb = true) }
    val tilt = remember(primary) { primary.channelOf(ChannelGroup.TILT) }
    val tiltFine = remember(primary) { primary.channelOf(ChannelGroup.TILT, lsb = true) }

    /** apply values (by channel of the primary fixture) to every selected fixture */
    fun apply(srcValues: Map<Int, Int>, key: String) {
        for (fx in selected) {
            val mapped = if (fx.id == primary.id) srcValues else srcValues.mapNotNull { (ch, v) ->
                matchChannel(fx, primary.channels[ch])?.let { it to v }
            }.toMap()
            when {
                mapped.isEmpty() -> Unit
                mapped.size == 1 -> repository.setFixtureChannel(fx, mapped.keys.first(), mapped.values.first())
                else -> repository.setFixtureChannels(fx, mapped, key)
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (selected.size > 1) "${primary.name} + ${selected.size - 1}" else primary.name,
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    listOf(primary.manufacturer, primary.model, primary.mode).filter { it.isNotEmpty() }.joinToString(" · ") +
                        " · U${primary.universe + 1} @ ${primary.displayAddress}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            OutlinedButton(onClick = {
                // Locate: full intensity, white, beam centered
                val m = HashMap<Int, Int>()
                primary.channels.forEach { ch ->
                    when (ch.groupId) {
                        ChannelGroup.INTENSITY -> m[ch.index] = if (ch.colour in listOf("Cyan", "Magenta", "Yellow")) 0 else 255
                        ChannelGroup.PAN, ChannelGroup.TILT -> m[ch.index] = if (ch.controlByte == 0) 128 else 0
                        ChannelGroup.SHUTTER -> ch.capabilities.firstOrNull {
                            it.name.contains("open", true) || it.name.contains("on", true)
                        }?.let { cap -> m[ch.index] = (cap.min + cap.max) / 2 }
                    }
                }
                apply(m, "locate")
            }) { Text("Localizar") }
            OutlinedButton(onClick = { selected.forEach { repository.releaseFixture(it) } }) { Text("Liberar") }
        }

        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            // colour / position pads
            if (cc.usable || (pan != null && tilt != null)) {
                Column(
                    Modifier.width(300.dp).fillMaxHeight().verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    if (cc.usable) {
                        Text("Cor", style = MaterialTheme.typography.titleMedium)
                        val current = if (cc.isRgb)
                            Color(values[primary.address + cc.r!!] / 255f, values[primary.address + cc.g!!] / 255f, values[primary.address + cc.b!!] / 255f)
                        else
                            Color(1f - values[primary.address + cc.c!!] / 255f, 1f - values[primary.address + cc.m!!] / 255f, 1f - values[primary.address + cc.y!!] / 255f)
                        ColorPad(current, onColor = { c ->
                            val r = (c.red * 255).roundToInt()
                            val g = (c.green * 255).roundToInt()
                            val b = (c.blue * 255).roundToInt()
                            val m = if (cc.isRgb) mapOf(cc.r!! to r, cc.g!! to g, cc.b!! to b)
                            else mapOf(cc.c!! to 255 - r, cc.m!! to 255 - g, cc.y!! to 255 - b)
                            apply(m, "color")
                        })
                    }
                    if (pan != null && tilt != null) {
                        Text("Pan / Tilt", style = MaterialTheme.typography.titleMedium)
                        fun pos(c: Int, fine: Int?) =
                            (values[primary.address + c] * 256 + (fine?.let { values[primary.address + it] } ?: 0)) / 65535f
                        XYPad(
                            x = pos(pan, panFine),
                            y = pos(tilt, tiltFine),
                            onChange = { x, y ->
                                val px = (x * 65535).roundToInt()
                                val py = (y * 65535).roundToInt()
                                val m = HashMap<Int, Int>()
                                m[pan] = px shr 8
                                m[tilt] = py shr 8
                                panFine?.let { m[it] = px and 0xFF }
                                tiltFine?.let { m[it] = py and 0xFF }
                                apply(m, "pt")
                            },
                            modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                        )
                    }
                }
            }

            // channel faders
            Column(Modifier.weight(1f).fillMaxHeight()) {
                Row(
                    Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    primary.channels.forEach { ch ->
                        VerticalFader(
                            value = values[primary.address + ch.index],
                            onValueChange = { v -> focusChannel = ch.index; apply(mapOf(ch.index to v), "ch${ch.index}") },
                            label = ch.name,
                            sublabel = "${primary.displayAddress + ch.index}",
                            color = CockpitColors.forGroup(ch.groupId, ch.colour),
                            highlighted = focusChannel == ch.index,
                            onDoubleTap = { focusChannel = ch.index },
                            modifier = Modifier.fillMaxHeight(),
                        )
                    }
                }
                val focus = focusChannel?.let { primary.channels.getOrNull(it) }
                    ?: primary.channels.firstOrNull { it.capabilities.size > 1 }
                if (focus != null && focus.capabilities.size > 1) {
                    Spacer(Modifier.height(8.dp))
                    Text("${focus.name}: funções do canal", style = MaterialTheme.typography.titleMedium)
                    FlowRow(
                        Modifier.fillMaxWidth().height(110.dp).verticalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        val current = values[primary.address + focus.index]
                        focus.capabilities.forEach { cap ->
                            val active = current in cap.min..cap.max
                            AssistChip(
                                onClick = { apply(mapOf(focus.index to (cap.min + cap.max) / 2), "cap${focus.index}") },
                                label = { Text(cap.name.ifEmpty { "${cap.min}-${cap.max}" }, maxLines = 1) },
                                leadingIcon = cap.color1?.let { hex ->
                                    {
                                        Box(
                                            Modifier.size(14.dp).clip(CircleShape)
                                                .background(parseHexColor(hex) ?: Color.Gray),
                                        )
                                    }
                                },
                                border = if (active) androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
                            )
                        }
                    }
                }
            }
        }
    }
}

fun parseHexColor(hex: String): Color? = runCatching {
    Color(android.graphics.Color.parseColor(hex))
}.getOrNull()
