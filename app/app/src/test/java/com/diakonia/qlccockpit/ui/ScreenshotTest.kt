package com.diakonia.qlccockpit.ui

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.diakonia.qlccockpit.data.ApiMode
import com.diakonia.qlccockpit.data.CockpitRepository
import com.diakonia.qlccockpit.data.CockpitState
import com.diakonia.qlccockpit.data.SettingsStore
import com.diakonia.qlccockpit.model.ApiInfo
import com.diakonia.qlccockpit.model.Capability
import com.diakonia.qlccockpit.model.ChaserStep
import com.diakonia.qlccockpit.model.Fixture
import com.diakonia.qlccockpit.model.FixtureChannel
import com.diakonia.qlccockpit.model.FixtureGroup
import com.diakonia.qlccockpit.model.GroupHead
import com.diakonia.qlccockpit.model.GroupsResponse
import com.diakonia.qlccockpit.model.QlcFunction
import com.diakonia.qlccockpit.model.ShowItem
import com.diakonia.qlccockpit.model.ShowTrack
import com.diakonia.qlccockpit.model.UniverseInfo
import com.diakonia.qlccockpit.model.VcRoot
import com.diakonia.qlccockpit.net.ConnectionState
import com.diakonia.qlccockpit.ui.theme.CockpitTheme
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Renders every screen with a sample project, as on a 10" landscape tablet (1920x1200). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w1280dp-h800dp-land-hdpi")
class ScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private fun rgb(id: Int, name: String, addr: Int) = Fixture(
        id = id, name = name, type = "Color Changer", universe = 0, address = addr, channelsCount = 4,
        manufacturer = "Generic", model = "RGBW PAR", mode = "4ch",
        channels = listOf(
            FixtureChannel(0, "Red", "Intensity", 0, "Red"),
            FixtureChannel(1, "Green", "Intensity", 0, "Green"),
            FixtureChannel(2, "Blue", "Intensity", 0, "Blue"),
            FixtureChannel(3, "White", "Intensity", 0, "White"),
        ),
    )

    private val movingHead = Fixture(
        id = 10, name = "Spot Esquerdo", type = "Moving Head", universe = 0, address = 100, channelsCount = 8,
        manufacturer = "Clay Paky", model = "Mini B", mode = "Standard",
        channels = listOf(
            FixtureChannel(0, "Pan", "Pan", 4), FixtureChannel(1, "Pan fine", "Pan", 4, controlByte = 1),
            FixtureChannel(2, "Tilt", "Tilt", 5), FixtureChannel(3, "Tilt fine", "Tilt", 5, controlByte = 1),
            FixtureChannel(4, "Dimmer", "Intensity", 0, "Generic"),
            FixtureChannel(5, "Shutter", "Shutter", 6, capabilities = listOf(
                Capability(0, 31, "Closed"), Capability(32, 63, "Open"), Capability(64, 127, "Strobe slow-fast"),
                Capability(128, 255, "Pulse"),
            )),
            FixtureChannel(6, "Color wheel", "Colour", 1, capabilities = listOf(
                Capability(0, 15, "White", 1, "#ffffff"), Capability(16, 31, "Red", 1, "#ff0000"),
                Capability(32, 47, "Blue", 1, "#0000ff"), Capability(48, 63, "Green", 1, "#00ff00"),
                Capability(64, 79, "Amber", 1, "#ffbf00"), Capability(80, 127, "Rainbow"),
            )),
            FixtureChannel(7, "Gobo", "Gobo", 2, capabilities = listOf(
                Capability(0, 9, "Open"), Capability(10, 19, "Gobo 1"), Capability(20, 29, "Gobo 2"),
            )),
        ),
    )

    private val fixtures = listOf(rgb(1, "PAR Palco 1", 0), rgb(2, "PAR Palco 2", 4), rgb(3, "PAR Palco 3", 8), movingHead)

    private val functions = listOf(
        QlcFunction(1, "Azul Louvor", "Scene", path = "Culto"),
        QlcFunction(2, "Âmbar Pregação", "Scene", path = "Culto"),
        QlcFunction(3, "Branco Geral", "Scene"),
        QlcFunction(4, "Blackout palco", "Scene"),
        QlcFunction(5, "Arco-íris", "RGBMatrix", path = "Efeitos"),
        QlcFunction(6, "Círculo spots", "EFX", path = "Efeitos"),
        QlcFunction(
            7, "Abertura", "Chaser", path = "Culto",
            steps = listOf(
                ChaserStep(0, 3, "Branco Geral", 0, 2000, 500, note = "Entrada"),
                ChaserStep(1, 1, "Azul Louvor", 1000, 8000, 1000, note = "1ª música"),
                ChaserStep(2, 2, "Âmbar Pregação", 2000, -1, 1000, note = "Palavra"),
                ChaserStep(3, 4, "Blackout palco", 500, -1, 0),
            ),
        ),
        QlcFunction(
            8, "Show Natal", "Show", totalDuration = 180_000,
            tracks = listOf(
                ShowTrack(0, "Palco", listOf(ShowItem(1, "Azul Louvor", 0, 60_000), ShowItem(2, "Âmbar", 60_000, 90_000))),
                ShowTrack(1, "Efeitos", listOf(ShowItem(5, "Arco-íris", 30_000, 40_000), ShowItem(6, "Círculo", 120_000, 50_000))),
            ),
        ),
        QlcFunction(9, "Sequência entrada", "Sequence"),
    )

    private val vcJson = """
        {"version":1,"selectedPage":0,"pages":[{"id":0,"typeId":4,"caption":"Culto","page":0,
          "geometry":{"x":0,"y":0,"w":1200,"h":700},"visible":true,
          "children":[
            {"id":11,"typeId":1,"caption":"Azul","page":0,"geometry":{"x":10,"y":10,"w":120,"h":90},"bgColor":"#1e3a8a","state":2,"actionType":0,"visible":true},
            {"id":12,"typeId":1,"caption":"Âmbar","page":0,"geometry":{"x":140,"y":10,"w":120,"h":90},"bgColor":"#92400e","state":0,"visible":true},
            {"id":13,"typeId":1,"caption":"Strobe (flash)","page":0,"geometry":{"x":270,"y":10,"w":120,"h":90},"state":0,"actionType":1,"visible":true},
            {"id":14,"typeId":2,"caption":"Palco","page":0,"geometry":{"x":10,"y":110,"w":70,"h":260},"value":200,"visible":true},
            {"id":15,"typeId":2,"caption":"Plateia","page":0,"geometry":{"x":90,"y":110,"w":70,"h":260},"value":90,"visible":true},
            {"id":16,"typeId":7,"caption":"Culto domingo","page":0,"geometry":{"x":420,"y":10,"w":380,"h":360},"chaserId":7,
             "playbackStatus":1,"playbackIndex":1,"visible":true,
             "steps":[{"funcID":3,"funcName":"Branco Geral","note":"Entrada"},{"funcID":1,"funcName":"Azul Louvor","note":"1ª música"},
                      {"funcID":2,"funcName":"Âmbar Pregação","note":"Palavra"}]},
            {"id":17,"typeId":4,"caption":"Efeitos","page":0,"geometry":{"x":820,"y":10,"w":370,"h":360},"multiPageMode":true,
             "currentPage":0,"totalPages":2,"showHeader":true,"visible":true,
             "children":[{"id":18,"typeId":1,"caption":"Arco-íris","page":0,"geometry":{"x":10,"y":40,"w":110,"h":80},"visible":true},
                         {"id":19,"typeId":1,"caption":"Círculo","page":0,"geometry":{"x":130,"y":40,"w":110,"h":80},"visible":true},
                         {"id":20,"typeId":3,"caption":"Spots","page":0,"geometry":{"x":10,"y":130,"w":220,"h":220},
                          "position":{"x":128,"y":64},"visible":true}]},
            {"id":21,"typeId":11,"caption":"","page":0,"geometry":{"x":180,"y":110,"w":220,"h":100},"clockType":1,"currentTime":754000,"visible":true}
          ]}]}
    """.trimIndent()

    private val state = CockpitState(
        connection = ConnectionState.Connected,
        mode = ApiMode.Cockpit,
        info = ApiInfo("cockpit-1", "Q Light Controller Plus", "5.3.1", universes = listOf(UniverseInfo(0, "Palco"), UniverseInfo(1, "Plateia"))),
        universes = listOf(UniverseInfo(0, "Palco"), UniverseInfo(1, "Plateia")),
        fixtures = fixtures,
        groups = GroupsResponse(fixtureGroups = listOf(FixtureGroup(1, "PARs", 3, 1, listOf(GroupHead(0, 0, 1, 0), GroupHead(1, 0, 2, 0), GroupHead(2, 0, 3, 0))))),
        functions = functions,
        running = setOf(1, 7, 8),
        chaserSteps = mapOf(7 to 1),
        showTimes = mapOf(8 to 72_400),
        grandMaster = 230,
        latencyMs = 6,
        vc = VcRoot.parse(vcJson),
    )

    private fun render(dest: Destination, name: String, player: Int? = null) {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        val repo = CockpitRepository()
        val frame = ByteArray(512)
        // PAR 1 blue-ish, PAR 2 amber, moving head at 60% with pan/tilt
        frame[0] = 20; frame[1] = 60; frame[2] = 255.toByte(); frame[4] = 255.toByte(); frame[5] = 140.toByte()
        for (i in 0 until 40) frame[200 + i] = (i * 6).toByte()
        frame[100] = 100; frame[102] = 60; frame[104] = 153.toByte(); frame[105] = 40; frame[106] = 20
        repo.universes.applyFrame(0, frame)
        compose.setContent {
            CockpitTheme {
                CockpitContent(
                    state = state, repository = repo, settings = SettingsStore(app),
                    stageTheme = false, onStageThemeChange = {},
                    initialDestination = dest, initialPlayerFunction = player,
                )
            }
        }
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/$name.png")
    }

    @Test fun functions() = render(Destination.Functions, "01_funcoes")
    @Test fun playerShow() = render(Destination.Player, "02_player_show", player = 8)
    @Test fun playerChaser() = render(Destination.Player, "03_player_chaser", player = 7)
    @Test fun fixtures() = render(Destination.Fixtures, "04_fixtures")
    @Test fun desk() = render(Destination.Desk, "05_mesa_dmx")
    @Test fun console() = render(Destination.Console, "06_console")
    @Test fun connection() = render(Destination.Connection, "07_conexao")
}
