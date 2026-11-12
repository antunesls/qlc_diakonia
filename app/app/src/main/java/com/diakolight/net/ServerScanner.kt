package com.diakonia.qlccockpit.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket

/** Finds hosts of the local /24 network with the QLC+ web access port open. */
object ServerScanner {

    fun localIpv4(context: Context): Inet4Address? {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return null
        val caps = cm.getNetworkCapabilities(network)
        if (caps != null && !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        ) return null
        return cm.getLinkProperties(network)?.linkAddresses
            ?.map { it.address }
            ?.filterIsInstance<Inet4Address>()
            ?.firstOrNull { !it.isLoopbackAddress }
    }

    suspend fun scan(context: Context, port: Int = 9999, onFound: (String) -> Unit): Int = withContext(Dispatchers.IO) {
        val local = localIpv4(context) ?: return@withContext 0
        val b = local.address
        val prefix = "${b[0].toInt() and 0xFF}.${b[1].toInt() and 0xFF}.${b[2].toInt() and 0xFF}"
        val gate = Semaphore(48)
        var found = 0
        coroutineScope {
            (1..254).map { i ->
                async {
                    gate.withPermit {
                        val host = "$prefix.$i"
                        if (isOpen(host, port)) {
                            synchronized(this@ServerScanner) { found++ }
                            withContext(Dispatchers.Main) { onFound(host) }
                        }
                    }
                }
            }.awaitAll()
        }
        found
    }

    private fun isOpen(host: String, port: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(host, port), 250); true }
    } catch (_: Exception) {
        false
    }
}
