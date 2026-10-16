import { el, textEl, type XmlChild, type XmlNode } from "./xmlWriter.js";

export type RunOrderName = "Loop" | "SingleShot" | "PingPong" | "Random";
export type DirectionName = "Forward" | "Backward";
export type SpeedModeName = "Default" | "Common" | "PerStep";
export type TempoName = "Time" | "Beats";

/** Times in milliseconds. 4294967294 (0xFFFFFFFE) means infinite in QLC+. */
export interface SpeedSpec {
  fadeIn?: number;
  fadeOut?: number;
  duration?: number;
}

export const INFINITE_TIME = 0xfffffffe;

export interface FunctionCommon {
  id: number;
  name: string;
  path?: string;
  hidden?: boolean;
  tempo?: TempoName;
}

function functionEl(
  type: string,
  common: FunctionCommon,
  extraAttrs: Record<string, string | number | undefined>,
  children: (XmlChild | XmlChild[])[],
): XmlNode {
  return el(
    "Function",
    {
      ID: common.id,
      Type: type,
      Name: common.name,
      Path: common.path || undefined,
      Hidden: common.hidden ? "True" : undefined,
      ...extraAttrs,
    },
    ...children,
  );
}

function speedEl(speed: SpeedSpec = {}): XmlNode {
  return el("Speed", {
    FadeIn: speed.fadeIn ?? 0,
    FadeOut: speed.fadeOut ?? 0,
    Duration: speed.duration ?? 0,
  });
}

function tempoEl(tempo?: TempoName): XmlNode | undefined {
  return tempo ? textEl("Tempo", tempo) : undefined;
}

/* ------------------------------------------------------------------ Scene */

export interface SceneChannelValue {
  channel: number;
  value: number;
}

export interface SceneXmlSpec extends FunctionCommon {
  speed?: SpeedSpec;
  /** fixture id -> channel values. A fixture with no values is still added. */
  fixtures: { fixtureId: number; values: SceneChannelValue[] }[];
  fixtureGroups?: number[];
}

export function sceneXml(spec: SceneXmlSpec): XmlNode {
  return functionEl("Scene", spec, {}, [
    speedEl(spec.speed),
    tempoEl(spec.tempo),
    (spec.fixtureGroups ?? []).map((id) => el("FixtureGroup", { ID: id })),
    spec.fixtures.map(({ fixtureId, values }) => {
      const sorted = [...values].sort((a, b) => a.channel - b.channel);
      const text = sorted.map((v) => `${v.channel},${clampDmx(v.value)}`).join(",");
      return text
        ? textEl("FixtureVal", text, { ID: fixtureId })
        : el("FixtureVal", { ID: fixtureId });
    }),
  ]);
}

