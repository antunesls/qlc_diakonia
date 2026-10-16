import { boolText, el, textEl, type XmlChild, type XmlNode } from "./xmlWriter.js";

/**
 * Virtual Console widget fragments, in the format read by the qmlui
 * VCWidget::loadXML family (qlcplus/qmlui/virtualconsole/*.cpp).
 *
 * All function and fixture references are already-resolved numeric IDs.
 */

export interface WidgetCommon {
  id?: number;
  caption: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Page inside a multipage parent frame */
  page?: number;
  /** 0xAARRGGBB */
  backgroundColor?: number;
  foregroundColor?: number;
  /** QFont::toString(), e.g. "Arial,16,-1,5,75,0,0,0,0,0" */
  font?: string;
  /** Background image path, relative to the workspace */
  backgroundImage?: string;
  /** Keyboard shortcut, e.g. "Q" or "Ctrl+1" */
  key?: string;
  /** External input binding */
  input?: { universe: number; channel: number };
}

export interface FrameSpec extends WidgetCommon {
  type: "frame" | "soloframe";
  showHeader?: boolean;
  showEnableButton?: boolean;
  collapsed?: boolean;
  disabled?: boolean;
  allowResize?: boolean;
  /** Number of pages; > 1 enables multipage mode */
  pages?: number;
  pagesLoop?: boolean;
  /** Solo frame only: mix functions instead of stopping the others */
  mixing?: boolean;
  children: WidgetSpec[];
}

export type ButtonAction = "toggle" | "flash" | "blackout" | "stopall";

export interface ButtonSpec extends WidgetCommon {
  type: "button";
  functionId?: number;
  action?: ButtonAction;
  /** Startup intensity in percent (0-100) */
  intensity?: number;
  /** StopAll fade out time in ms */
  stopAllFadeOut?: number;
  flashOverride?: boolean;
  flashForceLTP?: boolean;
}

export type SliderModeName = "level" | "adjust" | "submaster" | "grandmaster";

export interface SliderSpec extends WidgetCommon {
  type: "slider";
  mode: SliderModeName;
  style?: "slider" | "knob";
  valueDisplay?: "exact" | "percentage";
  inverted?: boolean;
  low?: number;
  high?: number;
  value?: number;
  /** Adjust mode: function to control */
  functionId?: number;
  /** Adjust mode: 0 = intensity, other indexes are function attributes */
  attribute?: number;
  /** Level mode: controlled channels */
  channels?: { fixtureId: number; channel: number }[];
  clickAndGo?: "none" | "colors" | "preset";
  monitor?: boolean;
  catchValues?: boolean;
}

export interface CueListSpec extends WidgetCommon {
  type: "cuelist";
  chaserId?: number;
  sideFader?: "none" | "crossfade" | "steps";
  nextPrevBehavior?: "runfirst" | "runnext" | "select" | "nothing";
  playbackLayout?: "playpausestop" | "playstoppause";
}

export interface SpeedDialSpec extends WidgetCommon {
  type: "speeddial";
  functions: {
    functionId: number;
    /** SpeedMultiplier enum values; One = 6 */
    fadeInFactor?: number;
    fadeOutFactor?: number;
    durationFactor?: number;
  }[];
  timeMs?: number;
  minMs?: number;
  maxMs?: number;
}

export interface XYPadSpec extends WidgetCommon {
  type: "xypad";
  fixtures: {
    fixtureId: number;
    head?: number;
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
    xReverse?: boolean;
    yReverse?: boolean;
  }[];
  inverted?: boolean;
}

export interface LabelSpec extends WidgetCommon {
  type: "label";
}

export interface ClockSpec extends WidgetCommon {
  type: "clock";
  clockType?: "clock" | "stopwatch" | "countdown";
  /** Countdown target, HH:mm:ss */
  targetTime?: string;
  schedules?: { functionId: number; startTime: string; stopTime?: string; weekFlags?: number }[];
}

export interface AudioTriggersSpec extends WidgetCommon {
  type: "audiotriggers";
  bars?: number;
}

export interface AnimationSpec extends WidgetCommon {
  type: "animation";
  /** RGB Matrix function controlled by the widget */
  functionId?: number;
  instantApply?: boolean;
  /** Bit mask of visible controls; 0 keeps the QLC+ default */
  visibility?: number;
}

export type WidgetSpec =
  | FrameSpec
  | ButtonSpec
  | SliderSpec
  | CueListSpec
  | SpeedDialSpec
  | XYPadSpec
  | LabelSpec
  | ClockSpec
  | AudioTriggersSpec
  | AnimationSpec;

export type WidgetType = WidgetSpec["type"];

const TAGS: Record<WidgetType, string> = {
  frame: "Frame",
  soloframe: "SoloFrame",
  button: "Button",
  slider: "Slider",
  cuelist: "CueList",
  speeddial: "SpeedDial",
  xypad: "XYPad",
  label: "Label",
  clock: "Clock",
  audiotriggers: "AudioTriggers",
  animation: "Matrix",
};

