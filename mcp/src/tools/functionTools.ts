import { z } from "zod";
import type { ToolDefinition } from "../mcpCompat.js";
import { Action, Direction, RunOrder } from "../qlc/actionCodes.js";
import { parseColor } from "../qlc/color.js";
import { functionExists, functionGone, type EditSession } from "../qlc/editSession.js";
import { queueFunctionReplace, queueSceneUpdate, queueSpeed } from "../qlc/functionOps.js";
import { fixtureMode, getFixtureLibrary } from "../qlc/libraryProvider.js";
import { nativeInt, nativeString } from "../qlc/nativeCodec.js";
import {
  findFixture,
  findFixtureGroup,
  findFunction,
  functionsReferencingFunction,
  widgetsReferencingFunction,
  type FunctionInfo,
  type ProjectModel,
} from "../qlc/projectModel.js";
import { composeFixtureValues, type FixtureLook } from "../qlc/sceneComposer.js";
import {
  audioXml,
  chaserXml,
  collectionXml,
  EFX_ALGORITHMS,
  efxXml,
  rgbMatrixXml,
  sceneXml,
  scriptXml,
  sequenceXml,
  showXml,
  videoXml,
  type SceneChannelValue,
  type SpeedSpec,
} from "../qlc/xml/functions.js";
import type { XmlNode } from "../qlc/xml/xmlWriter.js";
import { commitReport, Dmx, freshModel, json, Millis, newSession, opt, Percent, readyClient, Ref, tool } from "./toolkit.js";

/* ------------------------------------------------------------ schemas */

const RunOrderName = z.enum(["Loop", "SingleShot", "PingPong", "Random"]);
const DirectionName = z.enum(["Forward", "Backward"]);

const Common = {
  name: z.string().min(1).describe("Function name"),
  replace: opt(Ref).describe(
    "Existing function to overwrite. Its ID is kept and buttons, cue lists, chasers and collections using it keep working.",
  ),
  path: opt(z.string()).describe("Folder in the QLC+ function tree, e.g. 'Colors/Warm'"),
  fadeIn: opt(Millis),
  fadeOut: opt(Millis),
  duration: opt(Millis).describe("Hold/duration in ms; for chasers the common step duration"),
};

export const LookSchema = z.object({
  fixtures: opt(z.array(Ref)).describe("Fixtures this look applies to"),
  group: opt(Ref).describe("Apply to every fixture of this fixture group"),
  dimmer: opt(Percent).describe("Intensity 0-100%"),
  color: opt(z.string()).describe("Color: #RRGGBB, rgb(r,g,b) or a name (red, azul, amber, warm white...)"),
  white: opt(Percent),
  amber: opt(Percent),
  uv: opt(Percent),
  pan: opt(Percent).describe("0-100, 50 = center"),
  tilt: opt(Percent).describe("0-100, 50 = center"),
  strobe: opt(Percent).describe("Strobe speed 1-100, 0 = off"),
  shutter: opt(z.enum(["open", "closed"])),
  gobo: opt(z.string()).describe("Part of the gobo name, e.g. 'star'"),
  zoom: opt(Percent),
  focus: opt(Percent),
  channels: opt(z.record(z.string(), Dmx)).describe(
    "Raw DMX values by channel name or 0-based index; applied last",
  ),
});
type LookInput = z.infer<typeof LookSchema>;

/* ------------------------------------------------------------ helpers */

function speedOf(input: { fadeIn?: number; fadeOut?: number; duration?: number }): SpeedSpec | undefined {
  if (input.fadeIn === undefined && input.fadeOut === undefined && input.duration === undefined) return undefined;
  return { fadeIn: input.fadeIn, fadeOut: input.fadeOut, duration: input.duration };
}

function lookFixtureIds(model: ProjectModel, look: LookInput): number[] {
  const ids = (look.fixtures ?? []).map((ref) => findFixture(model, ref).id);
  if (look.group !== undefined) {
    for (const head of findFixtureGroup(model, look.group).heads) {
      if (!ids.includes(head.fixtureId)) ids.push(head.fixtureId);
    }
  }
  if (!ids.length) throw new Error("Each look needs 'fixtures' or 'group'");
  return ids;
}

