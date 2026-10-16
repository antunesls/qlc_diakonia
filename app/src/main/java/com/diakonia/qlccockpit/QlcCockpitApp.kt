package com.diakonia.qlccockpit

import android.app.Application
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.SettingsStore

class QlcCockpitApp : Application() {
    /** Process-wide: the WebSocket session survives configuration changes */
    val repository: CockpitRepository by lazy { CockpitRepository() }
    val settings: SettingsStore by lazy { SettingsStore(this) }
}
