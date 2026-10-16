import { parseStringPromise } from "xml2js";

/**
 * Complete, read-only model of a QLC+ workspace as transferred by the native
 * server. It is rebuilt from scratch on every project transfer and is the
 * single source of truth for IDs, references and verification of edits.
 */

export interface UniverseInfo {
  id: number;
  name: string;
  input?: PatchInfo;
  output?: PatchInfo;
  feedback?: PatchInfo;
}

export interface PatchInfo {
  plugin: string;
  line: number;
  uid?: string;
}

export interface FixtureInfo {
  id: number;
  name: string;
  manufacturer: string;
  model: string;
  mode: string;
  universe: number;
  /** 0-based DMX address */
  address: number;
  channels: number;
}

export interface FixtureGroupInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  heads: { fixtureId: number; head: number; x: number; y: number }[];
}

export interface SpeedInfo {
  fadeIn: number;
  fadeOut: number;
  duration: number;
}

export interface StepInfo {
  functionId?: number;
  fadeIn: number;
  hold: number;
  fadeOut: number;
  note?: string;
  values?: { fixtureId: number; channel: number; value: number }[];
}

export interface FunctionInfo {
  id: number;
  type: string;
  name: string;
  path?: string;
  hidden: boolean;
  speed?: SpeedInfo;
  runOrder?: string;
  direction?: string;
  /** Scene */
  values?: { fixtureId: number; channel: number; value: number }[];
  sceneFixtures?: number[];
  fixtureGroups?: number[];
  /** Chaser / Sequence */
  steps?: StepInfo[];
  boundSceneId?: number;
  /** Collection */
  functionIds?: number[];
  /** EFX */
  algorithm?: string;
  efxFixtures?: { fixtureId: number; head: number; mode: number }[];
  /** RGB Matrix */
  fixtureGroupId?: number;
  colors?: number[];
  /** Show */
  tracks?: {
    id: number;
    name: string;
    mute: boolean;
    items: { uid?: number; functionId: number; startTime: number; duration?: number }[];
  }[];
  /** Script */
  lines?: string[];
  /** Audio / Video */
  source?: string;
}

export type VcWidgetType =
  | "page"
  | "frame"
  | "soloframe"
  | "button"
  | "slider"
  | "cuelist"
  | "speeddial"
  | "xypad"
  | "label"
  | "clock"
  | "audiotriggers"
  | "animation"
  | "unknown";

export interface VcWidgetInfo {
  id: number;
  type: VcWidgetType;
  caption: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Page inside the parent multipage frame */
  page: number;
  parentId: number | null;
  /** Index of the Virtual Console page holding the widget */
  vcPage: number;
  framePath: string[];
  childIds: number[];
  backgroundColor?: number;
  foregroundColor?: number;
  /** Button / Animation */
  functionId?: number;
  action?: string;
  /** Slider */
  sliderMode?: string;
  low?: number;
  high?: number;
  value?: number;
  levelChannels?: { fixtureId: number; channel: number }[];
  /** CueList */
  chaserId?: number;
  /** SpeedDial */
  speedDialFunctionIds?: number[];
  /** Frame */
  pages?: number;
}

/** 2D/3D view placement of a fixture item, positions in millimeters */
export interface FixturePlacement {
  fixtureId: number;
  head: number;
  linked: number;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number };
}

/** Stage size of the 2D/3D views, in meters (units 0) or feet (units 1) */
export interface StageInfo {
  width: number;
  height: number;
  depth: number;
  units: number;
}

export interface ProjectModel {
  universes: UniverseInfo[];
  fixtures: FixtureInfo[];
  placements: FixturePlacement[];
  stage: StageInfo;
  fixtureGroups: FixtureGroupInfo[];
  functions: FunctionInfo[];
  vcPages: VcWidgetInfo[];
  vcWidgets: VcWidgetInfo[];
  xml: string;
}

const INVALID_ID = 0xffffffff;

type XmlObj = Record<string, any>;

function attrsOf(node: unknown): Record<string, string> {
  return (node && typeof node === "object" && (node as XmlObj).$) || {};
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && typeof (node as XmlObj)._ === "string")
    return (node as XmlObj)._;
  return "";
}

