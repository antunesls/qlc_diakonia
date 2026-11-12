package com.diakonia.qlccockpit.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object CockpitColors {
    val Background = Color(0xFF0E0F12)
    val Surface = Color(0xFF16181D)
    val SurfaceHigh = Color(0xFF1F2229)
    val Outline = Color(0xFF2E323B)
    val Accent = Color(0xFFFFC447)
    val Running = Color(0xFF3DDC84)
    val Paused = Color(0xFFFFA726)
    val Danger = Color(0xFFFF4D4F)
    val Text = Color(0xFFE8EAED)
    val TextDim = Color(0xFF9AA0A6)

    /** Colour used for a fader of the given QLCChannel group */
    fun forGroup(groupId: Int, colour: String = ""): Color = when (groupId) {
        0 -> when (colour) { // Intensity: primary colour channels
            "Red" -> Color(0xFFFF5252)
            "Green" -> Color(0xFF69F0AE)
            "Blue" -> Color(0xFF448AFF)
            "Cyan" -> Color(0xFF18FFFF)
            "Magenta" -> Color(0xFFFF4081)
            "Yellow" -> Color(0xFFFFFF00)
            "Amber" -> Color(0xFFFFAB00)
            "White" -> Color(0xFFFAFAFA)
            "UV" -> Color(0xFFB388FF)
            "Lime" -> Color(0xFFC6FF00)
            "Indigo" -> Color(0xFF536DFE)
            else -> Accent
        }
        1 -> Color(0xFFE040FB) // Colour wheel
        2 -> Color(0xFF26C6DA) // Gobo
        3 -> Color(0xFF90A4AE) // Speed
        4, 5 -> Color(0xFF7C4DFF) // Pan / Tilt
        6 -> Color(0xFFFF7043) // Shutter
        7, 8 -> Color(0xFF4DB6AC) // Prism / Beam
        9 -> Color(0xFFF06292) // Effect
        10 -> Color(0xFF8D6E63) // Maintenance
        else -> Color(0xFF78909C)
    }
}

private val DarkScheme = darkColorScheme(
    primary = CockpitColors.Accent,
    onPrimary = Color.Black,
    secondary = Color(0xFF8AB4F8),
    background = CockpitColors.Background,
    onBackground = CockpitColors.Text,
    surface = CockpitColors.Surface,
    onSurface = CockpitColors.Text,
    surfaceVariant = CockpitColors.SurfaceHigh,
    onSurfaceVariant = CockpitColors.TextDim,
    outline = CockpitColors.Outline,
    error = CockpitColors.Danger,
)

/** Low brightness red scheme that preserves the operator's night vision during a show */
private val StageScheme = darkColorScheme(
    primary = Color(0xFFD32F2F),
    onPrimary = Color.Black,
    secondary = Color(0xFFB71C1C),
    background = Color.Black,
    onBackground = Color(0xFFE57373),
    surface = Color(0xFF120404),
    onSurface = Color(0xFFE57373),
    surfaceVariant = Color(0xFF1E0707),
    onSurfaceVariant = Color(0xFFA14545),
    outline = Color(0xFF3A1010),
    error = Color(0xFFFF1744),
)

private val CockpitTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp),
)

@Composable
fun CockpitTheme(stage: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (stage) StageScheme else DarkScheme,
        typography = CockpitTypography,
        content = content,
    )
}
