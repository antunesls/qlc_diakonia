import { argbToRgb, colorDistance, parseColor, type Rgb } from "./color.js";
import type { CapabilityDef, ChannelDef, ChannelRole, ModeDef } from "./fixtureLibrary.js";
import type { SceneChannelValue } from "./xml/functions.js";

/**
 * A fixture "look" expressed the way a lighting designer talks about it.
 * Percentages are 0-100. `channels` sets raw DMX values by channel name or
 * 0-based index and always wins over the derived values.
 */
export interface FixtureLook {
  dimmer?: number;
  color?: string;
  white?: number;
  amber?: number;
  uv?: number;
  /** 0-100, 50 = center */
  pan?: number;
  tilt?: number;
  /** 0 = off, otherwise strobe speed 1-100 */
  strobe?: number;
  shutter?: "open" | "closed";
  /** Substring of a gobo capability name, e.g. "star" */
  gobo?: string;
  zoom?: number;
  focus?: number;
  channels?: Record<string, number>;
}

export interface ComposedValues {
  values: SceneChannelValue[];
  warnings: string[];
}

const pct = (value: number) => Math.round((Math.max(0, Math.min(100, value)) / 100) * 255);

function indexesOf(mode: ModeDef, role: ChannelRole, fine = false): number[] {
  return mode.channels
    .map((ch, index) => ({ ch, index }))
    .filter(({ ch }) => ch.role === role && ch.fine === fine)
    .map(({ index }) => index);
}

function findCapability(channel: ChannelDef, predicate: (name: string, preset?: string) => boolean) {
  return channel.capabilities.find((cap) => predicate(cap.name.toLowerCase(), cap.preset));
}

function middle(cap: { min: number; max: number }): number {
  return Math.round((cap.min + cap.max) / 2);
}

