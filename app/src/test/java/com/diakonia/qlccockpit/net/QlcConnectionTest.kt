package com.diakonia.qlccockpit.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

/** Talks to a fake QLC+ WebSocket server */
class QlcConnectionTest {
    private lateinit var server: MockWebServer
    private val received = CopyOnWriteArrayList<String>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send("FUNCTION|3|Running")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                received += text
                if (text == "QLC+API|getApiVersion") webSocket.send("QLC+API|getApiVersion|cockpit-1")
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }
        }))
        server.start()
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.shutdown()
    }

    private fun config() = ServerConfig(host = server.hostName, port = server.port)

    @Test
    fun connectsReceivesPushesAndAnswersRequests() = runBlocking {
        val conn = QlcConnection(scope)
        val firstPush = scope.async { conn.events.first { it is QlcEvent.FunctionStatus } }
        conn.connect(config())

        withTimeout(5000) { conn.state.first { it is ConnectionState.Connected } }
        assertEquals(QlcEvent.FunctionStatus(3, true), withTimeout(5000) { firstPush.await() })

        val reply = conn.request(QlcCommands.getApiVersion(), "getApiVersion")
        assertEquals(listOf("cockpit-1"), reply?.args)
        conn.disconnect()
    }

    @Test
    fun throttledMessagesKeepOnlyTheLastValue() = runBlocking {
        val conn = QlcConnection(scope)
        conn.connect(config())
        withTimeout(5000) { conn.state.first { it is ConnectionState.Connected } }

        for (v in 0..200) conn.sendThrottled("ch:0:0", QlcCommands.channel(0, 0, v))
        withTimeout(5000) {
            while (received.none { it == "CH|1|200" }) kotlinx.coroutines.delay(20)
        }
        val chMessages = received.filter { it.startsWith("CH|1|") }
        assertTrue("throttling should coalesce, got ${chMessages.size}", chMessages.size < 10)
        assertEquals("CH|1|200", chMessages.last())
        conn.disconnect()
    }
}
