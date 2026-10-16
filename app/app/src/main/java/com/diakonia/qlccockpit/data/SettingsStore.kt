package com.diakonia.qlccockpit.data

import android.content.Context
import com.diakonia.qlccockpit.net.ServerConfig

/** Remembers the last servers used (most recent first) and UI preferences */
class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("cockpit", Context.MODE_PRIVATE)

    fun recentServers(): List<ServerConfig> =
        prefs.getString(KEY_SERVERS, "").orEmpty()
            .lines()
            .filter { it.isNotBlank() }
            .mapNotNull { line ->
                val p = line.split('\t')
                val host = p.getOrNull(0) ?: return@mapNotNull null
                ServerConfig(
                    host = host,
                    port = p.getOrNull(1)?.toIntOrNull() ?: 9999,
                    user = p.getOrNull(2).orEmpty(),
                    password = p.getOrNull(3).orEmpty(),
                )
            }

    fun remember(server: ServerConfig) {
        val list = listOf(server) + recentServers().filterNot { it.host == server.host && it.port == server.port }
        prefs.edit()
            .putString(KEY_SERVERS, list.take(8).joinToString("\n") { "${it.host}\t${it.port}\t${it.user}\t${it.password}" })
            .apply()
    }

    fun forget(server: ServerConfig) {
        val list = recentServers().filterNot { it.host == server.host && it.port == server.port }
        prefs.edit()
            .putString(KEY_SERVERS, list.joinToString("\n") { "${it.host}\t${it.port}\t${it.user}\t${it.password}" })
            .apply()
    }

    var autoConnect: Boolean
        get() = prefs.getBoolean(KEY_AUTOCONNECT, true)
        set(v) = prefs.edit().putBoolean(KEY_AUTOCONNECT, v).apply()

    var stageTheme: Boolean
        get() = prefs.getBoolean(KEY_STAGE, false)
        set(v) = prefs.edit().putBoolean(KEY_STAGE, v).apply()

    private companion object {
        const val KEY_SERVERS = "servers"
        const val KEY_AUTOCONNECT = "autoconnect"
        const val KEY_STAGE = "stage_theme"
    }
}
