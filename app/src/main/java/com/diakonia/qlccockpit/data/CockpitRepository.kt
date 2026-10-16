package com.diakonia.qlccockpit.data

import com.diakonia.qlccockpit.model.ApiInfo
import com.diakonia.qlccockpit.model.Fixture
import com.diakonia.qlccockpit.model.FixturesResponse
import com.diakonia.qlccockpit.model.FunctionsResponse
import com.diakonia.qlccockpit.model.GroupsResponse
import com.diakonia.qlccockpit.model.QlcFunction
import com.diakonia.qlccockpit.model.UniverseInfo
import com.diakonia.qlccockpit.model.VcRoot
import com.diakonia.qlccockpit.model.VcWidgetState
import com.diakonia.qlccockpit.net.ConnectionState
import com.diakonia.qlccockpit.net.QlcCommands
import com.diakonia.qlccockpit.net.QlcConnection
import com.diakonia.qlccockpit.net.QlcEvent
import com.diakonia.qlccockpit.net.QlcHttpApi
import com.diakonia.qlccockpit.net.QlcProtocol
import com.diakonia.qlccockpit.net.ServerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

enum class ApiMode {
    /** not detected yet */
    Unknown,
    /** QLC+ built from the Cockpit API fork: full feature set */
    Cockpit,
    /** upstream QLC+ 5: functions, Virtual Console and Simple Desk only */
    Compat,
}

data class CockpitState(
    val connection: ConnectionState = ConnectionState.Idle,
    val mode: ApiMode = ApiMode.Unknown,
    val loading: Boolean = false,
    val error: String? = null,
    val info: ApiInfo? = null,
    val universes: List<UniverseInfo> = emptyList(),
    val fixtures: List<Fixture> = emptyList(),
    val groups: GroupsResponse = GroupsResponse(),
    val functions: List<QlcFunction> = emptyList(),
    val running: Set<Int> = emptySet(),
    val paused: Set<Int> = emptySet(),
    val chaserSteps: Map<Int, Int> = emptyMap(),
    val showTimes: Map<Int, Long> = emptyMap(),
    val intensities: Map<Int, Int> = emptyMap(),
    val grandMaster: Int = 255,
    val blackout: Boolean = false,
    val vc: VcRoot? = null,
    val vcPage: Int = 0,
    val widgets: Map<Int, VcWidgetState> = emptyMap(),
    val latencyMs: Long? = null,
    val lastAlert: String? = null,
) {
    val functionsById: Map<Int, QlcFunction> by lazy { functions.associateBy { it.id } }
    val isConnected: Boolean get() = connection is ConnectionState.Connected
}

/**
 * Single source of truth of the app: joins the initial JSON/API snapshot with the
 * live WebSocket pushes, and exposes every control action of the cockpit.
 */
