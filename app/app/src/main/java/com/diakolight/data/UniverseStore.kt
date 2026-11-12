package com.diakonia.qlccockpit.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Immutable snapshot of the 512 DMX values of one universe */
class UniverseValues(private val data: ByteArray = ByteArray(512)) {
    operator fun get(address: Int): Int = if (address in data.indices) data[address].toInt() and 0xFF else 0

    fun with(address: Int, value: Int): UniverseValues {
        if (address !in data.indices) return this
        val copy = data.copyOf()
        copy[address] = value.coerceIn(0, 255).toByte()
        return UniverseValues(copy)
    }

    fun withPairs(pairs: List<Pair<Int, Int>>): UniverseValues {
        val copy = data.copyOf()
        for ((a, v) in pairs) if (a in copy.indices) copy[a] = v.coerceIn(0, 255).toByte()
        return UniverseValues(copy)
    }

    companion object {
        val EMPTY = UniverseValues()
        fun of(frame: ByteArray): UniverseValues = UniverseValues(frame.copyOf(512))
    }
}

/** Live DMX output values, per universe (0-based) */
class UniverseStore {
    private val _values = MutableStateFlow<Map<Int, UniverseValues>>(emptyMap())
    val values: StateFlow<Map<Int, UniverseValues>> = _values.asStateFlow()

    fun applyFrame(universe: Int, frame: ByteArray) =
        _values.update { it + (universe to UniverseValues.of(frame)) }

    fun applyPairs(universe: Int, pairs: List<Pair<Int, Int>>) =
        _values.update { it + (universe to (it[universe] ?: UniverseValues.EMPTY).withPairs(pairs)) }

    /** Optimistic local update while the user moves a fader */
    fun setLocal(universe: Int, address: Int, value: Int) =
        _values.update { it + (universe to (it[universe] ?: UniverseValues.EMPTY).with(address, value)) }

    fun clear() {
        _values.value = emptyMap()
    }
}
