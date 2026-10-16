import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseStringPromise } from "xml2js";

/**
 * QLC+ fixture definitions (.qxf), used to understand what every channel of a
 * patched fixture does, so that scenes can be written as "red at 100%" rather
 * than raw channel numbers.
 *
 * Two sources exist: the .qxf files on this machine (the same directories
 * QLC+ itself reads) and, when connected to the QLC+ fork, the server's own
 * fixture cache queried over the native protocol.
 */

export type ChannelRole =
  | "master_dimmer"
  | "dimmer"
  | "red"
  | "green"
  | "blue"
  | "white"
  | "amber"
  | "uv"
  | "cyan"
  | "magenta"
  | "yellow"
  | "lime"
  | "indigo"
  | "hue"
  | "saturation"
  | "cto"
  | "pan"
  | "tilt"
  | "color_wheel"
  | "color_macro"
  | "shutter"
  | "strobe"
  | "gobo"
  | "prism"
  | "beam"
  | "zoom"
  | "focus"
  | "speed"
  | "effect"
  | "maintenance"
  | "nothing"
  | "other";

export interface CapabilityDef {
  min: number;
  max: number;
  name: string;
  preset?: string;
  /** Color associated to the capability (#rrggbb), when the definition has one */
  color?: string;
}

export interface ChannelDef {
  name: string;
  role: ChannelRole;
  /** Fine (LSB) channel of a 16 bit pair */
  fine: boolean;
  preset?: string;
  group?: string;
  capabilities: CapabilityDef[];
}

export interface ModeDef {
  name: string;
  channels: ChannelDef[];
  /** Channel indexes of each head (multi-cell fixtures) */
  heads: number[][];
}

export interface FixtureDef {
  manufacturer: string;
  model: string;
  type: string;
  modes: ModeDef[];
}

export interface LibraryEntry {
  manufacturer: string;
  model: string;
  type: string;
}

export interface FixtureLibrary {
  search(query: string, limit: number): Promise<LibraryEntry[]>;
  manufacturers(): Promise<string[]>;
  get(manufacturer: string, model: string): Promise<FixtureDef | undefined>;
}

const PRESET_ROLES: [RegExp, ChannelRole][] = [
  [/^IntensityMasterDimmer/, "master_dimmer"],
  [/^IntensityDimmer/, "dimmer"],
  [/^IntensityRed/, "red"],
  [/^IntensityGreen/, "green"],
  [/^IntensityBlue/, "blue"],
  [/^IntensityWhite/, "white"],
  [/^IntensityAmber/, "amber"],
  [/^IntensityUV/, "uv"],
  [/^IntensityCyan/, "cyan"],
  [/^IntensityMagenta/, "magenta"],
  [/^IntensityYellow/, "yellow"],
  [/^IntensityLime/, "lime"],
  [/^IntensityIndigo/, "indigo"],
  [/^IntensityHue/, "hue"],
  [/^IntensitySaturation/, "saturation"],
  [/^IntensityLightness|^IntensityValue/, "dimmer"],
  [/^PositionPan/, "pan"],
  [/^PositionTilt/, "tilt"],
  [/^PositionXAxis/, "pan"],
  [/^PositionYAxis/, "tilt"],
  [/^ColorWheel/, "color_wheel"],
  [/^ColorMacro/, "color_macro"],
  [/^ColorCTO|^ColorCTB|^ColorCTC/, "cto"],
  [/^ShutterStrobe/, "strobe"],
  [/^Shutter/, "shutter"],
  [/^GoboWheel|^GoboIndex/, "gobo"],
  [/^Prism/, "prism"],
  [/^BeamZoom/, "zoom"],
  [/^BeamFocus/, "focus"],
  [/^Beam/, "beam"],
  [/^Speed/, "speed"],
  [/^NoFunction/, "nothing"],
];

const COLOUR_ROLES: Record<string, ChannelRole> = {
  red: "red",
  green: "green",
  blue: "blue",
  white: "white",
  amber: "amber",
  uv: "uv",
  cyan: "cyan",
  magenta: "magenta",
  yellow: "yellow",
  lime: "lime",
  indigo: "indigo",
};

const GROUP_ROLES: Record<string, ChannelRole> = {
  Pan: "pan",
  Tilt: "tilt",
  Colour: "color_wheel",
  Gobo: "gobo",
  Shutter: "shutter",
  Prism: "prism",
  Beam: "beam",
  Speed: "speed",
  Effect: "effect",
  Maintenance: "maintenance",
  Nothing: "nothing",
};

