package com.diakonia.qlccockpit.model

import com.diakonia.qlccockpit.data.UniverseStore
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelsTest {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    @Test
    fun decodesCockpitFixtures() {
        val text = """
            {"fixtures":[{"id":0,"name":"PAR 1","type":"Color Changer","universe":0,"address":9,
              "channelsCount":3,"heads":1,"manufacturer":"Generic","model":"RGB","mode":"3ch","future":true,
              "channels":[{"index":0,"name":"Red","group":"Intensity","groupId":0,"colour":"Red","controlByte":0,"default":0,
                           "capabilities":[{"min":0,"max":255,"name":"Red","presetType":0}]}]}]}
        """.trimIndent()
        val fx = json.decodeFromString<FixturesResponse>(text).fixtures.single()
        assertEquals("PAR 1", fx.name)
        assertEquals(10, fx.displayAddress)
        assertEquals("Red", fx.channels.single().colour)
    }

    @Test
    fun decodesFunctionsWithSteps() {
        val text = """
            {"functions":[{"id":4,"name":"Chase","type":"Chaser","typeId":2,"path":"Shows/A","running":true,
              "currentStep":1,"steps":[{"index":0,"functionId":1,"functionName":"S1","fadeIn":0,"hold":1000,"fadeOut":0,"duration":1000,"note":""},
                                       {"index":1,"functionId":2,"functionName":"S2","fadeIn":500,"hold":-1,"fadeOut":0,"duration":-1,"note":"go"}]}]}
        """.trimIndent()
        val f = json.decodeFromString<FunctionsResponse>(text).functions.single()
        assertEquals(FunctionKind.Chaser, f.kind)
        assertEquals(2, f.steps.size)
        assertEquals("go", f.steps[1].note)
    }

    @Test
    fun parsesVcJson() {
        val text = """
            {"version":1,"selectedPage":0,"pages":[{"id":0,"typeId":4,"caption":"Page 1","page":0,
              "geometry":{"x":0,"y":0,"w":800,"h":600},"visible":true,"disabled":false,
              "children":[
                {"id":5,"typeId":1,"caption":"Blue","page":0,"geometry":{"x":10,"y":10,"w":80,"h":80},"actionType":1,"state":2},
                {"id":6,"typeId":7,"caption":"Cues","page":0,"geometry":{"x":100,"y":10,"w":200,"h":300},"chaserId":4,
                 "steps":[{"funcID":1,"funcName":"S1","note":"intro"}]},
                {"id":7,"typeId":4,"caption":"Sub","page":0,"geometry":{"x":0,"y":320,"w":300,"h":200},
                 "children":[{"id":8,"typeId":2,"caption":"Dim","geometry":{"x":0,"y":0,"w":50,"h":150},"value":128}]}
              ]}]}
        """.trimIndent()
        val vc = VcRoot.parse(text)
        assertEquals(5, vc.allWidgets.size) // page frame + 4 widgets
        assertEquals(VcWidgetType.Button, vc.allWidgets[5]?.type)
        assertEquals(1, vc.allWidgets[5]?.int("actionType"))
        assertEquals("intro", vc.allWidgets[6]?.cueSteps?.single()?.note)
        assertEquals(128, vc.allWidgets[8]?.int("value"))
    }

    @Test
    fun universeStoreAppliesFramesAndLocalValues() {
        val store = UniverseStore()
        store.applyFrame(0, ByteArray(512) { 10 })
        store.setLocal(0, 5, 300)
        assertEquals(10, store.values.value[0]!![0])
        assertEquals(255, store.values.value[0]!![5])
        store.applyPairs(1, listOf(0 to 7))
        assertEquals(7, store.values.value[1]!![0])
        assertEquals(0, store.values.value[1]!![600])
    }
}