export function clampDmx(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/* ----------------------------------------------------------------- Chaser */

export interface ChaserStepSpec {
  functionId: number;
  fadeIn?: number;
  hold?: number;
  fadeOut?: number;
  note?: string;
}

export interface SpeedModes {
  fadeIn?: SpeedModeName;
  fadeOut?: SpeedModeName;
  duration?: SpeedModeName;
}

export interface ChaserXmlSpec extends FunctionCommon {
  speed?: SpeedSpec;
  direction?: DirectionName;
  runOrder?: RunOrderName;
  speedModes?: SpeedModes;
  steps: ChaserStepSpec[];
}

function speedModesEl(modes: SpeedModes = {}): XmlNode {
  return el("SpeedModes", {
    FadeIn: modes.fadeIn ?? "Default",
    FadeOut: modes.fadeOut ?? "Default",
    Duration: modes.duration ?? "Common",
  });
}

function stepAttrs(index: number, step: Omit<ChaserStepSpec, "functionId">) {
  return {
    Number: index,
    FadeIn: step.fadeIn ?? 0,
    Hold: step.hold ?? 0,
    FadeOut: step.fadeOut ?? 0,
    Note: step.note || undefined,
  };
}

export function chaserStepXml(index: number, step: ChaserStepSpec): XmlNode {
  return textEl("Step", step.functionId, stepAttrs(index, step));
}

export function chaserXml(spec: ChaserXmlSpec): XmlNode {
  return functionEl("Chaser", spec, {}, [
    speedEl(spec.speed),
    textEl("Direction", spec.direction ?? "Forward"),
    textEl("RunOrder", spec.runOrder ?? "Loop"),
    tempoEl(spec.tempo),
    speedModesEl(spec.speedModes),
    spec.steps.map((step, index) => chaserStepXml(index, step)),
  ]);
}

/* --------------------------------------------------------------- Sequence */

export interface SequenceStepSpec {
  fadeIn?: number;
  hold?: number;
  fadeOut?: number;
  note?: string;
  /** Values of the bound scene channels for this step. Zero values may be omitted. */
  values: { fixtureId: number; channel: number; value: number }[];
}

export interface SequenceXmlSpec extends FunctionCommon {
  boundSceneId: number;
  /** Number of channels held by the bound scene */
  boundSceneChannelCount: number;
  speed?: SpeedSpec;
  direction?: DirectionName;
  runOrder?: RunOrderName;
  speedModes?: SpeedModes;
  steps: SequenceStepSpec[];
}

/** ChaserStep::saveXML sequence syntax: fixtureID:ch,val,ch,val:fixtureID:ch,val */
export function sequenceStepValues(values: SequenceStepSpec["values"]): string {
  const byFixture = new Map<number, { channel: number; value: number }[]>();
  for (const value of values) {
    if (clampDmx(value.value) === 0) continue;
    const list = byFixture.get(value.fixtureId) ?? [];
    list.push(value);
    byFixture.set(value.fixtureId, list);
  }
  return [...byFixture.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([fixtureId, list]) =>
        `${fixtureId}:${list
          .sort((a, b) => a.channel - b.channel)
          .map((v) => `${v.channel},${clampDmx(v.value)}`)
          .join(",")}`,
    )
    .join(":");
}

export function sequenceXml(spec: SequenceXmlSpec): XmlNode {
  return functionEl("Sequence", spec, { BoundScene: spec.boundSceneId }, [
    speedEl(spec.speed),
    textEl("Direction", spec.direction ?? "Forward"),
    textEl("RunOrder", spec.runOrder ?? "Loop"),
    tempoEl(spec.tempo),
    speedModesEl(spec.speedModes),
    spec.steps.map((step, index) => {
      const text = sequenceStepValues(step.values);
      const attrs = { ...stepAttrs(index, step), Values: spec.boundSceneChannelCount };
      return text ? textEl("Step", text, attrs) : el("Step", attrs);
    }),
  ]);
}

/* ------------------------------------------------------------------- EFX */

export const EFX_ALGORITHMS = [
  "Circle",
  "Eight",
  "Line",
  "Line2",
  "Diamond",
  "Square",
  "SquareChoppy",
  "SquareTrue",
  "Leaf",
  "Lissajous",
] as const;
export type EfxAlgorithm = (typeof EFX_ALGORITHMS)[number];

/** EFXFixture::Mode */
export const EfxFixtureMode = { position: 0, dimmer: 1, rgb: 2 } as const;
export type EfxFixtureModeName = keyof typeof EfxFixtureMode;

export interface EfxFixtureSpec {
  fixtureId: number;
  head?: number;
  mode?: EfxFixtureModeName;
  direction?: DirectionName;
  startOffset?: number;
}

export interface EfxXmlSpec extends FunctionCommon {
  speed?: SpeedSpec;
  direction?: DirectionName;
  runOrder?: RunOrderName;
  algorithm: EfxAlgorithm;
  propagation?: "Parallel" | "Serial" | "Asymmetric";
  width?: number;
  height?: number;
  rotation?: number;
  startOffset?: number;
  relative?: boolean;
  xOffset?: number;
  yOffset?: number;
  xFrequency?: number;
  yFrequency?: number;
  xPhase?: number;
  yPhase?: number;
  fixtures: EfxFixtureSpec[];
}

export function efxFixtureXml(fixture: EfxFixtureSpec): XmlNode {
  return el(
    "Fixture",
    {},
    textEl("ID", fixture.fixtureId),
    textEl("Head", fixture.head ?? 0),
    textEl("Mode", EfxFixtureMode[fixture.mode ?? "position"]),
    textEl("Direction", fixture.direction ?? "Forward"),
    textEl("StartOffset", fixture.startOffset ?? 0),
  );
}

export function efxXml(spec: EfxXmlSpec): XmlNode {
  const axis = (name: "X" | "Y", offset = 127, frequency = 2, phase = 0) =>
    el(
      "Axis",
      { Name: name },
      textEl("Offset", offset),
      textEl("Frequency", frequency),
      textEl("Phase", phase),
    );
  return functionEl("EFX", spec, {}, [
    spec.fixtures.map(efxFixtureXml),
    textEl("PropagationMode", spec.propagation ?? "Parallel"),
    speedEl(spec.speed ?? { duration: 20000 }),
    textEl("Direction", spec.direction ?? "Forward"),
    textEl("RunOrder", spec.runOrder ?? "Loop"),
    tempoEl(spec.tempo),
    textEl("Algorithm", spec.algorithm),
    textEl("Width", spec.width ?? 127),
    textEl("Height", spec.height ?? 127),
    textEl("Rotation", spec.rotation ?? 0),
    textEl("StartOffset", spec.startOffset ?? 0),
    textEl("IsRelative", spec.relative ? 1 : 0),
    axis("X", spec.xOffset, spec.xFrequency ?? 2, spec.xPhase ?? 90),
    axis("Y", spec.yOffset, spec.yFrequency ?? 3, spec.yPhase ?? 0),
  ]);
}

/* ------------------------------------------------------------- RGB Matrix */

export type RgbAlgorithmType = "Script" | "Plain" | "Text" | "Image" | "Audio";
export type RgbControlMode = "RGB" | "White" | "Amber" | "UV" | "Dimmer" | "Shutter";

export interface RgbMatrixXmlSpec extends FunctionCommon {
  speed?: SpeedSpec;
  direction?: DirectionName;
  runOrder?: RunOrderName;
  fixtureGroupId: number;
  algorithmType?: RgbAlgorithmType;
  /** Script name (e.g. "Waves") for Script type, otherwise ignored */
  algorithm?: string;
  /** Text to display for the Text algorithm */
  text?: string;
  /** Up to 5 ARGB colors */
  colors?: number[];
  controlMode?: RgbControlMode;
  dimmerControl?: boolean;
  properties?: Record<string, string>;
}

export function rgbMatrixXml(spec: RgbMatrixXmlSpec): XmlNode {
  const type = spec.algorithmType ?? "Script";
  const algorithm =
    type === "Script"
      ? textEl("Algorithm", spec.algorithm ?? "Stripes", { Type: "Script" })
      : type === "Text"
        ? el("Algorithm", { Type: "Text" }, textEl("Content", spec.text ?? ""))
        : el("Algorithm", { Type: type });
  return functionEl("RGBMatrix", spec, {}, [
    speedEl(spec.speed ?? { duration: 500 }),
    textEl("Direction", spec.direction ?? "Forward"),
    textEl("RunOrder", spec.runOrder ?? "Loop"),
    tempoEl(spec.tempo),
    algorithm,
    (spec.colors ?? []).slice(0, 5).map((argb, index) =>
      textEl("Color", (argb | 0xff000000) >>> 0, { Index: index }),
    ),
    textEl("ControlMode", spec.controlMode ?? "RGB"),
    spec.dimmerControl ? textEl("DimmerControl", 1) : undefined,
    textEl("FixtureGroup", spec.fixtureGroupId),
    Object.entries(spec.properties ?? {}).map(([name, value]) =>
      el("Property", { Name: name, Value: value }),
    ),
  ]);
}

/* ------------------------------------------------------------- Collection */

export interface CollectionXmlSpec extends FunctionCommon {
  functionIds: number[];
}

export function collectionXml(spec: CollectionXmlSpec): XmlNode {
  return functionEl(
    "Collection",
    spec,
    {},
    spec.functionIds.map((id, index) => textEl("Step", id, { Number: index })),
  );
}

/* ------------------------------------------------------------------- Show */

export interface ShowItemSpec {
  functionId: number;
  startTime: number;
  duration?: number;
  color?: string;
  locked?: boolean;
}

export interface ShowTrackSpec {
  id: number;
  name: string;
  mute?: boolean;
  /** Scene bound to the track, if any */
  sceneId?: number;
  items: ShowItemSpec[];
}

export interface ShowXmlSpec extends FunctionCommon {
  timeDivision?: "Time" | "BPM_4_4" | "BPM_3_4" | "BPM_2_4";
  bpm?: number;
  tracks: ShowTrackSpec[];
}

export function showTrackXml(track: ShowTrackSpec, firstUid = 0): XmlNode {
  return el(
    "Track",
    {
      ID: track.id,
      Name: track.name,
      SceneID: track.sceneId,
      isMute: track.mute ? 1 : 0,
    },
    track.items.map((item, index) =>
      el("ShowFunction", {
        UID: firstUid + index,
        ID: item.functionId,
        StartTime: Math.max(0, Math.round(item.startTime)),
        Duration:
          item.duration === undefined ? undefined : Math.max(0, Math.round(item.duration)),
        Color: item.color,
        Locked: item.locked ? 1 : undefined,
      }),
    ),
  );
}

export function showXml(spec: ShowXmlSpec): XmlNode {
  let uid = 0;
  return functionEl("Show", spec, {}, [
    el("TimeDivision", { Type: spec.timeDivision ?? "Time", BPM: spec.bpm ?? 120 }),
    spec.tracks.map((track) => {
      const node = showTrackXml(track, uid);
      uid += track.items.length;
      return node;
    }),
  ]);
}

/* ----------------------------------------------------------------- Script */

export interface ScriptXmlSpec extends FunctionCommon {
  /** One QLC+ script command per line (e.g. "startfunction:12", "wait:1000") */
  lines: string[];
  runOrder?: RunOrderName;
}

export function scriptXml(spec: ScriptXmlSpec): XmlNode {
  return functionEl("Script", spec, {}, [
    speedEl(),
    textEl("Direction", "Forward"),
    textEl("RunOrder", spec.runOrder ?? "SingleShot"),
    // Script::saveXML percent-encodes each command line
    spec.lines.map((line) => textEl("Command", encodeURIComponent(line))),
  ]);
}

/* ---------------------------------------------------------- Audio / Video */

export interface MediaXmlSpec extends FunctionCommon {
  source: string;
  speed?: SpeedSpec;
  runOrder?: RunOrderName;
  /** Video only */
  screen?: number;
  fullscreen?: boolean;
}

export function audioXml(spec: MediaXmlSpec): XmlNode {
  return functionEl("Audio", spec, {}, [
    speedEl(spec.speed),
    textEl("RunOrder", spec.runOrder ?? "SingleShot"),
    textEl("Source", spec.source),
  ]);
}

export function videoXml(spec: MediaXmlSpec): XmlNode {
  return functionEl("Video", spec, {}, [
    speedEl(spec.speed),
    textEl("RunOrder", spec.runOrder ?? "SingleShot"),
    textEl("Source", spec.source, {
      Screen: spec.screen,
      Fullscreen: spec.fullscreen === undefined ? undefined : spec.fullscreen ? 1 : 0,
    }),
  ]);
}