/** Turn looks into per-fixture channel values, later looks overriding earlier ones */
async function composeLooks(
  model: ProjectModel,
  looks: LookInput[],
): Promise<{ fixtures: { fixtureId: number; values: SceneChannelValue[] }[]; warnings: string[] }> {
  const library = getFixtureLibrary(readyClient());
  const perFixture = new Map<number, Map<number, number>>();
  const warnings: string[] = [];
  for (const look of looks) {
    const { fixtures: _f, group: _g, ...spec } = look;
    for (const fixtureId of lookFixtureIds(model, look)) {
      const fixture = model.fixtures.find((f) => f.id === fixtureId)!;
      const { mode, known } = await fixtureMode(library, fixture);
      if (!known && Object.keys(spec).some((k) => k !== "channels")) {
        warnings.push(
          `${fixture.name}: definition '${fixture.manufacturer} ${fixture.model}' not found locally, only raw 'channels' can be applied`,
        );
      }
      const composed = composeFixtureValues(mode, spec as FixtureLook);
      composed.warnings.forEach((w) => warnings.push(`${fixture.name}: ${w}`));
      const values = perFixture.get(fixtureId) ?? new Map<number, number>();
      composed.values.forEach((v) => values.set(v.channel, v.value));
      perFixture.set(fixtureId, values);
    }
  }
  return {
    fixtures: [...perFixture.entries()].map(([fixtureId, values]) => ({
      fixtureId,
      values: [...values.entries()].map(([channel, value]) => ({ channel, value })),
    })),
    warnings: [...new Set(warnings)],
  };
}

/** Create a new function or replace an existing one, keeping its ID */
function queueUpsert(
  session: EditSession,
  replace: string | number | undefined,
  type: string,
  build: (id: number) => XmlNode,
): { id: number; notes: string[]; replaced: boolean } {
  if (replace !== undefined) {
    const current = findFunction(session.model, replace);
    if (current.type !== type) {
      throw new Error(`'${current.name}' is a ${current.type}; it cannot be replaced by a ${type}`);
    }
    return { id: current.id, notes: queueFunctionReplace(session, session.model, current, build(current.id), type), replaced: true };
  }
  const id = session.ids.function();
  session.addXml(Action.FunctionCreate, id, build(id), `create ${type} ${id}`);
  session.verify(functionExists(id, type));
  return { id, notes: [], replaced: false };
}

function summarize(fn: FunctionInfo, model: ProjectModel) {
  const name = (id?: number) => model.functions.find((f) => f.id === id)?.name;
  const base = { id: fn.id, type: fn.type, name: fn.name, path: fn.path };
  switch (fn.type) {
    case "Scene":
      return { ...base, fixtures: fn.sceneFixtures?.length ?? 0, values: fn.values?.length ?? 0 };
    case "Chaser":
      return { ...base, steps: fn.steps?.map((s) => name(s.functionId) ?? s.functionId) };
    case "Sequence":
      return { ...base, boundScene: fn.boundSceneId, steps: fn.steps?.length };
    case "Collection":
      return { ...base, functions: fn.functionIds?.map((id) => name(id) ?? id) };
    case "Show":
      return { ...base, tracks: fn.tracks?.map((t) => `${t.name} (${t.items.length} items)`) };
    case "EFX":
      return { ...base, algorithm: fn.algorithm, fixtures: fn.efxFixtures?.length };
    case "RGBMatrix":
      return { ...base, algorithm: fn.algorithm, group: fn.fixtureGroupId };
    default:
      return base;
  }
}

function report(
  result: Awaited<ReturnType<EditSession["commit"]>>,
  what: string,
  upsert: { id: number; notes: string[]; replaced: boolean },
  warnings: string[] = [],
) {
  return commitReport(result, `${upsert.replaced ? "Replaced" : "Created"} ${what}`, {
    functionId: upsert.id,
    warnings: [...warnings, ...upsert.notes].length ? [...warnings, ...upsert.notes] : undefined,
  });
}

