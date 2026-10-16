import { z } from "zod";
import type { ToolDefinition } from "../mcpCompat.js";
import { Action, ButtonActionType, SliderModeCode } from "../qlc/actionCodes.js";
import { parseColor } from "../qlc/color.js";
import { MAX_FRAGMENT_BYTES, widgetExists, widgetGone, type EditSession } from "../qlc/editSession.js";
import { fixtureMode, getFixtureLibrary } from "../qlc/libraryProvider.js";
import { nativeColor, nativeFont, nativeInt, nativeRectF, nativeString } from "../qlc/nativeCodec.js";
import {
  findFixture,
  findFunction,
  findPage,
  findWidget,
  type ProjectModel,
  type VcWidgetInfo,
} from "../qlc/projectModel.js";
import { fontString, GAP, layoutWidgets, PADDING, type UnplacedWidget } from "../qlc/vcLayout.js";
import { widgetXml, type WidgetSpec } from "../qlc/xml/vc.js";
import { renderXml } from "../qlc/xml/xmlWriter.js";
import { commitReport, freshModel, json, newSession, opt, readyClient, Ref, requireFeature, tool } from "./toolkit.js";

export const VC_PAGES_FEATURE = "vcPages";

/* ------------------------------------------------------------ schemas */

const WidgetTypeName = z.enum([
  "frame",
  "soloframe",
  "button",
  "slider",
  "cuelist",
  "speeddial",
  "xypad",
  "label",
  "clock",
  "audiotriggers",
  "animation",
]);

const Appearance = {
  x: opt(z.number().int().min(0)),
  y: opt(z.number().int().min(0)),
  width: opt(z.number().int().min(10).max(4000)),
  height: opt(z.number().int().min(10).max(4000)),
  backgroundColor: opt(z.string()).describe("#RRGGBB or color name"),
  foregroundColor: opt(z.string()).describe("Text color"),
  fontSize: opt(z.number().int().min(6).max(96)),
  bold: opt(z.boolean()),
  fontFamily: opt(z.string()),
};

interface WidgetInput {
  type: z.infer<typeof WidgetTypeName>;
  caption?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  foregroundColor?: string;
  fontSize?: number;
  bold?: boolean;
  fontFamily?: string;
  key?: string;
  page?: number;
  function?: string | number;
  action?: "toggle" | "flash" | "blackout" | "stopall";
  intensity?: number;
  mode?: "level" | "adjust" | "submaster" | "grandmaster";
  attribute?: number;
  fixtures?: (string | number)[];
  channelRole?: string;
  channels?: { fixture: string | number; channel: string | number }[];
  low?: number;
  high?: number;
  style?: "slider" | "knob";
  valueDisplay?: "exact" | "percentage";
  inverted?: boolean;
  chaser?: string | number;
  sideFader?: "none" | "crossfade" | "steps";
  functions?: (string | number)[];
  clockType?: "clock" | "stopwatch" | "countdown";
  targetTime?: string;
  children?: WidgetInput[];
  columns?: number;
  showHeader?: boolean;
  pages?: number;
  collapsed?: boolean;
  mixing?: boolean;
}

const WidgetSchema: z.ZodType<WidgetInput> = z.lazy(() =>
  z.object({
    type: WidgetTypeName,
    caption: opt(z.string()),
    ...Appearance,
    key: opt(z.string()).describe("Keyboard shortcut, e.g. 'Q' or 'Ctrl+1'"),
    page: opt(z.number().int().min(0)).describe("Page index inside a multipage parent frame"),
    function: opt(Ref).describe("button/animation: function to run; slider: function whose intensity it controls"),
    action: opt(z.enum(["toggle", "flash", "blackout", "stopall"])).describe("button action (default toggle)"),
    intensity: opt(z.number().min(0).max(100)).describe("button: startup intensity %"),
    mode: opt(z.enum(["level", "adjust", "submaster", "grandmaster"])).describe(
      "slider: level = drives channels, adjust = drives a function's intensity, submaster = scales its frame",
    ),
    attribute: opt(z.number().int().min(0)).describe("slider adjust: function attribute index (0 = intensity)"),
    fixtures: opt(z.array(Ref)).describe("slider level: fixtures whose channels of `channelRole` it drives; xypad: fixtures it moves"),
    channelRole: opt(z.string()).describe("slider level: channel role to drive (default 'dimmer'), e.g. red, white, pan"),
    channels: opt(z.array(z.object({ fixture: Ref, channel: z.union([z.string(), z.number().int().min(0)]) }))).describe(
      "slider level: explicit channels (name or 0-based index)",
    ),
    low: opt(z.number().int().min(0).max(255)),
    high: opt(z.number().int().min(0).max(255)),
    style: opt(z.enum(["slider", "knob"])),
    valueDisplay: opt(z.enum(["exact", "percentage"])),
    inverted: opt(z.boolean()),
    chaser: opt(Ref).describe("cuelist: chaser or sequence it plays"),
    sideFader: opt(z.enum(["none", "crossfade", "steps"])),
    functions: opt(z.array(Ref)).describe("speeddial: functions whose speed it sets"),
    clockType: opt(z.enum(["clock", "stopwatch", "countdown"])),
    targetTime: opt(z.string()).describe("countdown: HH:mm:ss"),
    children: opt(z.array(WidgetSchema)).describe("frame/soloframe: widgets inside"),
    columns: opt(z.number().int().min(1).max(50)).describe("frame: wrap children after this many per row"),
    showHeader: opt(z.boolean()),
    pages: opt(z.number().int().min(1).max(100)).describe("frame: number of pages (multipage)"),
    collapsed: opt(z.boolean()),
    mixing: opt(z.boolean()).describe("soloframe: allow functions to mix"),
  }),
) as z.ZodType<WidgetInput>;