class CockpitRepository(
    private val connection: QlcConnection = QlcConnection(),
    private val http: QlcHttpApi = QlcHttpApi(),
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    private val _state = MutableStateFlow(CockpitState())
    val state: StateFlow<CockpitState> = _state.asStateFlow()

    /** DMX values per universe, kept apart from [state] because they change at up to 25 Hz */
    val universes = UniverseStore()

    private val activeUniverses = MutableStateFlow<Set<Int>>(emptySet())
    private var subscribed: Set<Int> = emptySet()
    private var reloadJob: Job? = null
    private var pollJob: Job? = null

    init {
        scope.launch { connection.state.collect { s -> _state.update { it.copy(connection = s) } } }
        scope.launch { connection.events.collect(::onEvent) }
        scope.launch { connection.connectedEvents.collect { onConnected() } }
        scope.launch { activeUniverses.collect { syncSubscriptions() } }
        scope.launch { latencyLoop() }
    }

    val server: ServerConfig? get() = connection.server

    fun connect(server: ServerConfig) {
        _state.value = CockpitState(loading = true)
        universes.clear()
        subscribed = emptySet()
        connection.connect(server)
    }

    fun disconnect() {
        pollJob?.cancel()
        connection.disconnect()
        _state.value = CockpitState()
    }

    /** Screens declare which universes they display; values are streamed only for those. */
    fun setActiveUniverses(set: Set<Int>) {
        activeUniverses.value = set
    }

    /* ------------------------------------------------------------------ *
     * Loading
     * ------------------------------------------------------------------ */

    private suspend fun onConnected() {
        _state.update { it.copy(loading = true, error = null) }
        val reply = connection.request(QlcCommands.getApiVersion(), "getApiVersion", 1500)
        val mode = if (reply?.args?.firstOrNull()?.startsWith("cockpit") == true) ApiMode.Cockpit else ApiMode.Compat
        _state.update { it.copy(mode = mode) }
        subscribed = emptySet()
        reloadAll()
        syncSubscriptions()
    }

    fun reload() {
        scope.launch { reloadAll() }
    }

    private suspend fun reloadAll() {
        val server = connection.server ?: return
        _state.update { it.copy(loading = true) }
        try {
            if (_state.value.mode == ApiMode.Cockpit) loadCockpit(server) else loadCompat()
            loadVc(server)
            _state.update { it.copy(loading = false, error = null) }
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = e.message ?: e.javaClass.simpleName) }
        }
    }

    private suspend fun loadCockpit(server: ServerConfig) {
        val info = json.decodeFromString<ApiInfo>(http.get(server, "/api/info.json"))
        val fixtures = json.decodeFromString<FixturesResponse>(http.get(server, "/api/fixtures.json")).fixtures
        val groups = json.decodeFromString<GroupsResponse>(http.get(server, "/api/groups.json"))
        val functions = json.decodeFromString<FunctionsResponse>(http.get(server, "/api/functions.json")).functions
        _state.update { s ->
            s.copy(
                info = info,
                universes = info.universes,
                fixtures = fixtures,
                groups = groups,
                functions = functions,
                running = functions.filter { it.running }.map { it.id }.toSet(),
                paused = functions.filter { it.paused }.map { it.id }.toSet(),
                chaserSteps = functions.filter { it.currentStep >= 0 }.associate { it.id to it.currentStep },
                grandMaster = info.grandMaster,
                blackout = info.blackout,
            )
        }
    }

    private suspend fun loadCompat() {
        val list = connection.request(QlcCommands.getFunctionsList(), "getFunctionsList")
            ?.let { QlcProtocol.parseIdNameList(it.args) } ?: emptyList()
        val functions = ArrayList<QlcFunction>(list.size)
        val running = HashSet<Int>()
        for ((id, name) in list) {
            val type = connection.request(QlcCommands.getFunctionType(id), "getFunctionType")
                ?.args?.firstOrNull() ?: ""
            val status = connection.request(QlcCommands.getFunctionStatus(id), "getFunctionStatus")
                ?.args?.firstOrNull()
            if (status == "Running") running += id
            functions += QlcFunction(id = id, name = name, type = type)
        }
        // upstream QLC+ 5 has no universe list: expose 4 universes for the Simple Desk
        _state.update {
            it.copy(
                functions = functions,
                running = running,
                universes = (0 until 4).map { u -> UniverseInfo(u, "Universe ${u + 1}") },
            )
        }
    }

    private suspend fun loadVc(server: ServerConfig) {
        // requesting /vc.json also makes QLC+ start pushing widget updates
        val vc = runCatching { VcRoot.parse(http.get(server, "/vc.json")) }.getOrNull()
        _state.update { it.copy(vc = vc, vcPage = vc?.selectedPage ?: 0, widgets = emptyMap()) }
    }

    private fun scheduleReload() {
        reloadJob?.cancel()
        reloadJob = scope.launch {
            delay(400)
            reloadAll()
        }
    }

    /* ------------------------------------------------------------------ *
     * Universe streaming
     * ------------------------------------------------------------------ */

    @Synchronized
    private fun syncSubscriptions() {
        if (!_state.value.isConnected) return
        val wanted = activeUniverses.value
        when (_state.value.mode) {
            ApiMode.Cockpit -> {
                pollJob?.cancel()
                (wanted - subscribed).forEach { connection.send(QlcCommands.subscribeUniverse(it, true)) }
                (subscribed - wanted).forEach { connection.send(QlcCommands.subscribeUniverse(it, false)) }
                subscribed = wanted
            }
            ApiMode.Compat -> {
                if (pollJob?.isActive != true) pollJob = scope.launch { pollLoop() }
            }
            ApiMode.Unknown -> Unit
        }
    }

    /** Upstream QLC+ has no push for DMX values: poll them */
    private suspend fun pollLoop() {
        while (scope.isActive && _state.value.isConnected) {
            for (uni in activeUniverses.value) {
                val reply = connection.request(QlcCommands.getChannelsValues(uni, 0, 512), "getChannelsValues", 1000)
                    ?: continue
                universes.applyPairs(uni, QlcProtocol.parseChannelsValues(reply.args))
            }
            delay(150)
        }
    }

    private suspend fun latencyLoop() {
        while (scope.isActive) {
            delay(5000)
            if (!_state.value.isConnected) continue
            val t0 = System.nanoTime()
            val reply = connection.request(QlcCommands.isProjectLoaded(), "isProjectLoaded", 2000)
            val ms = if (reply != null) (System.nanoTime() - t0) / 1_000_000 else null
            _state.update { it.copy(latencyMs = ms) }
            // upstream flags a project (re)load from the web interface this way
            if (reply?.args?.firstOrNull() == "true") scheduleReload()
        }
    }

    /* ------------------------------------------------------------------ *
     * Push handling
     * ------------------------------------------------------------------ */

    private fun onEvent(e: QlcEvent) {
        when (e) {
            is QlcEvent.FunctionStatus -> _state.update {
                it.copy(
                    running = if (e.running) it.running + e.functionId else it.running - e.functionId,
                    paused = if (e.running) it.paused else it.paused - e.functionId,
                    showTimes = if (e.running) it.showTimes else it.showTimes - e.functionId,
                    chaserSteps = if (e.running) it.chaserSteps else it.chaserSteps - e.functionId,
                )
            }
            is QlcEvent.GrandMaster -> _state.update { it.copy(grandMaster = e.value) }
            is QlcEvent.VcPage -> _state.update { it.copy(vcPage = e.page) }
            is QlcEvent.Blackout -> _state.update { it.copy(blackout = e.on) }
            is QlcEvent.UniverseFrame -> universes.applyFrame(e.universe, e.values)
            is QlcEvent.ChaserStep -> _state.update { it.copy(chaserSteps = it.chaserSteps + (e.functionId to e.step)) }
            is QlcEvent.ShowTime -> _state.update {
                it.copy(
                    showTimes = it.showTimes + (e.functionId to e.elapsedMs),
                    paused = if (e.paused) it.paused + e.functionId else it.paused - e.functionId,
                )
            }
            QlcEvent.DocChanged -> scheduleReload()
            is QlcEvent.Alert -> _state.update { it.copy(lastAlert = e.text) }
            is QlcEvent.Widget -> onWidgetEvent(e)
            is QlcEvent.ApiReply, is QlcEvent.Unknown -> Unit
        }
    }

    private fun onWidgetEvent(e: QlcEvent.Widget) {
        val a = e.args
        _state.update { s ->
            val cur = s.widgets[e.widgetId] ?: VcWidgetState()
            val next = when (e.kind) {
                "BUTTON" -> cur.copy(value = a.int(0))
                "SLIDER" -> cur.copy(value = a.int(0), displayValue = a.getOrNull(1))
                "AUDIOTRIGGERS" -> cur.copy(value = if (QlcProtocol.parseBool(a.getOrNull(0))) 255 else 0)
                "AUDIO_VOLUME" -> cur.copy(sideFader = a.int(0))
                "BUTTON_DISABLE", "SLIDER_DISABLE", "LABEL_DISABLE", "WIDGET_DISABLE",
                "CUE_DISABLE", "FRAME_DISABLE" -> cur.copy(disabled = QlcProtocol.parseBool(a.getOrNull(0)))
                "WIDGET_VISIBLE" -> cur.copy(visible = QlcProtocol.parseBool(a.getOrNull(0)))
                "CUE" -> cur.copy(cueIndex = a.int(0))
                "CUE_STATE" -> cur.copy(
                    cueStatus = a.int(0), cueIndex = a.int(1), cueNextIndex = a.int(2), sideFader = a.int(3),
                )
                "CUE_SIDE" -> cur.copy(sideFader = a.int(0))
                "FRAME" -> cur.copy(framePage = a.int(0))
                "CLOCK" -> cur.copy(
                    clockTime = a.getOrNull(0)?.toLongOrNull(),
                    clockRunning = a.getOrNull(1)?.let { QlcProtocol.parseBool(it) } ?: cur.clockRunning,
                )
                "XYPAD" -> cur.copy(xyX = a.getOrNull(0)?.toDoubleOrNull(), xyY = a.getOrNull(1)?.toDoubleOrNull())
                "SPEED_STATE" -> cur.copy(speedTime = a.getOrNull(0)?.toLongOrNull(), speedFactor = a.int(1))
                "MATRIX_STATE" -> cur.copy(value = a.int(0), algorithmIndex = a.int(1), colors = a.drop(2))
                else -> return@update s
            }
            s.copy(widgets = s.widgets + (e.widgetId to next))
        }
    }

    private fun List<String>.int(i: Int): Int? = getOrNull(i)?.toIntOrNull() ?: getOrNull(i)?.toDoubleOrNull()?.toInt()

    /* ------------------------------------------------------------------ *
     * Actions
     * ------------------------------------------------------------------ */

    fun setFunctionRunning(id: Int, running: Boolean) {
        val fn = _state.value.functionsById[id]
        if (running && fn != null && fn.kind.isStepBased && _state.value.mode == ApiMode.Cockpit)
            connection.send(QlcCommands.chaserGoto(id, 0))
        else
            connection.send(QlcCommands.setFunctionStatus(id, running))
    }

    fun toggleFunction(id: Int) = setFunctionRunning(id, id !in _state.value.running)

    fun setFunctionIntensity(id: Int, value: Int) {
        _state.update { it.copy(intensities = it.intensities + (id to value)) }
        connection.sendThrottled("int:$id", QlcCommands.setFunctionIntensity(id, value))
    }

    fun pauseFunction(id: Int, paused: Boolean) {
        connection.send(QlcCommands.pauseFunction(id, paused))
        _state.update { if (paused) it.copy(paused = it.paused + id) else it.copy(paused = it.paused - id) }
    }

    fun seekFunction(id: Int, ms: Long) {
        connection.sendThrottled("seek:$id", QlcCommands.seekFunction(id, ms))
        _state.update { it.copy(showTimes = it.showTimes + (id to ms)) }
    }

    fun chaserNext(id: Int) = connection.send(QlcCommands.chaserNext(id))
    fun chaserPrev(id: Int) = connection.send(QlcCommands.chaserPrev(id))
    fun chaserGoto(id: Int, index: Int) = connection.send(QlcCommands.chaserGoto(id, index))

    fun stopAll() {
        if (_state.value.mode == ApiMode.Cockpit) connection.send(QlcCommands.stopAllFunctions())
        else _state.value.running.forEach { connection.send(QlcCommands.setFunctionStatus(it, false)) }
    }

    fun setBlackout(on: Boolean) {
        connection.send(QlcCommands.blackout(on))
    }

    fun setGrandMaster(value: Int) {
        _state.update { it.copy(grandMaster = value) }
        connection.sendThrottled("gm", QlcCommands.grandMaster(value))
    }

    /** Simple Desk channel (0-based universe and address) */
    fun setChannel(universe: Int, address: Int, value: Int) {
        universes.setLocal(universe, address, value)
        connection.sendThrottled("ch:$universe:$address", QlcCommands.channel(universe, address, value))
    }

    fun resetChannel(universe: Int, address: Int) = connection.send(QlcCommands.resetChannel(universe, address))
    fun resetUniverse(universe: Int) = connection.send(QlcCommands.resetUniverse(universe))

    fun setFixtureChannel(fixture: Fixture, channel: Int, value: Int) {
        universes.setLocal(fixture.universe, fixture.address + channel, value)
        connection.sendThrottled(
            "fx:${fixture.id}:$channel",
            QlcCommands.setFixtureChannel(fixture.id, channel, value),
        )
    }

    /** Several fixture channels in one message (colour pickers, XY pads, multi-selection) */
    fun setFixtureChannels(fixture: Fixture, values: Map<Int, Int>, throttleKey: String) {
        values.forEach { (ch, v) -> universes.setLocal(fixture.universe, fixture.address + ch, v) }
        connection.sendThrottled("fxs:${fixture.id}:$throttleKey", QlcCommands.setFixtureChannels(fixture.id, values))
    }

    fun releaseFixture(fixture: Fixture) = connection.send(QlcCommands.releaseFixture(fixture.id))

    // --- Virtual Console ---

    fun vcSelectPage(page: Int) = connection.send(QlcCommands.vcPage(page))

    fun vcButton(widgetId: Int, pressed: Boolean) = connection.send(QlcCommands.widget(widgetId, if (pressed) 255 else 0))

    fun vcSlider(widgetId: Int, value: Int) {
        _state.update { s ->
            val cur = s.widgets[widgetId] ?: VcWidgetState()
            s.copy(widgets = s.widgets + (widgetId to cur.copy(value = value)))
        }
        connection.sendThrottled("vcs:$widgetId", QlcCommands.widget(widgetId, value))
    }

    fun vcCue(widgetId: Int, command: String) = connection.send(QlcCommands.widget(widgetId, command))
    fun vcCueStep(widgetId: Int, index: Int) = connection.send(QlcCommands.widget(widgetId, "STEP", index))
    fun vcCueSide(widgetId: Int, level: Int) =
        connection.sendThrottled("vccs:$widgetId", QlcCommands.widget(widgetId, "CUE_SIDECHANGE", level))

    fun vcFrame(widgetId: Int, command: String, arg: Any? = null) =
        connection.send(if (arg == null) QlcCommands.widget(widgetId, command) else QlcCommands.widget(widgetId, command, arg))

    fun vcXYPad(widgetId: Int, x: Double, y: Double) =
        connection.sendThrottled("vcxy:$widgetId", QlcCommands.widget(widgetId, "XYPAD", x, y))

    fun vcSpeed(widgetId: Int, command: String, arg: Any? = null) =
        connection.send(if (arg == null) QlcCommands.widget(widgetId, command) else QlcCommands.widget(widgetId, command, arg))

    fun vcClock(widgetId: Int, command: String) = connection.send(QlcCommands.widget(widgetId, command))

    fun vcMatrix(widgetId: Int, command: String, arg: Any) =
        connection.sendThrottled("vcm:$widgetId:$command", QlcCommands.widget(widgetId, command, arg))

    fun vcAudioTriggers(widgetId: Int, enabled: Boolean) =
        connection.send(QlcCommands.widget(widgetId, if (enabled) 1 else 0))

    fun clearAlert() = _state.update { it.copy(lastAlert = null) }
}