function children(node: unknown, tag: string): any[] {
  if (!node || typeof node !== "object") return [];
  const value = (node as XmlObj)[tag];
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function child(node: unknown, tag: string): any {
  return children(node, tag)[0];
}

function childText(node: unknown, tag: string): string | undefined {
  const found = child(node, tag);
  return found === undefined ? undefined : textOf(found).trim();
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validId(value: number | undefined): number | undefined {
  return value === undefined || value === INVALID_ID ? undefined : value;
}

/** Same XML safety policy as the inventory parser: no entities, no external DTD */
export function assertSafeWorkspaceXml(source: string): void {
  if (/<!ENTITY/i.test(source)) {
    throw new Error("QLC+ project XML entities are not allowed");
  }
  const doctypes = source.match(/<!DOCTYPE\b[^>]*>/gi) ?? [];
  if (
    (/<!DOCTYPE/i.test(source) && doctypes.length === 0) ||
    doctypes.some((value) => !/^<!DOCTYPE\s+Workspace\s*>$/i.test(value))
  ) {
    throw new Error("QLC+ project external or extended DTD is not allowed");
  }
}

function parsePatch(node: unknown): PatchInfo | undefined {
  if (!node) return undefined;
  const a = attrsOf(node);
  if (!a.Plugin) return undefined;
  return { plugin: a.Plugin, line: num(a.Line), uid: a.UID };
}

function parseSpeed(fn: unknown): SpeedInfo | undefined {
  const speed = child(fn, "Speed");
  if (!speed) return undefined;
  const a = attrsOf(speed);
  return { fadeIn: num(a.FadeIn), fadeOut: num(a.FadeOut), duration: num(a.Duration) };
}

function parseStepValues(text: string): StepInfo["values"] {
  const values: NonNullable<StepInfo["values"]> = [];
  const chunks = text.split(":");
  for (let index = 0; index + 1 < chunks.length; index += 2) {
    const fixtureId = num(chunks[index]);
    const pairs = chunks[index + 1].split(",");
    for (let p = 0; p + 1 < pairs.length; p += 2) {
      values.push({ fixtureId, channel: num(pairs[p]), value: num(pairs[p + 1]) });
    }
  }
  return values;
}

function parseFunction(fn: unknown): FunctionInfo {
  const a = attrsOf(fn);
  const type = a.Type ?? "Unknown";
  const info: FunctionInfo = {
    id: num(a.ID),
    type,
    name: a.Name ?? "",
    path: a.Path || undefined,
    hidden: a.Hidden !== undefined,
    speed: parseSpeed(fn),
    runOrder: childText(fn, "RunOrder"),
    direction: childText(fn, "Direction"),
  };

  const steps = (): StepInfo[] =>
    children(fn, "Step")
      .map((step) => {
        const s = attrsOf(step);
        const text = textOf(step).trim();
        const isSequence = type === "Sequence";
        return {
          number: num(s.Number),
          step: {
            functionId: isSequence ? undefined : optNum(text),
            fadeIn: num(s.FadeIn),
            hold: num(s.Hold ?? s.Duration),
            fadeOut: num(s.FadeOut),
            note: s.Note || undefined,
            values: isSequence ? parseStepValues(text) : undefined,
          } satisfies StepInfo,
        };
      })
      .sort((x, y) => x.number - y.number)
      .map(({ step }) => step);

  switch (type) {
    case "Scene": {
      info.values = [];
      info.sceneFixtures = [];
      for (const fv of children(fn, "FixtureVal")) {
        const fixtureId = num(attrsOf(fv).ID);
        info.sceneFixtures.push(fixtureId);
        const parts = textOf(fv).trim().split(",").filter(Boolean);
        for (let p = 0; p + 1 < parts.length; p += 2) {
          info.values.push({ fixtureId, channel: num(parts[p]), value: num(parts[p + 1]) });
        }
      }
      info.fixtureGroups = children(fn, "FixtureGroup").map((g) => num(attrsOf(g).ID));
      break;
    }
    case "Chaser":
      info.steps = steps();
      break;
    case "Sequence":
      info.boundSceneId = optNum(a.BoundScene);
      info.steps = steps();
      break;
    case "Collection":
      info.functionIds = children(fn, "Step")
        .sort((x, y) => num(attrsOf(x).Number) - num(attrsOf(y).Number))
        .map((step) => num(textOf(step)));
      break;
    case "EFX":
      info.algorithm = childText(fn, "Algorithm");
      info.efxFixtures = children(fn, "Fixture").map((f) => ({
        fixtureId: num(childText(f, "ID")),
        head: num(childText(f, "Head")),
        mode: num(childText(f, "Mode")),
      }));
      break;
    case "RGBMatrix": {
      const algo = child(fn, "Algorithm");
      info.algorithm = algo ? textOf(algo).trim() || attrsOf(algo).Type : undefined;
      info.fixtureGroupId = optNum(childText(fn, "FixtureGroup"));
      info.colors = children(fn, "Color")
        .sort((x, y) => num(attrsOf(x).Index) - num(attrsOf(y).Index))
        .map((c) => num(textOf(c)));
      break;
    }
    case "Show":
      info.tracks = children(fn, "Track").map((track) => {
        const t = attrsOf(track);
        return {
          id: num(t.ID),
          name: t.Name ?? "",
          mute: t.isMute === "1",
          items: children(track, "ShowFunction").map((sf) => {
            const s = attrsOf(sf);
            return {
              uid: optNum(s.UID),
              functionId: num(s.ID),
              startTime: num(s.StartTime),
              duration: optNum(s.Duration),
            };
          }),
        };
      });
      break;
    case "Script":
      info.lines = children(fn, "Command").map((c) => {
        try {
          return decodeURIComponent(textOf(c));
        } catch {
          return textOf(c);
        }
      });
      break;
    case "Audio":
    case "Video":
      info.source = childText(fn, "Source");
      break;
  }
  return info;
}

const WIDGET_TAGS: Record<string, VcWidgetType> = {
  Frame: "frame",
  SoloFrame: "soloframe",
  Button: "button",
  Slider: "slider",
  CueList: "cuelist",
  SpeedDial: "speeddial",
  XYPad: "xypad",
  Label: "label",
  Clock: "clock",
  AudioTriggers: "audiotriggers",
  Matrix: "animation",
};

function colorValue(value: string | undefined): number | undefined {
  if (!value || value === "Default") return undefined;
  return optNum(value);
}

function parseWidgets(vc: unknown): { pages: VcWidgetInfo[]; widgets: VcWidgetInfo[] } {
  const pages: VcWidgetInfo[] = [];
  const widgets: VcWidgetInfo[] = [];

  const build = (
    node: unknown,
    type: VcWidgetType,
    parentId: number | null,
    vcPage: number,
    framePath: string[],
  ): VcWidgetInfo => {
    const a = attrsOf(node);
    const ws = attrsOf(child(node, "WindowState"));
    const appearance = child(node, "Appearance");
    const widget: VcWidgetInfo = {
      id: num(a.ID, INVALID_ID),
      type,
      caption: a.Caption ?? "",
      x: num(ws.X),
      y: num(ws.Y),
      width: num(ws.Width),
      height: num(ws.Height),
      page: num(a.Page),
      parentId,
      vcPage,
      framePath,
      childIds: [],
      backgroundColor: colorValue(childText(appearance, "BackgroundColor")),
      foregroundColor: colorValue(childText(appearance, "ForegroundColor")),
    };

    switch (type) {
      case "button":
        widget.functionId = validId(optNum(attrsOf(child(node, "Function")).ID));
        widget.action = childText(node, "Action")?.toLowerCase() ?? "toggle";
        break;
      case "animation":
        widget.functionId = validId(optNum(attrsOf(child(node, "Function")).ID));
        break;
      case "slider": {
        widget.sliderMode = childText(node, "SliderMode")?.toLowerCase();
        const level = attrsOf(child(node, "Level"));
        widget.low = optNum(level.LowLimit);
        widget.high = optNum(level.HighLimit);
        widget.value = optNum(level.Value);
        widget.levelChannels = children(child(node, "Level"), "Channel").map((c) => ({
          fixtureId: num(attrsOf(c).Fixture),
          channel: num(textOf(c)),
        }));
        const adjust = attrsOf(child(node, "Adjust"));
        widget.functionId = validId(optNum(adjust.Function));
        if (widget.functionId === undefined) {
          // legacy <Playback><Function>id</Function></Playback>
          widget.functionId = validId(optNum(childText(child(node, "Playback"), "Function")));
        }
        break;
      }
      case "cuelist":
        widget.chaserId = validId(optNum(childText(node, "Chaser")));
        break;
      case "speeddial":
        widget.speedDialFunctionIds = children(node, "Function").map((f) => num(textOf(f)));
        break;
      case "page":
      case "frame":
      case "soloframe": {
        const multipage = attrsOf(child(node, "Multipage"));
        widget.pages = optNum(multipage.PagesNum) ?? 1;
        break;
      }
    }

    // pre-order: a widget is listed before its children
    if (type !== "page") widgets.push(widget);
    const nextPath = type === "page" ? framePath : widget.caption ? [...framePath, widget.caption] : framePath;
    for (const [tag, widgetType] of Object.entries(WIDGET_TAGS)) {
      for (const childNode of children(node, tag)) {
        const childWidget = build(childNode, widgetType, widget.id, vcPage, nextPath);
        widget.childIds.push(childWidget.id);
      }
    }
    return widget;
  };

  children(vc, "Frame").forEach((pageNode, index) => {
    const page = build(pageNode, "page", null, index, []);
    if (page.id === INVALID_ID) page.id = index;
    page.caption ||= `Page ${index + 1}`;
    pages.push(page);
  });
  return { pages, widgets };
}

export async function parseProjectModel(
  xml: Buffer | string,
  maximumSize = 16 * 1024 * 1024,
): Promise<ProjectModel> {
  const source = typeof xml === "string" ? xml : xml.toString("utf8");
  if (Buffer.byteLength(source) > maximumSize) {
    throw new Error("QLC+ project exceeds configured size limit");
  }
  assertSafeWorkspaceXml(source);

  const parsed = await parseStringPromise(source, {
    explicitArray: true,
    explicitRoot: true,
    tagNameProcessors: [(name: string) => name.split(":").at(-1) ?? name],
  });
  const workspace = parsed.Workspace ?? {};
  const engine = child(workspace, "Engine") ?? {};
  const ioMap = child(engine, "InputOutputMap");

  const universes: UniverseInfo[] = children(ioMap, "Universe").map((u) => {
    const a = attrsOf(u);
    return {
      id: num(a.ID),
      name: a.Name ?? "",
      input: parsePatch(child(u, "Input")),
      output: parsePatch(child(u, "Output")),
      feedback: parsePatch(child(u, "Feedback")),
    };
  });

  const fixtures: FixtureInfo[] = children(engine, "Fixture").map((f) => ({
    id: num(childText(f, "ID")),
    name: childText(f, "Name") ?? "",
    manufacturer: childText(f, "Manufacturer") ?? "",
    model: childText(f, "Model") ?? "",
    mode: childText(f, "Mode") ?? "",
    universe: num(childText(f, "Universe")),
    address: num(childText(f, "Address")),
    channels: num(childText(f, "Channels"), 1),
  }));

  const fixtureGroups: FixtureGroupInfo[] = children(engine, "FixtureGroup").map((g) => {
    const size = attrsOf(child(g, "Size"));
    return {
      id: num(attrsOf(g).ID),
      name: childText(g, "Name") ?? "",
      width: num(size.X),
      height: num(size.Y),
      heads: children(g, "Head").map((h) => {
        const a = attrsOf(h);
        return { fixtureId: num(a.Fixture), head: num(textOf(h)), x: num(a.X), y: num(a.Y) };
      }),
    };
  });

  const functions = children(engine, "Function").map(parseFunction);
  const { pages, widgets } = parseWidgets(child(workspace, "VirtualConsole"));

  const monitor = child(engine, "Monitor");
  const grid = attrsOf(child(monitor, "Grid"));
  const stage: StageInfo = {
    width: num(grid.Width, 5),
    height: num(grid.Height, 3),
    depth: num(grid.Depth, 5),
    units: num(grid.Units, 0),
  };
  const placements: FixturePlacement[] = children(monitor, "FxItem").map((item) => {
    const a = attrsOf(item);
    return {
      fixtureId: num(a.ID),
      head: num(a.Head, 0),
      linked: num(a.Linked, 0),
      x: Number(a.XPos ?? 0),
      y: Number(a.YPos ?? 0),
      z: Number(a.ZPos ?? 0),
      rotation: { x: Number(a.XRot ?? 0), y: Number(a.YRot ?? 0), z: Number(a.ZRot ?? 0) },
    };
  });

  return {
    universes,
    fixtures,
    placements,
    stage,
    fixtureGroups,
    functions,
    vcPages: pages,
    vcWidgets: widgets,
    xml: source,
  };
}

export function emptyProjectModel(): ProjectModel {
  return {
    universes: [],
    fixtures: [],
    placements: [],
    stage: { width: 5, height: 3, depth: 5, units: 0 },
    fixtureGroups: [],
    functions: [],
    vcPages: [],
    vcWidgets: [],
    xml: "",
  };
}

/* ------------------------------------------------------------- lookups */

function sameName(a: string, b: string): boolean {
  return a.trim().normalize("NFC").toLowerCase() === b.trim().normalize("NFC").toLowerCase();
}

function resolveBy<T extends { id: number; name?: string; caption?: string }>(
  items: T[],
  ref: string | number,
  kind: string,
): T {
  if (typeof ref === "number" || /^\d+$/.test(String(ref).trim())) {
    const id = Number(ref);
    const found = items.find((item) => item.id === id);
    if (found) return found;
    if (typeof ref === "number") throw new Error(`${kind} with ID ${id} not found`);
  }
  const matches = items.filter((item) =>
    sameName(item.name ?? item.caption ?? "", String(ref)),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `${kind} name '${ref}' is ambiguous (IDs ${matches.map((m) => m.id).join(", ")}); use the numeric ID`,
    );
  }
  throw new Error(`${kind} '${ref}' not found`);
}

export function findFixture(model: ProjectModel, ref: string | number): FixtureInfo {
  return resolveBy(model.fixtures, ref, "Fixture");
}

export function findFunction(model: ProjectModel, ref: string | number): FunctionInfo {
  return resolveBy(model.functions, ref, "Function");
}

export function findFixtureGroup(model: ProjectModel, ref: string | number): FixtureGroupInfo {
  return resolveBy(model.fixtureGroups, ref, "Fixture group");
}

export function findWidget(model: ProjectModel, ref: string | number): VcWidgetInfo {
  return resolveBy([...model.vcPages, ...model.vcWidgets], ref, "Virtual Console widget");
}

export function findPage(model: ProjectModel, ref: string | number | undefined): VcWidgetInfo {
  if (ref === undefined) {
    const first = model.vcPages[0];
    if (!first) throw new Error("The Virtual Console has no pages");
    return first;
  }
  if (typeof ref === "number" && ref < model.vcPages.length && !model.vcPages.some((p) => p.id === ref)) {
    return model.vcPages[ref];
  }
  return resolveBy(model.vcPages, ref, "Virtual Console page");
}

/* --------------------------------------------------------- ID allocation */

function nextFree(used: Iterable<number>, start = 0): number {
  const set = new Set(used);
  let id = start;
  while (set.has(id) || id === INVALID_ID) id += 1;
  return id;
}

/** Hands out IDs that are free in the model and not handed out before */
export class IdAllocator {
  private readonly fixtures: Set<number>;
  private readonly functions: Set<number>;
  private readonly groups: Set<number>;
  private readonly widgets: Set<number>;

  constructor(model: ProjectModel) {
    this.fixtures = new Set(model.fixtures.map((f) => f.id));
    this.functions = new Set(model.functions.map((f) => f.id));
    this.groups = new Set(model.fixtureGroups.map((g) => g.id));
    this.widgets = new Set(
      [...model.vcPages, ...model.vcWidgets].map((w) => w.id).filter((id) => id !== INVALID_ID),
    );
  }

  private take(set: Set<number>): number {
    // Widgets and functions grow monotonically like QLC+ itself does,
    // so freshly deleted IDs are not immediately reused
    const id = nextFree(set, set.size ? Math.max(...set) + 1 : 0);
    set.add(id);
    return id;
  }

  fixture(): number {
    const id = nextFree(this.fixtures);
    this.fixtures.add(id);
    return id;
  }

  function(): number {
    return this.take(this.functions);
  }

  group(): number {
    const id = nextFree(this.groups);
    this.groups.add(id);
    return id;
  }

  widget(): number {
    return this.take(this.widgets);
  }
}

/** Find a free 0-based DMX address range in a universe */
export function findFreeAddress(
  model: ProjectModel,
  universe: number,
  channels: number,
  reserved: { universe: number; address: number; channels: number }[] = [],
): number | undefined {
  const used = [...model.fixtures, ...reserved]
    .filter((f) => f.universe === universe)
    .map((f) => [f.address, f.address + f.channels - 1] as const)
    .sort((a, b) => a[0] - b[0]);
  let candidate = 0;
  for (const [start, end] of used) {
    if (candidate + channels - 1 < start) break;
    candidate = Math.max(candidate, end + 1);
  }
  return candidate + channels - 1 <= 511 ? candidate : undefined;
}

export function isAddressRangeFree(
  model: ProjectModel,
  universe: number,
  address: number,
  channels: number,
  ignoreFixtureId?: number,
): boolean {
  const end = address + channels - 1;
  if (address < 0 || end > 511) return false;
  return !model.fixtures.some(
    (f) =>
      f.id !== ignoreFixtureId &&
      f.universe === universe &&
      address <= f.address + f.channels - 1 &&
      f.address <= end,
  );
}

export function widgetsReferencingFunction(
  model: ProjectModel,
  functionId: number,
): VcWidgetInfo[] {
  return model.vcWidgets.filter(
    (w) =>
      w.functionId === functionId ||
      w.chaserId === functionId ||
      w.speedDialFunctionIds?.includes(functionId),
  );
}

export function functionsReferencingFunction(
  model: ProjectModel,
  functionId: number,
): FunctionInfo[] {
  return model.functions.filter(
    (f) =>
      f.id !== functionId &&
      (f.steps?.some((s) => s.functionId === functionId) ||
        f.functionIds?.includes(functionId) ||
        f.boundSceneId === functionId ||
        f.tracks?.some((t) => t.items.some((i) => i.functionId === functionId))),
  );
}
