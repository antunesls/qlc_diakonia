package com.diakonia.qlccockpit.net

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Credentials
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import java.util.concurrent.TimeUnit

data class ServerConfig(
    val host: String,
    val port: Int = 9999,
    val user: String = "",
    val password: String = "",
) {
    val baseUrl: String get() = "http://$host:$port"
    val wsUrl: String get() = "ws://$host:$port/qlcplusWS"
    val authHeader: String? get() = if (user.isNotEmpty()) Credentials.basic(user, password) else null
}

sealed interface ConnectionState {
    data object Idle : ConnectionState
    data class Connecting(val attempt: Int) : ConnectionState
    data object Connected : ConnectionState
    data class Failed(val reason: String, val retryInMs: Long) : ConnectionState
}

/**
 * WebSocket session with the QLC+ web access.
 * - reconnects automatically with exponential backoff
 * - coalesces high-rate messages (faders) so at most one message per key is sent every [THROTTLE_MS]
 * - offers a serialized request/response helper for "QLC+API|..." commands
 */
class QlcConnection(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    private val client: OkHttpClient = defaultClient(),
) {
    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Idle)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<QlcEvent>(
        extraBufferCapacity = 1024,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<QlcEvent> = _events.asSharedFlow()

    /** Emitted every time a (re)connection is established */
    private val _connectedEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
    val connectedEvents: SharedFlow<Unit> = _connectedEvents.asSharedFlow()

    @Volatile private var socket: WebSocket? = null
    @Volatile private var config: ServerConfig? = null
    private var loopJob: Job? = null
    private var flushJob: Job? = null

    private val pendingLock = Any()
    private val pending = LinkedHashMap<String, String>()

    private val requestMutex = Mutex()
    @Volatile private var pendingReply: Pair<String, CompletableDeferred<QlcEvent.ApiReply>>? = null

    val server: ServerConfig? get() = config

    fun connect(server: ServerConfig) {
        disconnect()
        config = server
        loopJob = scope.launch { connectionLoop(server) }
        flushJob = scope.launch { flushLoop() }
    }

    fun disconnect() {
        loopJob?.cancel()
        flushJob?.cancel()
        loopJob = null
        flushJob = null
        socket?.close(1000, "bye")
        socket = null
        config = null
        synchronized(pendingLock) { pending.clear() }
        _state.value = ConnectionState.Idle
    }

    /** Send immediately. Returns false when not connected. */
    fun send(message: String): Boolean = socket?.send(message) ?: false

    /**
     * Send the latest message for [key] at most every [THROTTLE_MS].
     * Used for faders: intermediate values are dropped, the last one is always delivered.
     */
    fun sendThrottled(key: String, message: String) {
        synchronized(pendingLock) {
            pending.remove(key)
            pending[key] = message
        }
    }

    /**
     * Send a "QLC+API|<command>|..." request and wait for its reply.
     * Requests are serialized because some upstream replies don't carry the request arguments.
     */
    suspend fun request(message: String, command: String, timeoutMs: Long = 2000): QlcEvent.ApiReply? =
        requestMutex.withLock {
            val deferred = CompletableDeferred<QlcEvent.ApiReply>()
            pendingReply = command to deferred
            try {
                if (!send(message)) return@withLock null
                withTimeoutOrNull(timeoutMs) { deferred.await() }
            } finally {
                pendingReply = null
            }
        }

    private suspend fun connectionLoop(server: ServerConfig) {
        var attempt = 0
        while (scope.isActive) {
            attempt++
            _state.value = ConnectionState.Connecting(attempt)
            val closed = CompletableDeferred<String>()
            val opened = CompletableDeferred<Unit>()

            val builder = Request.Builder().url(server.wsUrl)
            server.authHeader?.let { builder.header("Authorization", it) }

            val ws = client.newWebSocket(builder.build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    opened.complete(Unit)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    dispatch(text)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                    closed.complete(if (reason.isNotEmpty()) reason else "closed ($code)")
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    closed.complete("closed ($code)")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    val why = when {
                        response?.code == 401 -> "authentication required"
                        response != null -> "HTTP ${response.code}"
                        else -> t.message ?: t.javaClass.simpleName
                    }
                    opened.completeExceptionally(IOException(why))
                    closed.complete(why)
                }
            })
            socket = ws

            val ok = runCatching { opened.await() }.isSuccess
            if (ok) {
                attempt = 0
                _state.value = ConnectionState.Connected
                _connectedEvents.tryEmit(Unit)
            }
            val reason = closed.await()
            socket = null

            val backoff = (500L shl (attempt.coerceIn(1, 4) - 1)).coerceAtMost(5000L)
            _state.value = ConnectionState.Failed(reason, backoff)
            delay(backoff)
        }
    }

    private suspend fun flushLoop() {
        while (scope.isActive) {
            delay(THROTTLE_MS)
            val batch: List<String> = synchronized(pendingLock) {
                if (pending.isEmpty()) emptyList()
                else pending.values.toList().also { pending.clear() }
            }
            val ws = socket ?: continue
            for (msg in batch) ws.send(msg)
        }
    }

    private fun dispatch(text: String) {
        val event = QlcProtocol.parse(text)
        if (event is QlcEvent.ApiReply) {
            pendingReply?.let { (cmd, deferred) ->
                if (cmd == event.command) deferred.complete(event)
            }
        }
        _events.tryEmit(event)
    }

    companion object {
        const val THROTTLE_MS = 25L

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(10, TimeUnit.SECONDS)
            .build()
    }
}

/** Plain HTTP access to /vc.json and the Cockpit /api/<name>.json resources */
class QlcHttpApi(private val client: OkHttpClient = QlcConnection.defaultClient()) {

    suspend fun get(server: ServerConfig, path: String): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(server.baseUrl + path)
        server.authHeader?.let { builder.header("Authorization", it) }
        client.newCall(builder.build()).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("GET $path -> HTTP ${resp.code}")
            resp.body?.string() ?: throw IOException("GET $path -> empty body")
        }
    }
}