/* -------------------------------------------------------------- tools */

export function createFunctionTools(): ToolDefinition[] {
  return [
    tool(
      "qlc_function_list",
      "List the functions of the project (scenes, chasers, sequences, EFX, RGB matrices, collections, shows, scripts, audio, video) with a short summary of each.",
      z.object({
        type: opt(z.enum(["Scene", "Chaser", "Sequence", "EFX", "RGBMatrix", "Collection", "Show", "Script", "Audio", "Video"])),
        query: opt(z.string()).describe("Case-insensitive part of the name"),
      }),
      async ({ type, query }) => {
        const model = await freshModel(readyClient());
        const q = query?.toLowerCase();
        const list = model.functions
          .filter((f) => !type || f.type === type)
          .filter((f) => !q || f.name.toLowerCase().includes(q))
          .map((f) => summarize(f, model));
        return json(list, `${list.length} functions`);
      },
    ),

    tool(
      "qlc_function_get",
      "Full detail of one function: values, steps, timings, and which widgets and functions use it.",
      z.object({ function: Ref }),
      async ({ function: ref }) => {
        const model = await freshModel(readyClient());
        const fn = findFunction(model, ref);
        return json({
          ...fn,
          usedByWidgets: widgetsReferencingFunction(model, fn.id).map((w) => ({ id: w.id, type: w.type, caption: w.caption })),
          usedByFunctions: functionsReferencingFunction(model, fn.id).map((f) => ({ id: f.id, type: f.type, name: f.name })),
        });
      },
    ),

    tool(
      "qlc_function_delete",
      "Delete functions. QLC+ also removes them from chasers, collections and cue lists that use them.",
      z.object({ functions: z.array(Ref).min(1) }),
      async ({ functions }) => {
        const session = await newSession();
        const targets = functions.map((ref) => findFunction(session.model, ref));
        const affected = targets.flatMap((fn) => [
          ...functionsReferencingFunction(session.model, fn.id).map((f) => `${f.type} '${f.name}'`),
          ...widgetsReferencingFunction(session.model, fn.id).map((w) => `${w.type} '${w.caption}'`),
        ]);
        for (const fn of targets) {
          session.deleteFunction(fn.id);
          session.verify(functionGone(fn.id));
        }
        return commitReport(await session.commit(), `Deleted ${targets.length} function(s)`, {
          affected: affected.length ? [...new Set(affected)] : undefined,
        });
      },
    ),

    tool(
      "qlc_function_update",
      "Change common properties of a function without rebuilding it: name, folder, fade in/out, duration, run order, direction.",
      z.object({
        function: Ref,
        name: opt(z.string().min(1)),
        path: opt(z.string()),
        fadeIn: opt(Millis),
        fadeOut: opt(Millis),
        duration: opt(Millis),
        runOrder: opt(RunOrderName),
        direction: opt(DirectionName),
      }),
      async (input) => {
        const session = await newSession();
        const fn = findFunction(session.model, input.function);
        if (input.name) session.add(Action.FunctionSetName, fn.id, [nativeString(input.name)], "rename");
        if (input.path !== undefined) session.add(Action.FunctionSetPath, fn.id, [nativeString(input.path)], "set path");
        queueSpeed(session, fn, speedOf(input));
        if (input.runOrder) session.add(Action.FunctionSetRunOrder, fn.id, [nativeInt(RunOrder[input.runOrder])], "run order");
        if (input.direction) session.add(Action.FunctionSetDirection, fn.id, [nativeInt(Direction[input.direction])], "direction");
        session.verify((model) => {
          const now = model.functions.find((f) => f.id === fn.id);
          if (!now) return "function disappeared";
          if (input.name && now.name !== input.name) return `name is still '${now.name}'`;
          if (input.runOrder && now.runOrder && now.runOrder !== input.runOrder) return `run order is still ${now.runOrder}`;
          return undefined;
        });
        return commitReport(await session.commit(), `Updated ${fn.type} '${fn.name}'`);
      },
    ),

    tool(
      "qlc_scene_set",
      "Create a scene, or overwrite one with `replace`, from looks: each look targets fixtures (or a fixture group) and sets dimmer, color, white/amber/UV, pan/tilt, strobe, shutter, gobo, zoom/focus or raw channels. Values are derived from each fixture's definition, so 'color: red' works for RGB, CMY and color-wheel fixtures alike. Later looks override earlier ones.",
      z.object({
        ...Common,
        looks: z.array(LookSchema).min(1),
      }),
      async (input) => {
        const session = await newSession();
        const { fixtures, warnings } = await composeLooks(session.model, input.looks);
        const speed = speedOf(input);
        if (input.replace !== undefined) {
          const current = findFunction(session.model, input.replace);
          if (current.type !== "Scene") throw new Error(`'${current.name}' is a ${current.type}, not a Scene`);
          queueSceneUpdate(session, current, { name: input.name, speed, fixtures });
          if (input.path !== undefined && input.path !== (current.path ?? "")) {
            session.add(Action.FunctionSetPath, current.id, [nativeString(input.path)], "set path");
          }
          return report(await session.commit(), `scene '${input.name}'`, { id: current.id, notes: [], replaced: true }, warnings);
        }
        const upsert = queueUpsert(session, undefined, "Scene", (id) =>
          sceneXml({ id, name: input.name, path: input.path, speed, fixtures }),
        );
        return report(await session.commit(), `scene '${input.name}'`, upsert, warnings);
      },
    ),

    tool(
      "qlc_chaser_set",
      "Create or overwrite (`replace`) a chaser: an ordered list of functions played one after another. Step times are used when given (per-step mode); otherwise the chaser's common fadeIn/fadeOut/duration apply to every step.",
      z.object({
        ...Common,
        steps: z
          .array(
            z.object({
              function: Ref,
              fadeIn: opt(Millis),
              hold: opt(Millis),
              fadeOut: opt(Millis),
              note: opt(z.string()),
            }),
          )
          .min(1),
        runOrder: opt(RunOrderName),
        direction: opt(DirectionName),
      }),
      async (input) => {
        const session = await newSession();
        const perStep = input.steps.some((s) => s.fadeIn !== undefined || s.hold !== undefined || s.fadeOut !== undefined);
        const steps = input.steps.map((s) => ({
          functionId: findFunction(session.model, s.function).id,
          fadeIn: s.fadeIn ?? input.fadeIn ?? 0,
          hold: s.hold ?? input.duration ?? 0,
          fadeOut: s.fadeOut ?? input.fadeOut ?? 0,
          note: s.note,
        }));
        const upsert = queueUpsert(session, input.replace, "Chaser", (id) =>
          chaserXml({
            id,
            name: input.name,
            path: input.path,
            speed: speedOf(input) ?? { duration: 1000 },
            runOrder: input.runOrder,
            direction: input.direction,
            speedModes: perStep
              ? { fadeIn: "PerStep", fadeOut: "PerStep", duration: "PerStep" }
              : { fadeIn: "Common", fadeOut: "Common", duration: "Common" },
            steps,
          }),
        );
        return report(await session.commit(), `chaser '${input.name}' with ${steps.length} steps`, upsert);
      },
    ),

    tool(
      "qlc_sequence_set",
      "Create or overwrite (`replace`) a sequence: a chaser whose steps are channel snapshots of a fixed set of fixtures (stored in a hidden bound scene). Each step is a list of looks over those fixtures.",
      z.object({
        ...Common,
        fixtures: z.array(Ref).min(1).describe("All fixtures the sequence controls"),
        steps: z
          .array(
            z.object({
              looks: z.array(LookSchema).min(1),
              fadeIn: opt(Millis),
              hold: opt(Millis),
              fadeOut: opt(Millis),
              note: opt(z.string()),
            }),
          )
          .min(1),
        runOrder: opt(RunOrderName),
        direction: opt(DirectionName),
      }),
      async (input) => {
        const session = await newSession();
        const fixtureIds = input.fixtures.map((ref) => findFixture(session.model, ref).id);
        const warnings: string[] = [];
        const steps: ((typeof input.steps)[number] & {
          values: { fixtureId: number; channel: number; value: number }[];
        })[] = [];
        for (const step of input.steps) {
          const composed = await composeLooks(session.model, step.looks);
          warnings.push(...composed.warnings);
          for (const f of composed.fixtures) {
            if (!fixtureIds.includes(f.fixtureId)) {
              throw new Error(`Step uses fixture ${f.fixtureId}, which is not in the sequence 'fixtures' list`);
            }
          }
          steps.push({ ...step, values: composed.fixtures.flatMap((f) => f.values.map((v) => ({ fixtureId: f.fixtureId, ...v }))) });
        }
        // The bound scene holds every channel any step touches, at zero
        const channels = new Map<string, { fixtureId: number; channel: number; value: number }>();
        for (const step of steps) for (const v of step.values) channels.set(`${v.fixtureId}:${v.channel}`, { ...v, value: 0 });
        const sceneFixtures = fixtureIds.map((fixtureId) => ({
          fixtureId,
          values: [...channels.values()].filter((v) => v.fixtureId === fixtureId).map(({ channel }) => ({ channel, value: 0 })),
        }));

        let boundSceneId: number;
        const existing = input.replace !== undefined ? findFunction(session.model, input.replace) : undefined;
        if (existing?.boundSceneId !== undefined) {
          boundSceneId = existing.boundSceneId;
          const scene = session.model.functions.find((f) => f.id === boundSceneId);
          if (scene) queueSceneUpdate(session, scene, { name: scene.name, fixtures: sceneFixtures });
        } else {
          boundSceneId = session.ids.function();
          session.addXml(
            Action.FunctionCreate,
            boundSceneId,
            sceneXml({ id: boundSceneId, name: `${input.name} (bound scene)`, hidden: true, fixtures: sceneFixtures }),
            "create bound scene",
          );
          session.verify(functionExists(boundSceneId, "Scene"));
        }
        const upsert = queueUpsert(session, input.replace, "Sequence", (id) =>
          sequenceXml({
            id,
            name: input.name,
            path: input.path,
            boundSceneId,
            boundSceneChannelCount: channels.size,
            speed: speedOf(input),
            runOrder: input.runOrder,
            direction: input.direction,
            speedModes: { fadeIn: "PerStep", fadeOut: "PerStep", duration: "PerStep" },
            steps: steps.map((s) => ({
              fadeIn: s.fadeIn ?? input.fadeIn ?? 0,
              hold: s.hold ?? input.duration ?? 1000,
              fadeOut: s.fadeOut ?? input.fadeOut ?? 0,
              note: s.note,
              values: s.values,
            })),
          }),
        );
        return report(await session.commit(), `sequence '${input.name}' with ${steps.length} steps`, upsert, [...new Set(warnings)]);
      },
    ),

    tool(
      "qlc_efx_set",
      "Create or overwrite (`replace`) an EFX: a movement or intensity pattern (circle, eight, line, square, leaf, lissajous...) applied to fixtures, optionally spread across them. Width/height/offsets are 0-255 (127 = center).",
      z.object({
        ...Common,
        fixtures: z.array(Ref).min(1),
        algorithm: z.enum(EFX_ALGORITHMS),
        mode: opt(z.enum(["position", "dimmer", "rgb"])).describe("What the pattern drives (default position: pan/tilt)"),
        propagation: opt(z.enum(["Parallel", "Serial", "Asymmetric"])),
        width: opt(Dmx),
        height: opt(Dmx),
        rotation: opt(z.number().int().min(0).max(359)),
        xOffset: opt(Dmx),
        yOffset: opt(Dmx),
        xFrequency: opt(z.number().int().min(0).max(32)),
        yFrequency: opt(z.number().int().min(0).max(32)),
        xPhase: opt(z.number().int().min(0).max(359)),
        yPhase: opt(z.number().int().min(0).max(359)),
        relative: opt(z.boolean()),
        runOrder: opt(RunOrderName),
        direction: opt(DirectionName),
      }),
      async (input) => {
        const session = await newSession();
        const fixtures = input.fixtures.map((ref) => ({
          fixtureId: findFixture(session.model, ref).id,
          mode: input.mode,
        }));
        const upsert = queueUpsert(session, input.replace, "EFX", (id) =>
          efxXml({ ...input, id, speed: speedOf(input) ?? { duration: 20000 }, fixtures }),
        );
        return report(await session.commit(), `EFX '${input.name}'`, upsert);
      },
    ),

    tool(
      "qlc_rgbmatrix_set",
      "Create or overwrite (`replace`) an RGB Matrix: a pixel animation over an existing fixture group. Script names are listed by qlc_rgbmatrix_algorithms.",
      z.object({
        ...Common,
        group: Ref.describe("Fixture group"),
        algorithm: z.string().describe("Script name such as 'Waves', 'Stripes', 'Fire', or 'Plain' / 'Text'"),
        text: opt(z.string()).describe("Text algorithm only"),
        colors: opt(z.array(z.string()).max(5)).describe("Up to 5 colors"),
        controlMode: opt(z.enum(["RGB", "White", "Amber", "UV", "Dimmer", "Shutter"])),
        properties: opt(z.record(z.string(), z.string())).describe("Script properties, e.g. {\"orientation\": \"Vertical\"}"),
        dimmerControl: opt(z.boolean()),
        runOrder: opt(RunOrderName),
        direction: opt(DirectionName),
      }),
      async (input) => {
        const session = await newSession();
        const group = findFixtureGroup(session.model, input.group);
        const algorithmType = input.algorithm === "Plain" || input.algorithm === "Text" ? input.algorithm : "Script";
        const upsert = queueUpsert(session, input.replace, "RGBMatrix", (id) =>
          rgbMatrixXml({
            id,
            name: input.name,
            path: input.path,
            speed: speedOf(input),
            runOrder: input.runOrder,
            direction: input.direction,
            fixtureGroupId: group.id,
            algorithmType,
            algorithm: input.algorithm,
            text: input.text,
            colors: input.colors?.map((c) => parseColor(c)),
            controlMode: input.controlMode,
            dimmerControl: input.dimmerControl,
            properties: input.properties,
          }),
        );
        return report(await session.commit(), `RGB Matrix '${input.name}' on group '${group.name}'`, upsert);
      },
    ),

    tool(
      "qlc_rgbmatrix_algorithms",
      "List the RGB Matrix script algorithms shipped with QLC+ 5.",
      z.object({}),
      async () => json({ builtIn: ["Plain", "Text"], scripts: RGB_SCRIPTS }),
    ),

    tool(
      "qlc_collection_set",
      "Create or overwrite (`replace`) a collection: functions started together.",
      z.object({
        name: Common.name,
        replace: Common.replace,
        path: Common.path,
        functions: z.array(Ref).min(1),
      }),
      async (input) => {
        const session = await newSession();
        const functionIds = input.functions.map((ref) => findFunction(session.model, ref).id);
        const upsert = queueUpsert(session, input.replace, "Collection", (id) =>
          collectionXml({ id, name: input.name, path: input.path, functionIds }),
        );
        return report(await session.commit(), `collection '${input.name}'`, upsert);
      },
    ),

    tool(
      "qlc_script_set",
      "Create or overwrite (`replace`) a QLC+ script. One command per line, using function and fixture IDs: 'startfunction:12', 'stopfunction:12', 'wait:1000' (ms, or 1s.500), 'setfixture:3 ch:0 val:255', 'blackout:on', 'blackout:off', 'stoponexit:true', 'label:start', 'jump:start', 'systemcommand:/path arg:x', '// comment'.",
      z.object({
        name: Common.name,
        replace: Common.replace,
        path: Common.path,
        lines: z.array(z.string()).min(1),
        runOrder: opt(RunOrderName),
      }),
      async (input) => {
        const session = await newSession();
        const upsert = queueUpsert(session, input.replace, "Script", (id) =>
          scriptXml({ id, name: input.name, path: input.path, lines: input.lines, runOrder: input.runOrder }),
        );
        return report(await session.commit(), `script '${input.name}'`, upsert);
      },
    ),

    tool(
      "qlc_show_set",
      "Create or overwrite (`replace`) a Show: a timeline with tracks, each holding functions at given start times (ms). Items without a duration use the function's own duration.",
      z.object({
        name: Common.name,
        replace: Common.replace,
        path: Common.path,
        timeDivision: opt(z.enum(["Time", "BPM_4_4", "BPM_3_4", "BPM_2_4"])),
        bpm: opt(z.number().int().min(20).max(300)),
        tracks: z
          .array(
            z.object({
              name: z.string().min(1),
              mute: opt(z.boolean()),
              items: z.array(
                z.object({
                  function: Ref,
                  start: Millis,
                  duration: opt(Millis),
                  color: opt(z.string()).describe("Item color in the timeline, #rrggbb"),
                }),
              ),
            }),
          )
          .min(1),
      }),
      async (input) => {
        const session = await newSession();
        const tracks = input.tracks.map((track, index) => ({
          id: index,
          name: track.name,
          mute: track.mute,
          items: track.items.map((item) => ({
            functionId: findFunction(session.model, item.function).id,
            startTime: item.start,
            duration: item.duration,
            color: item.color,
          })),
        }));
        const upsert = queueUpsert(session, input.replace, "Show", (id) =>
          showXml({ id, name: input.name, path: input.path, timeDivision: input.timeDivision, bpm: input.bpm, tracks }),
        );
        return report(await session.commit(), `show '${input.name}' with ${tracks.length} tracks`, upsert);
      },
    ),

    tool(
      "qlc_media_set",
      "Create or overwrite (`replace`) an Audio or Video function playing a file on the QLC+ machine.",
      z.object({
        name: Common.name,
        replace: Common.replace,
        path: Common.path,
        kind: z.enum(["Audio", "Video"]),
        source: z.string().min(1).describe("File path (absolute, or relative to the workspace) or URL for video"),
        fadeIn: Common.fadeIn,
        fadeOut: Common.fadeOut,
        runOrder: opt(RunOrderName),
        screen: opt(z.number().int().min(0)).describe("Video only: output screen index"),
        fullscreen: opt(z.boolean()).describe("Video only"),
      }),
      async (input) => {
        const session = await newSession();
        const build = input.kind === "Audio" ? audioXml : videoXml;
        const upsert = queueUpsert(session, input.replace, input.kind, (id) =>
          build({
            id,
            name: input.name,
            path: input.path,
            source: input.source,
            speed: speedOf(input),
            runOrder: input.runOrder,
            screen: input.screen,
            fullscreen: input.fullscreen,
          }),
        );
        return report(await session.commit(), `${input.kind} '${input.name}'`, upsert);
      },
    ),
  ];
}

/** resources/rgbscripts of QLC+ 5 (algo.name of each script) */
export const RGB_SCRIPTS = [
  "Alternate", "Aurora", "Balls", "Blinder", "Circles", "Circular", "Confetti", "ConnectDots",
  "Even/Odd", "Eyes", "Fill", "Fill From Center", "Fill Unfill", "Fill Unfill From Center",
  "Fill Unfill Squares From Center", "Fire", "Fire Flicker", "Fireflies", "Fireworks",
  "Flying Objects", "Fractal", "Gradient", "Juggle", "Lantern", "Lightning", "Lines", "Marquee",
  "Meteor", "Noise", "One By One", "Opposite", "OrthoLines", "Pacifica", "Plasma", "Random Column",
  "Random Fill Column", "Random Fill Row", "Random Fill Single", "Random Pixel Per Row",
  "Random Pixel Per Row Multicolor", "Random Row", "Random Single", "Ripple", "Shapes", "Sinelon",
  "Sine Wave", "Snow or Bubbles", "Spark", "Squares", "Squares From Center", "Stage Pulse",
  "3D Starfield", "Stripes", "Stripes From Center", "Strobe", "Strum", "TwinkleFox", "Vertical fall",
  "Water Flow", "Waves",
];