export function widgetTagName(type: WidgetType): string {
  return TAGS[type];
}

function commonAttrs(spec: WidgetCommon): Record<string, string | number | undefined> {
  return {
    Caption: spec.caption,
    ID: spec.id,
    Page: spec.page ? spec.page : undefined,
  };
}

function windowState(spec: WidgetCommon): XmlNode {
  return el("WindowState", {
    Visible: "True",
    X: Math.round(spec.x),
    Y: Math.round(spec.y),
    Width: Math.round(spec.width),
    Height: Math.round(spec.height),
  });
}

function appearance(spec: WidgetCommon): XmlNode {
  return el(
    "Appearance",
    {},
    textEl(
      "ForegroundColor",
      spec.foregroundColor === undefined ? "Default" : (spec.foregroundColor | 0xff000000) >>> 0,
    ),
    textEl(
      "BackgroundColor",
      spec.backgroundColor === undefined ? "Default" : (spec.backgroundColor | 0xff000000) >>> 0,
    ),
    textEl("BackgroundImage", spec.backgroundImage || "None"),
    textEl("Font", spec.font || "Default"),
  );
}

function inputEl(spec: WidgetCommon, id?: number): XmlChild[] {
  return [
    spec.input
      ? el("Input", { ID: id, Universe: spec.input.universe, Channel: spec.input.channel })
      : undefined,
    spec.key ? textEl("Key", spec.key, id === undefined ? {} : { ID: id }) : undefined,
  ];
}

function base(spec: WidgetCommon): XmlChild[] {
  return [windowState(spec), appearance(spec)];
}

const ACTIONS: Record<ButtonAction, string> = {
  toggle: "Toggle",
  flash: "Flash",
  blackout: "Blackout",
  stopall: "StopAll",
};

function buttonXml(spec: ButtonSpec): XmlNode {
  const action = spec.action ?? "toggle";
  return el(
    "Button",
    commonAttrs(spec),
    base(spec),
    el("Function", { ID: spec.functionId ?? 0xffffffff }),
    textEl("Action", ACTIONS[action], {
      FadeOut: action === "stopall" && spec.stopAllFadeOut ? spec.stopAllFadeOut : undefined,
      Override: action === "flash" ? (spec.flashOverride ? 1 : 0) : undefined,
      ForceLTP: action === "flash" ? (spec.flashForceLTP ? 1 : 0) : undefined,
    }),
    spec.intensity === undefined
      ? undefined
      : textEl("Intensity", Math.round(spec.intensity), { Adjust: "True" }),
    inputEl(spec),
  );
}

const SLIDER_MODES: Record<SliderModeName, string> = {
  level: "Level",
  adjust: "Adjust",
  submaster: "Submaster",
  grandmaster: "GrandMaster",
};

function sliderXml(spec: SliderSpec): XmlNode {
  const low = spec.low ?? 0;
  const high = spec.high ?? 255;
  const clickAndGo = { none: undefined, colors: "Colors", preset: "Preset" }[
    spec.clickAndGo ?? "none"
  ];
  return el(
    "Slider",
    {
      ...commonAttrs(spec),
      WidgetStyle: spec.style === "knob" ? "Knob" : "Slider",
      // VCSlider::loadXML treats a missing attribute as inverted
      InvertedAppearance: spec.inverted ? "true" : "false",
      CatchValues: spec.catchValues ? "true" : undefined,
    },
    base(spec),
    textEl("SliderMode", SLIDER_MODES[spec.mode], {
      ValueDisplayStyle: spec.valueDisplay === "percentage" ? "Percentage" : "Exact",
      ClickAndGoType: clickAndGo,
      Monitor: spec.mode === "level" && spec.monitor ? "true" : undefined,
    }),
    el(
      "Level",
      // masters at 0 would black out their frame (or everything): start them full
      {
        LowLimit: low,
        HighLimit: high,
        Value: spec.value ?? (spec.mode === "grandmaster" || spec.mode === "submaster" ? high : 0),
      },
      (spec.channels ?? []).map((ch) => textEl("Channel", ch.channel, { Fixture: ch.fixtureId })),
    ),
    spec.functionId === undefined
      ? undefined
      : el("Adjust", { Attribute: spec.attribute ?? 0, Function: spec.functionId }),
    inputEl(spec),
  );
}