/* ------------------------------------------------------- resolution */

async function resolveWidget(model: ProjectModel, input: WidgetInput): Promise<UnplacedWidget> {
  const common = {
    caption: input.caption ?? "",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    page: input.page,
    key: input.key,
    backgroundColor: input.backgroundColor ? parseColor(input.backgroundColor) : undefined,
    foregroundColor: input.foregroundColor ? parseColor(input.foregroundColor) : undefined,
    font:
      input.fontSize || input.bold || input.fontFamily
        ? fontString(input.fontFamily, input.fontSize ?? 12, input.bold)
        : undefined,
  };
  const fnId = (ref?: string | number) => (ref === undefined ? undefined : findFunction(model, ref).id);

  switch (input.type) {
    case "frame":
    case "soloframe":
      return {
        ...common,
        type: input.type,
        showHeader: input.showHeader,
        pages: input.pages,
        collapsed: input.collapsed,
        mixing: input.mixing,
        columns: input.columns,
        children: await Promise.all((input.children ?? []).map((child) => resolveWidget(model, child))),
      };
    case "button":
      return { ...common, type: "button", functionId: fnId(input.function), action: input.action, intensity: input.intensity };
    case "slider": {
      const channels: { fixtureId: number; channel: number }[] = [];
      if (input.fixtures?.length) {
        const role = (input.channelRole ?? "dimmer").toLowerCase();
        const library = getFixtureLibrary(readyClient());
        for (const ref of input.fixtures) {
          const fixture = findFixture(model, ref);
          const { mode } = await fixtureMode(library, fixture);
          let indexes = mode.channels
            .map((ch, index) => ({ ch, index }))
            .filter(({ ch }) => !ch.fine && (ch.role === role || (role === "dimmer" && ch.role === "master_dimmer")));
          if (role === "dimmer" && indexes.some(({ ch }) => ch.role === "master_dimmer")) {
            indexes = indexes.filter(({ ch }) => ch.role === "master_dimmer");
          }
          if (!indexes.length) throw new Error(`Fixture '${fixture.name}' has no '${role}' channel`);
          indexes.forEach(({ index }) => channels.push({ fixtureId: fixture.id, channel: index }));
        }
      }
      for (const ch of input.channels ?? []) {
        const fixture = findFixture(model, ch.fixture);
        let index: number;
        if (typeof ch.channel === "number" || /^\d+$/.test(ch.channel)) {
          index = Number(ch.channel);
        } else {
          const { mode } = await fixtureMode(getFixtureLibrary(readyClient()), fixture);
          index = mode.channels.findIndex((c) => c.name.toLowerCase() === String(ch.channel).toLowerCase());
          if (index < 0) throw new Error(`Fixture '${fixture.name}' has no channel '${ch.channel}'`);
        }
        if (index >= fixture.channels) throw new Error(`Fixture '${fixture.name}' has only ${fixture.channels} channels`);
        channels.push({ fixtureId: fixture.id, channel: index });
      }
      const functionId = fnId(input.function);
      const mode = input.mode ?? (functionId !== undefined ? "adjust" : channels.length ? "level" : "submaster");
      if (mode === "level" && !channels.length) throw new Error(`Level slider '${common.caption}' needs fixtures or channels`);
      if (mode === "adjust" && functionId === undefined) throw new Error(`Adjust slider '${common.caption}' needs a function`);
      return {
        ...common,
        type: "slider",
        mode,
        functionId,
        attribute: input.attribute,
        channels,
        low: input.low,
        high: input.high,
        style: input.style,
        valueDisplay: input.valueDisplay,
        inverted: input.inverted,
      };
    }
    case "cuelist":
      return { ...common, type: "cuelist", chaserId: fnId(input.chaser), sideFader: input.sideFader };
    case "speeddial":
      return { ...common, type: "speeddial", functions: (input.functions ?? []).map((ref) => ({ functionId: fnId(ref)! })) };
    case "xypad":
      return {
        ...common,
        type: "xypad",
        fixtures: (input.fixtures ?? []).map((ref) => ({ fixtureId: findFixture(model, ref).id })),
        inverted: input.inverted,
      };
    case "clock":
      return { ...common, type: "clock", clockType: input.clockType, targetTime: input.targetTime };
    case "animation":
      return { ...common, type: "animation", functionId: fnId(input.function) };
    case "label":
    case "audiotriggers":
      return { ...common, type: input.type };
  }
}