export function composeFixtureValues(mode: ModeDef, look: FixtureLook): ComposedValues {
  const values = new Map<number, number>();
  const warnings: string[] = [];
  const set = (indexes: number[], value: number) =>
    indexes.forEach((index) => values.set(index, Math.max(0, Math.min(255, Math.round(value)))));

  const masters = indexesOf(mode, "master_dimmer");
  const dimmers = indexesOf(mode, "dimmer");
  const reds = indexesOf(mode, "red");
  const greens = indexesOf(mode, "green");
  const blues = indexesOf(mode, "blue");
  const cyans = indexesOf(mode, "cyan");
  const magentas = indexesOf(mode, "magenta");
  const yellows = indexesOf(mode, "yellow");
  const hasRgb = reds.length > 0 && greens.length > 0 && blues.length > 0;
  const hasCmy = cyans.length > 0 && magentas.length > 0 && yellows.length > 0;
  const intensityChannels = masters.length ? masters : dimmers;

  let rgb: Rgb | undefined;
  if (look.color !== undefined) rgb = argbToRgb(parseColor(look.color));

  // Fixtures without any dimmer channel are dimmed through their color mix
  const colorScale =
    look.dimmer !== undefined && intensityChannels.length === 0 ? look.dimmer / 100 : 1;

  if (look.dimmer !== undefined) {
    if (intensityChannels.length) set(intensityChannels, pct(look.dimmer));
    else if (!hasRgb && !hasCmy) warnings.push("fixture has no dimmer channel");
    // Per-cell dimmers of a multi-head fixture follow the master
    if (masters.length && dimmers.length) set(dimmers, pct(look.dimmer));
  }

  if (rgb) {
    if (hasRgb) {
      set(reds, rgb.r * colorScale);
      set(greens, rgb.g * colorScale);
      set(blues, rgb.b * colorScale);
    } else if (hasCmy) {
      set(cyans, 255 - rgb.r * colorScale);
      set(magentas, 255 - rgb.g * colorScale);
      set(yellows, 255 - rgb.b * colorScale);
    } else {
      const wheelIndex = mode.channels.findIndex(
        (ch) => (ch.role === "color_wheel" || ch.role === "color_macro") && !ch.fine,
      );
      if (wheelIndex >= 0) {
        const wheel = mode.channels[wheelIndex];
        const withColor = wheel.capabilities.filter((cap) => cap.color);
        let best: CapabilityDef | undefined = withColor
          .map((cap) => ({ cap, d: colorDistance(argbToRgb(parseColor(cap.color!)), rgb!) }))
          .sort((a, b) => a.d - b.d)[0]?.cap;
        if (!best && look.color) {
          const wanted = look.color.toLowerCase();
          best = wheel.capabilities.find((cap) => cap.name.toLowerCase().includes(wanted));
        }
        if (best) set([wheelIndex], middle(best));
        else warnings.push(`no color wheel slot matches '${look.color}'`);
      } else {
        warnings.push("fixture has no color channels");
      }
    }
    // With a color and no explicit dimmer, make sure the fixture actually emits light
    if (look.dimmer === undefined && intensityChannels.length) set(intensityChannels, 255);
  }

  const single = (role: ChannelRole, value: number | undefined, label: string) => {
    if (value === undefined) return;
    const indexes = indexesOf(mode, role);
    if (indexes.length) set(indexes, pct(value));
    else warnings.push(`fixture has no ${label} channel`);
  };
  single("white", look.white, "white");
  single("amber", look.amber, "amber");
  single("uv", look.uv, "UV");
  single("zoom", look.zoom, "zoom");
  single("focus", look.focus, "focus");

  const position = (role: "pan" | "tilt", value: number | undefined) => {
    if (value === undefined) return;
    const coarse = indexesOf(mode, role);
    const fine = indexesOf(mode, role, true);
    if (!coarse.length) {
      warnings.push(`fixture has no ${role} channel`);
      return;
    }
    const full = Math.round((Math.max(0, Math.min(100, value)) / 100) * 65535);
    set(coarse, full >> 8);
    set(fine, full & 0xff);
  };
  position("pan", look.pan);
  position("tilt", look.tilt);

  // Shutter and strobe: open the shutter whenever the fixture is meant to emit
  const shutterIndexes = mode.channels
    .map((ch, index) => ({ ch, index }))
    .filter(({ ch }) => (ch.role === "shutter" || ch.role === "strobe") && !ch.fine);
  const emitting = (look.dimmer ?? 0) > 0 || rgb !== undefined || look.white !== undefined;
  for (const { ch, index } of shutterIndexes) {
    if (look.shutter === "closed") {
      const closed = findCapability(ch, (name, preset) => preset === "ShutterClose" || /clos|blackout/.test(name));
      if (closed) set([index], closed.min);
      continue;
    }
    if (look.strobe !== undefined && look.strobe > 0) {
      const strobe = findCapability(
        ch,
        (name, preset) => /^Strobe(SlowToFast|FastToSlow|Frequency)/.test(preset ?? "") || /strob/.test(name),
      );
      if (strobe) {
        const span = strobe.max - strobe.min;
        const slowToFast = !/FastToSlow/.test(strobe.preset ?? "");
        const ratio = look.strobe / 100;
        set([index], strobe.min + span * (slowToFast ? ratio : 1 - ratio));
        continue;
      }
    }
    if (look.shutter === "open" || emitting) {
      const open = findCapability(ch, (name, preset) => preset === "ShutterOpen" || /open|on\b/.test(name));
      if (open) set([index], open.min);
    }
  }
  if (look.strobe !== undefined && look.strobe > 0 && !shutterIndexes.length) {
    warnings.push("fixture has no strobe channel");
  }

  if (look.gobo) {
    const wanted = look.gobo.toLowerCase();
    const goboIndex = mode.channels.findIndex(
      (ch) => ch.role === "gobo" && !ch.fine && ch.capabilities.some((cap) => cap.name.toLowerCase().includes(wanted)),
    );
    if (goboIndex >= 0) {
      const cap = mode.channels[goboIndex].capabilities.find((c) => c.name.toLowerCase().includes(wanted))!;
      set([goboIndex], cap.min);
    } else {
      warnings.push(`no gobo matches '${look.gobo}'`);
    }
  }

  for (const [ref, value] of Object.entries(look.channels ?? {})) {
    const index = /^\d+$/.test(ref)
      ? Number(ref)
      : mode.channels.findIndex((ch) => ch.name.toLowerCase() === ref.toLowerCase());
    if (index < 0 || index >= mode.channels.length) {
      warnings.push(`unknown channel '${ref}'`);
      continue;
    }
    set([index], value);
  }

  return {
    values: [...values.entries()]
      .sort(([a], [b]) => a - b)
      .map(([channel, value]) => ({ channel, value })),
    warnings,
  };
}

/** Human readable description of a mode, for agents choosing what to set */
export function describeMode(mode: ModeDef): { index: number; name: string; role: string }[] {
  return mode.channels.map((ch, index) => ({
    index,
    name: ch.name,
    role: ch.fine ? `${ch.role}_fine` : ch.role,
  }));
}
