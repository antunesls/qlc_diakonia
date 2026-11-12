package com.diakolight

import android.app.Application
import com.diakolight.data.CockpitRepository
import com.diakolight.data.SettingsStore

class QlcCockpitApp : Application() {
    /** Process-wide: the WebSocket session survives configuration changes */
    val repository: CockpitRepository by lazy { CockpitRepository() }
    val settings: SettingsStore by lazy { SettingsStore(this) }
}