export function classifyChannel(
  name: string,
  preset: string | undefined,
  group: string | undefined,
  colour: string | undefined,
  groupByte = 0,
): { role: ChannelRole; fine: boolean } {
  if (preset) {
    const fine = /Fine$/.test(preset);
    for (const [pattern, role] of PRESET_ROLES) {
      if (pattern.test(preset)) return { role, fine };
    }
    return { role: "other", fine };
  }
  const fine = groupByte === 1;
  if (group === "Intensity") {
    const colourRole = colour ? COLOUR_ROLES[colour.toLowerCase()] : undefined;
    if (colourRole) return { role: colourRole, fine };
    return { role: /master/i.test(name) ? "master_dimmer" : "dimmer", fine };
  }
  if (group === "Colour" && /macro/i.test(name)) return { role: "color_macro", fine };
  if (group === "Shutter" && /strob/i.test(name)) return { role: "strobe", fine };
  return { role: (group && GROUP_ROLES[group]) || "other", fine };
}

type XmlObj = Record<string, any>;

function list(node: unknown, tag: string): any[] {
  if (!node || typeof node !== "object") return [];
  const value = (node as XmlObj)[tag];
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function text(node: unknown): string {
  if (typeof node === "string") return node.trim();
  if (node && typeof node === "object" && typeof (node as XmlObj)._ === "string")
    return (node as XmlObj)._.trim();
  return "";
}

function attrs(node: unknown): Record<string, string> {
  return (node && typeof node === "object" && (node as XmlObj).$) || {};
}

export async function parseFixtureDefinition(xml: string): Promise<FixtureDef> {
  if (/<!ENTITY/i.test(xml)) throw new Error("Fixture definition entities are not allowed");
  const parsed = await parseStringPromise(xml, {
    explicitArray: true,
    tagNameProcessors: [(name: string) => name.split(":").at(-1) ?? name],
  });
  const root = parsed.FixtureDefinition ?? {};

  const channels = new Map<string, ChannelDef>();
  for (const channel of list(root, "Channel")) {
    const a = attrs(channel);
    const groupNode = list(channel, "Group")[0];
    const group = groupNode ? text(groupNode) : undefined;
    const groupByte = groupNode ? Number(attrs(groupNode).Byte ?? 0) : 0;
    const colour = list(channel, "Colour")[0];
    const { role, fine } = classifyChannel(
      a.Name ?? "",
      a.Preset,
      group,
      colour ? text(colour) : undefined,
      groupByte,
    );
    channels.set(a.Name ?? "", {
      name: a.Name ?? "",
      role,
      fine,
      preset: a.Preset,
      group,
      capabilities: list(channel, "Capability").map((cap) => {
        const c = attrs(cap);
        const res1 = c.Res1 ?? c.Color;
        return {
          min: Number(c.Min ?? 0),
          max: Number(c.Max ?? 255),
          name: text(cap),
          preset: c.Preset,
          color: res1 && /^#[0-9a-f]{6}$/i.test(res1) ? res1.toLowerCase() : undefined,
        };
      }),
    });
  }

  const modes: ModeDef[] = list(root, "Mode").map((mode) => {
    const modeChannels = list(mode, "Channel")
      .map((ch) => ({ number: Number(attrs(ch).Number ?? 0), name: text(ch) }))
      .sort((x, y) => x.number - y.number)
      .map(
        ({ name }) =>
          channels.get(name) ?? {
            name,
            role: "other" as const,
            fine: false,
            capabilities: [],
          },
      );
    const heads = list(mode, "Head").map((head) =>
      list(head, "Channel").map((ch) => Number(text(ch))),
    );
    return { name: attrs(mode).Name ?? "", channels: modeChannels, heads };
  });

  return {
    manufacturer: text(list(root, "Manufacturer")[0]),
    model: text(list(root, "Model")[0]),
    type: text(list(root, "Type")[0]),
    modes,
  };
}

/** Fixture::genericDimmerDef: "Generic"/"Generic" with one dimmer per channel */
export function genericDimmerDefinition(channels: number): FixtureDef {
  const defs: ChannelDef[] = Array.from({ length: channels }, (_, index) => ({
    name: `Dimmer #${index + 1}`,
    role: "dimmer",
    fine: false,
    capabilities: [{ min: 0, max: 255, name: "Intensity" }],
  }));
  return {
    manufacturer: "Generic",
    model: "Generic",
    type: "Dimmer",
    modes: [
      {
        name: `${channels} Channel`,
        channels: defs,
        heads: defs.map((_, index) => [index]),
      },
    ],
  };
}

export function defaultFixtureDirectories(): string[] {
  const home = os.homedir();
  const drive = process.env.SystemDrive ?? "C:";
  const candidates =
    process.platform === "win32"
      ? [
          `${drive}\\qlcplus\\Fixtures`,
          `${drive}\\QLC+\\Fixtures`,
          `${drive}\\QLC+5\\Fixtures`,
          path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "QLC+", "Fixtures"),
          path.join(home, "QLC+", "Fixtures"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/QLC+.app/Contents/Resources/Fixtures",
            path.join(home, "Library", "Application Support", "QLC+", "Fixtures"),
          ]
        : ["/usr/share/qlcplus/fixtures", path.join(home, ".qlcplus", "fixtures")];
  return candidates;
}

interface IndexedEntry extends LibraryEntry {
  file: string;
}

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 3) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, depth + 1);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".qxf")) out.push(full);
  }
}

