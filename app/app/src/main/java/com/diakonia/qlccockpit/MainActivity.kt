package com.diakonia.qlccockpit

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.diakonia.qlccockpit.ui.CockpitApp
import com.diakonia.qlccockpit.ui.theme.CockpitTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as QlcCockpitApp

        // lighting desk behaviour: screen always on, full screen
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        // auto-connect to the last used server
        if (savedInstanceState == null && app.settings.autoConnect && app.repository.server == null) {
            app.settings.recentServers().firstOrNull()?.let { app.repository.connect(it) }
        }

        setContent {
            var stage by remember { mutableStateOf(app.settings.stageTheme) }
            CockpitTheme(stage = stage) {
                CockpitApp(
                    repository = app.repository,
                    settings = app.settings,
                    stageTheme = stage,
                    onStageThemeChange = {
                        stage = it
                        app.settings.stageTheme = it
                    },
                )
            }
        }
    }
}