function assignIds(session: EditSession, widget: WidgetSpec): void {
  widget.id ??= session.ids.widget();
  if (widget.type === "frame" || widget.type === "soloframe") widget.children.forEach((c) => assignIds(session, c));
}

/** Queue creation of a widget tree, splitting frames whose XML is too large for one packet */
function queueCreate(session: EditSession, parentId: number, widget: WidgetSpec, created: { id: number; type: string; caption: string }[]): void {
  const xml = renderXml(widgetXml(widget));
  const isFrame = widget.type === "frame" || widget.type === "soloframe";
  if (Buffer.byteLength(xml) > MAX_FRAGMENT_BYTES && isFrame) {
    session.addXml(Action.VCWidgetCreate, parentId, widgetXml({ ...widget, children: [] }), `create ${widget.type} '${widget.caption}'`);
    created.push({ id: widget.id!, type: widget.type, caption: widget.caption });
    widget.children.forEach((child) => queueCreate(session, widget.id!, child, created));
    return;
  }
  session.addXml(Action.VCWidgetCreate, parentId, widgetXml(widget), `create ${widget.type} '${widget.caption}'`);
  const collect = (w: WidgetSpec) => {
    created.push({ id: w.id!, type: w.type, caption: w.caption });
    if (w.type === "frame" || w.type === "soloframe") w.children.forEach(collect);
  };
  collect(widget);
}

function container(model: ProjectModel, page?: string | number, parent?: string | number): VcWidgetInfo {
  if (parent !== undefined) {
    const target = findWidget(model, parent);
    if (!["page", "frame", "soloframe"].includes(target.type)) {
      throw new Error(`'${target.caption}' is a ${target.type}; widgets can only be placed in pages and frames`);
    }
    return target;
  }
  return findPage(model, page);
}

function childrenOf(model: ProjectModel, id: number): VcWidgetInfo[] {
  return model.vcWidgets.filter((w) => w.parentId === id);
}

function treeOf(model: ProjectModel, widget: VcWidgetInfo): unknown {
  const fnName = (id?: number) => (id === undefined ? undefined : model.functions.find((f) => f.id === id)?.name ?? id);
  return {
    id: widget.id,
    type: widget.type,
    caption: widget.caption || undefined,
    geometry: `${widget.x},${widget.y} ${widget.width}x${widget.height}`,
    page: widget.page || undefined,
    function: fnName(widget.functionId),
    action: widget.type === "button" ? widget.action : undefined,
    sliderMode: widget.sliderMode,
    channels: widget.levelChannels?.length ? widget.levelChannels.length : undefined,
    chaser: fnName(widget.chaserId),
    pages: widget.pages && widget.pages > 1 ? widget.pages : undefined,
    children: widget.childIds.length
      ? widget.childIds
          .map((id) => model.vcWidgets.find((w) => w.id === id))
          .filter((w): w is VcWidgetInfo => Boolean(w))
          .map((w) => treeOf(model, w))
      : undefined,
  };
}

/* -------------------------------------------------------------- tools */