function headerField(source: string, tag: string): string {
  const match = source.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? decodeEntities(match[1].trim()) : "";
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function key(manufacturer: string, model: string): string {
  return `${manufacturer.trim().toLowerCase()}\u0000${model.trim().toLowerCase()}`;
}

export function scoreEntry(entry: LibraryEntry, tokens: string[]): number {
  const haystack = `${entry.manufacturer} ${entry.model} ${entry.type}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return 0;
    score += entry.model.toLowerCase().includes(token) ? 2 : 1;
  }
  return score;
}

export class LocalFixtureLibrary implements FixtureLibrary {
  private index: Map<string, IndexedEntry> | null = null;
  private readonly cache = new Map<string, FixtureDef>();

  constructor(private readonly directories: string[]) {}

  private load(): Map<string, IndexedEntry> {
    if (this.index) return this.index;
    const index = new Map<string, IndexedEntry>();
    // Later directories (user fixtures) override the system ones, like QLC+ does
    for (const dir of this.directories) {
      const files: string[] = [];
      walk(dir, files);
      for (const file of files) {
        let head: string;
        try {
          const fd = fs.openSync(file, "r");
          const buffer = Buffer.alloc(4096);
          const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
          fs.closeSync(fd);
          head = buffer.subarray(0, read).toString("utf8");
        } catch {
          continue;
        }
        const manufacturer = headerField(head, "Manufacturer");
        const model = headerField(head, "Model");
        if (!manufacturer || !model) continue;
        index.set(key(manufacturer, model), {
          manufacturer,
          model,
          type: headerField(head, "Type"),
          file,
        });
      }
    }
    this.index = index;
    return index;
  }

  get size(): number {
    return this.load().size;
  }

  async search(query: string, limit: number): Promise<LibraryEntry[]> {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.load().values()]
      .map((entry) => ({ entry, score: tokens.length ? scoreEntry(entry, tokens) : 1 }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.entry.model.localeCompare(b.entry.model))
      .slice(0, limit)
      .map(({ entry: { manufacturer, model, type } }) => ({ manufacturer, model, type }));
  }

  async manufacturers(): Promise<string[]> {
    return [...new Set([...this.load().values()].map((e) => e.manufacturer))].sort();
  }

  async get(manufacturer: string, model: string): Promise<FixtureDef | undefined> {
    const k = key(manufacturer, model);
    const cached = this.cache.get(k);
    if (cached) return cached;
    const entry = this.load().get(k);
    if (!entry) return undefined;
    const def = await parseFixtureDefinition(fs.readFileSync(entry.file, "utf8"));
    this.cache.set(k, def);
    return def;
  }
}

/** Mode of a patched fixture, falling back to raw channels when unknown */
export function resolveMode(
  def: FixtureDef | undefined,
  modeName: string,
  channelCount: number,
): ModeDef {
  const mode =
    def?.modes.find((m) => m.name === modeName) ??
    def?.modes.find((m) => m.name.toLowerCase() === modeName.toLowerCase());
  if (mode) return mode;
  const channels: ChannelDef[] = Array.from({ length: channelCount }, (_, index) => ({
    name: `Channel ${index + 1}`,
    role: "other",
    fine: false,
    capabilities: [],
  }));
  return { name: modeName, channels, heads: [] };
}