function cueListXml(spec: CueListSpec): XmlNode {
  const nextPrev = { runfirst: 0, runnext: 1, select: 2, nothing: 3 }[
    spec.nextPrevBehavior ?? "runfirst"
  ];
  return el(
    "CueList",
    commonAttrs(spec),
    base(spec),
    textEl("Chaser", spec.chaserId ?? 0xffffffff),
    spec.playbackLayout === "playstoppause" ? textEl("PlaybackLayout", 1) : undefined,
    nextPrev ? textEl("NextPrevBehavior", nextPrev) : undefined,
    spec.sideFader && spec.sideFader !== "none"
      ? textEl("SlidersMode", spec.sideFader === "crossfade" ? "Crossfade" : "Steps")
      : undefined,
  );
}

function speedDialXml(spec: SpeedDialSpec): XmlNode {
  const ONE = 6;
  return el(
    "SpeedDial",
    commonAttrs(spec),
    base(spec),
    el("AbsoluteValue", { Minimum: spec.minMs ?? 0, Maximum: spec.maxMs ?? 10000 }),
    textEl("Time", spec.timeMs ?? 1000),
    spec.functions.map((fn) =>
      textEl("Function", fn.functionId, {
        FadeIn: fn.fadeInFactor ?? 0,
        FadeOut: fn.fadeOutFactor ?? 0,
        Duration: fn.durationFactor ?? ONE,
      }),
    ),
  );
}

function xyPadXml(spec: XYPadSpec): XmlNode {
  return el(
    "XYPad",
    { ...commonAttrs(spec), InvertedAppearance: spec.inverted ? 1 : 0 },
    base(spec),
    spec.fixtures.map((fx) =>
      el(
        "Fixture",
        { ID: fx.fixtureId, Head: fx.head ?? 0 },
        el("Axis", {
          ID: "X",
          LowLimit: fx.xMin ?? 0,
          HighLimit: fx.xMax ?? 1,
          Reverse: boolText(fx.xReverse ?? false),
        }),
        el("Axis", {
          ID: "Y",
          LowLimit: fx.yMin ?? 0,
          HighLimit: fx.yMax ?? 1,
          Reverse: boolText(fx.yReverse ?? false),
        }),
      ),
    ),
  );
}

function clockXml(spec: ClockSpec): XmlNode {
  const type = { clock: "Clock", stopwatch: "Stopwatch", countdown: "Countdown" }[
    spec.clockType ?? "clock"
  ];
  return el(
    "Clock",
    {
      ...commonAttrs(spec),
      Type: type,
      Time: spec.clockType === "countdown" ? spec.targetTime ?? "00:05:00" : undefined,
      Enable: spec.schedules?.length ? "True" : undefined,
    },
    base(spec),
    (spec.schedules ?? []).map((s) =>
      el("Schedule", {
        Function: s.functionId,
        StartTime: s.startTime,
        StopTime: s.stopTime,
        WeekFlags: s.weekFlags,
      }),
    ),
  );
}

function animationXml(spec: AnimationSpec): XmlNode {
  return el(
    "Matrix",
    commonAttrs(spec),
    base(spec),
    el("Function", {
      ID: spec.functionId ?? 0xffffffff,
      InstantApply: spec.instantApply ? "True" : undefined,
    }),
    spec.visibility ? textEl("Visibility", spec.visibility) : undefined,
  );
}

function frameXml(spec: FrameSpec): XmlNode {
  const multipage = (spec.pages ?? 1) > 1;
  return el(
    spec.type === "soloframe" ? "SoloFrame" : "Frame",
    commonAttrs(spec),
    base(spec),
    textEl("AllowChildren", "True"),
    textEl("AllowResize", boolText(spec.allowResize ?? true)),
    textEl("ShowHeader", boolText(spec.showHeader ?? true)),
    textEl("ShowEnableButton", boolText(spec.showEnableButton ?? true)),
    spec.type === "soloframe" ? textEl("Mixing", boolText(spec.mixing ?? false)) : undefined,
    textEl("Collapsed", boolText(spec.collapsed ?? false)),
    textEl("Disabled", boolText(spec.disabled ?? false)),
    multipage
      ? el("Multipage", {
          PagesNum: spec.pages,
          CurrentPage: 0,
          PagesLoop: spec.pagesLoop ? "True" : undefined,
        })
      : undefined,
    spec.children.map(widgetXml),
  );
}

export function widgetXml(spec: WidgetSpec): XmlNode {
  switch (spec.type) {
    case "frame":
    case "soloframe":
      return frameXml(spec);
    case "button":
      return buttonXml(spec);
    case "slider":
      return sliderXml(spec);
    case "cuelist":
      return cueListXml(spec);
    case "speeddial":
      return speedDialXml(spec);
    case "xypad":
      return xyPadXml(spec);
    case "label":
      return el("Label", commonAttrs(spec), base(spec));
    case "clock":
      return clockXml(spec);
    case "audiotriggers":
      return el(
        "AudioTriggers",
        { ...commonAttrs(spec), BarsNumber: spec.bars ? spec.bars - 1 : undefined },
        base(spec),
      );
    case "animation":
      return animationXml(spec);
  }
}