export function createVcTools(): ToolDefinition[] {
  return [
    tool(
      "qlc_vc_tree",
      "Show the Virtual Console as a tree: pages, frames and widgets with IDs, captions, geometry (x,y widthxheight) and the functions they control.",
      z.object({ page: opt(Ref).describe("Only this page (ID, index or caption)") }),
      async ({ page }) => {
        const model = await freshModel(readyClient());
        const pages = page === undefined ? model.vcPages : [findPage(model, page)];
        return json(pages.map((p) => treeOf(model, p)));
      },
    ),

    tool(
      "qlc_vc_build",
      "Build Virtual Console widgets from a declarative tree, in one transaction. Frames hold children; anything without x/y is laid out automatically in rows (use `columns` on a frame for grids). Buttons start functions, sliders drive channels (level), a function's intensity (adjust) or their frame (submaster), cue lists play chasers, speed dials set function speeds, XY pads move fixtures. Use `clear` to rebuild a page or frame from scratch.",
      z.object({
        page: opt(Ref).describe("Target page (default: first page)"),
        parent: opt(Ref).describe("Existing frame to build into, instead of a page"),
        clear: opt(z.boolean()).describe("Delete the current content of the target first"),
        columns: opt(z.number().int().min(1).max(50)).describe("Wrap top-level widgets after this many per row"),
        maxWidth: opt(z.number().int().min(200).max(8000)).describe("Width available for automatic layout (default 1200)"),
        widgets: z.array(WidgetSchema).min(1),
      }),
      async (input) => {
        const session = await newSession();
        const target = container(session.model, input.page, input.parent);
        const existing = childrenOf(session.model, target.id);
        if (input.clear) {
          for (const w of existing) {
            session.deleteWidget(w.id);
            session.verify(widgetGone(w.id));
          }
        }
        const resolved = await Promise.all(input.widgets.map((w) => resolveWidget(session.model, w)));
        const top = target.type === "page" ? PADDING : 45;
        const occupied = input.clear ? top : Math.max(top, ...existing.map((w) => w.y + w.height + GAP));
        const placed = layoutWidgets(resolved, {
          originY: occupied,
          maxWidth: input.maxWidth ?? (target.type === "page" ? 1200 : Math.max(200, target.width - 2 * PADDING)),
          columns: input.columns,
        });
        const created: { id: number; type: string; caption: string }[] = [];
        for (const widget of placed) {
          assignIds(session, widget);
          queueCreate(session, target.id, widget, created);
        }
        for (const w of created) session.verify(widgetExists(w.id));
        return commitReport(await session.commit(), `Built ${created.length} widget(s) in '${target.caption}'`, {
          widgets: created,
        });
      },
    ),

    tool(
      "qlc_vc_widget_update",
      "Change an existing widget: caption, position/size, colors, font, and its binding (button function and action, slider function and mode, cue list chaser).",
      z.object({
        widget: Ref.describe("Widget ID (preferred) or exact caption"),
        caption: opt(z.string()),
        ...Appearance,
        function: opt(Ref).describe("button/slider: new function"),
        action: opt(z.enum(["toggle", "flash", "blackout", "stopall"])),
        sliderMode: opt(z.enum(["level", "adjust", "submaster", "grandmaster"])),
        chaser: opt(Ref).describe("cuelist: new chaser"),
      }),
      async (input) => {
        const session = await newSession();
        const w = findWidget(session.model, input.widget);
        const id = w.id;
        if (input.caption !== undefined) session.add(Action.VCWidgetCaption, id, [nativeString(input.caption)], "caption");
        if ([input.x, input.y, input.width, input.height].some((v) => v !== undefined)) {
          session.add(
            Action.VCWidgetGeometry,
            id,
            [nativeRectF(input.x ?? w.x, input.y ?? w.y, input.width ?? w.width, input.height ?? w.height)],
            "geometry",
          );
        }
        if (input.backgroundColor) session.add(Action.VCWidgetBackgroundColor, id, [nativeColor(parseColor(input.backgroundColor))], "background");
        if (input.foregroundColor) session.add(Action.VCWidgetForegroundColor, id, [nativeColor(parseColor(input.foregroundColor))], "foreground");
        if (input.fontSize || input.bold !== undefined || input.fontFamily) {
          session.add(Action.VCWidgetFont, id, [nativeFont(fontString(input.fontFamily, input.fontSize ?? 12, input.bold))], "font");
        }
        if (input.function !== undefined) {
          const fn = findFunction(session.model, input.function);
          if (w.type === "button") session.add(Action.VCButtonSetFunctionID, id, [nativeInt(fn.id)], "button function");
          else if (w.type === "slider") session.add(Action.VCSliderSetFunctionID, id, [nativeInt(fn.id)], "slider function");
          else throw new Error(`A ${w.type} has no function binding to change here`);
        }
        if (input.action) {
          if (w.type !== "button") throw new Error("Only buttons have an action");
          const map = { toggle: ButtonActionType.Toggle, flash: ButtonActionType.Flash, blackout: ButtonActionType.Blackout, stopall: ButtonActionType.StopAll };
          session.add(Action.VCButtonSetActionType, id, [nativeInt(map[input.action])], "button action");
        }
        if (input.sliderMode) {
          if (w.type !== "slider") throw new Error("Only sliders have a mode");
          const map = { level: SliderModeCode.Level, adjust: SliderModeCode.Adjust, submaster: SliderModeCode.Submaster, grandmaster: SliderModeCode.GrandMaster };
          session.add(Action.VCSliderSetMode, id, [nativeInt(map[input.sliderMode])], "slider mode");
        }
        if (input.chaser !== undefined) {
          if (w.type !== "cuelist") throw new Error("Only cue lists play a chaser");
          session.add(Action.VCCueListSetChaserID, id, [nativeInt(findFunction(session.model, input.chaser).id)], "cue list chaser");
        }
        if (!session.size) throw new Error("Nothing to change");
        session.verify((model) => {
          const now = [...model.vcPages, ...model.vcWidgets].find((x) => x.id === id);
          if (!now) return "widget disappeared";
          if (input.caption !== undefined && now.caption !== input.caption) return `caption is still '${now.caption}'`;
          return undefined;
        });
        return commitReport(await session.commit(), `Updated ${w.type} '${w.caption}'`);
      },
    ),

    tool(
      "qlc_vc_widget_delete",
      "Delete Virtual Console widgets (frames are deleted with their content).",
      z.object({ widgets: z.array(Ref).min(1) }),
      async ({ widgets }) => {
        const session = await newSession();
        const targets = widgets.map((ref) => findWidget(session.model, ref));
        for (const w of targets) {
          if (w.type === "page") throw new Error(`'${w.caption}' is a page, not a widget`);
          session.deleteWidget(w.id);
          session.verify(widgetGone(w.id));
        }
        return commitReport(await session.commit(), `Deleted ${targets.length} widget(s)`);
      },
    ),

    tool(
      "qlc_vc_widget_move",
      "Move a widget into another frame or page, optionally at a given position.",
      z.object({
        widget: Ref,
        parent: Ref.describe("Destination frame or page"),
        x: opt(z.number().int().min(0)),
        y: opt(z.number().int().min(0)),
      }),
      async ({ widget, parent, x, y }) => {
        const session = await newSession();
        const w = findWidget(session.model, widget);
        const target = container(session.model, undefined, parent);
        if (target.id !== w.parentId) session.add(Action.VCWidgetReparent, w.id, [nativeInt(target.id)], "reparent");
        if (x !== undefined || y !== undefined) {
          session.add(Action.VCWidgetGeometry, w.id, [nativeRectF(x ?? w.x, y ?? w.y, w.width, w.height)], "position");
        }
        session.verify((model) => {
          const now = model.vcWidgets.find((v) => v.id === w.id);
          return now?.parentId === target.id ? undefined : "widget was not moved";
        });
        return commitReport(await session.commit(), `Moved '${w.caption}' to '${target.caption}'`);
      },
    ),

    tool(
      "qlc_vc_page_rename",
      "Rename a Virtual Console page.",
      z.object({ page: Ref, caption: z.string().min(1) }),
      async ({ page, caption }) => {
        const session = await newSession();
        const p = findPage(session.model, page);
        session.add(Action.VCWidgetCaption, p.id, [nativeString(caption)], "rename page");
        session.verify((model) => (model.vcPages.find((x) => x.id === p.id)?.caption === caption ? undefined : "page was not renamed"));
        return commitReport(await session.commit(), `Renamed page to '${caption}'`);
      },
    ),

    tool(
      "qlc_vc_page_add",
      "Add a Virtual Console page (requires the QLC+ fork).",
      z.object({ caption: opt(z.string()) }),
      async ({ caption }) => {
        const client = readyClient();
        requireFeature(client, VC_PAGES_FEATURE, "Adding pages");
        const result = await client.request(Action.NetVCPageAdd, { caption });
        await client.refreshProject();
        return json(result, "Page added");
      },
    ),

    tool(
      "qlc_vc_page_remove",
      "Remove a Virtual Console page and everything on it (requires the QLC+ fork).",
      z.object({ page: Ref }),
      async ({ page }) => {
        const client = readyClient();
        requireFeature(client, VC_PAGES_FEATURE, "Removing pages");
        const model = await freshModel(client);
        const index = model.vcPages.indexOf(findPage(model, page));
        const result = await client.request(Action.NetVCPageRemove, { index });
        await client.refreshProject();
        return json(result, "Page removed");
      },
    ),
  ];
}
