package com.diakonia.qlccockpit.model

import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/** A point of the stage, in meters. X to the right (audience view), Y up, Z toward the audience. */
data class P3(val x: Float, val y: Float, val z: Float) {
    operator fun plus(o: P3) = P3(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: P3) = P3(x - o.x, y - o.y, z - o.z)
    operator fun times(k: Float) = P3(x * k, y * k, z * k)
    fun dot(o: P3) = x * o.x + y * o.y + z * o.z
    fun cross(o: P3) = P3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun norm() = sqrt(dot(this))
    fun unit(): P3 = norm().let { if (it == 0f) this else this * (1f / it) }
}

data class Projected(val x: Float, val y: Float, val depth: Float)

/** Orbit camera looking at [target]; [yaw] 0 is the audience point of view. */
data class OrbitCamera(
    val yaw: Float = 0f,
    val pitch: Float = 0.3f,
    val distance: Float = 9f,
    val target: P3 = P3(0f, 1f, 0f),
) {
    fun limited() = copy(pitch = pitch.coerceIn(0.03f, 1.45f), distance = distance.coerceIn(2.5f, 40f))
}

/** Perspective projection of an [OrbitCamera] on a [width] x [height] canvas. */
class Projector(cam: OrbitCamera, val width: Float, val height: Float) {
    private val eye: P3
    private val right: P3
    private val up: P3
    private val forward: P3
    val focal = height * 1.05f

    init {
        val cp = cos(cam.pitch)
        eye = cam.target + P3(sin(cam.yaw) * cp, sin(cam.pitch), cos(cam.yaw) * cp) * cam.distance
        forward = (cam.target - eye).unit()
        right = forward.cross(P3(0f, 1f, 0f)).unit()
        up = right.cross(forward)
    }

    /** Screen position and depth of [p], or null if it is behind the camera. */
    fun project(p: P3): Projected? {
        val v = p - eye
        val depth = v.dot(forward)
        if (depth < 0.1f) return null
        return Projected(width / 2 + focal * v.dot(right) / depth, height / 2 - focal * v.dot(up) / depth, depth)
    }

    /** On-screen size (pixels) of [meters] at [depth] */
    fun scale(meters: Float, depth: Float) = focal * meters / depth
}

/** Where each fixture stands, in meters. Uses the placement of the QLC+ Monitor when it exists. */
fun stageLayout(fixtures: List<Fixture>): Map<Int, P3> {
    val placed = fixtures.filter { it.position != null }
    val loose = fixtures.filter { it.position == null }.sortedBy { it.universe * 512 + it.address }
    val out = LinkedHashMap<Int, P3>()
    placed.forEach { fx ->
        val p = fx.position!!
        out[fx.id] = P3((p.x / 1000).toFloat(), (p.y / 1000).toFloat(), (p.z / 1000).toFloat())
    }
    // fixtures without placement stand in a row, centered on the placed ones (or on the origin)
    val cx = if (placed.isEmpty()) 0f else out.values.map { it.x }.average().toFloat()
    val cz = if (placed.isEmpty()) 0f else out.values.map { it.z }.average().toFloat()
    loose.forEachIndexed { i, fx ->
        out[fx.id] = P3(cx + (i - (loose.size - 1) / 2f) * 1.1f, 2.2f, cz)
    }
    return out
}

/** Axis-aligned bounds of a layout: min and max corners */
fun layoutBounds(points: Collection<P3>): Pair<P3, P3> {
    if (points.isEmpty()) return P3(-3f, 0f, -2f) to P3(3f, 2f, 2f)
    return P3(points.minOf { it.x }, points.minOf { it.y }, points.minOf { it.z }) to
        P3(points.maxOf { it.x }, points.maxOf { it.y }, points.maxOf { it.z })
}

/** Camera that frames the whole layout from the audience side. */
fun framingCamera(points: Collection<P3>, yaw: Float = 0f, pitch: Float = 0.3f): OrbitCamera {
    val (lo, hi) = layoutBounds(points)
    val span = max(hi.x - lo.x, max(hi.z - lo.z, 2f))
    return OrbitCamera(
        yaw, pitch, (span * 0.95f + 3f),
        P3((lo.x + hi.x) / 2, max(0.8f, (lo.y + hi.y) / 2 * 0.6f), (lo.z + hi.z) / 2),
    ).limited()
}
