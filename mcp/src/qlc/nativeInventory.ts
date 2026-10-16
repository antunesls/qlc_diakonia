import { parseStringPromise } from "xml2js";

export type NativeWidgetKind = "button" | "slider";

export interface NativeWidget {
  id: number;
  caption: string;
  normalizedCaption: string;
  kind: NativeWidgetKind;
  actionType?: string;
  low?: number;
  high?: number;
  functionId?: number;
  sliderMode?: string;
  widgetStyle?: string;
  parentFrameKind?: "frame" | "soloframe";
  parentFrameId?: number;
  framePath: string[];
}

export interface NativeInventory {
  buttons: Map<string, NativeWidget>;
  sliders: Map<string, NativeWidget>;
  widgets: NativeWidget[];
}

/**
 * Loose normalization retained only as diagnostic metadata. It must never be
 * used to authorize a live command or decide whether two captions collide.
 */
export function normalizeNativeCaption(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/**
 * Runtime identity for QLC+ captions: ignore case only. Leading/trailing
 * whitespace from transport/user input is ignored, but internal spaces,
 * accents, punctuation, underscores and hyphens are significant.
 */
export function exactNativeCaptionKey(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

function localName(value: string): string {
  return value.split(":").at(-1)?.toLowerCase() ?? value.toLowerCase();
}

function optionalUint(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff
    ? parsed
    : undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (
    value &&
    typeof value === "object" &&
    "_" in value &&
    typeof (value as any)._ === "string"
  ) {
    return (value as any)._.trim() || undefined;
  }
  return undefined;
}

export async function parseNativeProjectInventory(
  xml: Buffer,
  maximumSize = 16 * 1024 * 1024,
): Promise<NativeInventory> {
  if (xml.length > maximumSize) {
    throw new Error("QLC+ project exceeds native inventory limit");
  }

  const source = xml.toString("utf8");
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

  const parsed = await parseStringPromise(source, {
    explicitArray: true,
    explicitRoot: true,
  });
  const buttons = new Map<string, NativeWidget>();
  const sliders = new Map<string, NativeWidget>();
  const widgets: NativeWidget[] = [];

  const visit = (
    value: unknown,
    insideVirtualConsole: boolean,
    parentFrame?: { kind: "frame" | "soloframe"; id?: number },
    framePath: string[] = [],
  ): void => {
    if (!value || typeof value !== "object") return;

    for (const [rawTag, rawChildren] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (rawTag === "$" || rawTag === "_") continue;
      const tag = localName(rawTag);
      const children = Array.isArray(rawChildren) ? rawChildren : [rawChildren];

      for (const child of children) {
        if (!child || typeof child !== "object") continue;
        const attrs = ((child as any).$ ?? {}) as Record<string, string>;
        const inVc = insideVirtualConsole || tag === "virtualconsole";

        if (!inVc) {
          visit(child, false, undefined, []);
          continue;
        }

        if (tag === "frame" || tag === "soloframe") {
          const caption = attrs.Caption?.trim() || attrs.Name?.trim();
          visit(
            child,
            true,
            { kind: tag, id: optionalUint(attrs.ID) },
            caption ? [...framePath, caption] : framePath,
          );
          continue;
        }

        if (tag === "button" || tag === "slider") {
          const id = optionalUint(attrs.ID);
          const caption = attrs.Caption?.trim() || attrs.Name?.trim();
          if (id === undefined || !caption) continue;

          const exactKey = exactNativeCaptionKey(caption);
          if (buttons.has(exactKey) || sliders.has(exactKey)) {
            throw new Error(
              `Duplicate case-insensitive QLC+ widget caption: ${caption}`,
            );
          }

          const widget: NativeWidget = {
            id,
            caption,
            normalizedCaption: normalizeNativeCaption(caption),
            kind: tag,
            framePath: [...framePath],
          };
          if (parentFrame) {
            widget.parentFrameKind = parentFrame.kind;
            widget.parentFrameId = parentFrame.id;
          }

          for (const [rawChildTag, nestedValues] of Object.entries(
            child as Record<string, unknown>,
          )) {
            const childTag = localName(rawChildTag);
            for (const nested of Array.isArray(nestedValues)
              ? nestedValues
              : [nestedValues]) {
              const nestedAttrs =
                (nested && typeof nested === "object"
                  ? (nested as any).$
                  : {}) ?? {};
              if (tag === "button" && childTag === "action") {
                widget.actionType = textValue(nested)?.toLowerCase();
              }
              if (tag === "button" && childTag === "function") {
                widget.functionId = optionalUint(nestedAttrs.ID);
              }
              if (tag === "slider" && childTag === "slidermode") {
                widget.sliderMode = textValue(nested)?.toLowerCase();
              }
              if (tag === "slider" && childTag === "adjust") {
                widget.functionId = optionalUint(nestedAttrs.Function);
              }
              if (
                tag === "slider" &&
                (childTag === "level" || childTag === "value")
              ) {
                const low = Number(nestedAttrs.LowLimit ?? nestedAttrs.Low);
                const high = Number(nestedAttrs.HighLimit ?? nestedAttrs.High);
                if (Number.isFinite(low) && Number.isFinite(high)) {
                  if (low >= high) {
                    throw new Error(`Invalid QLC+ slider range: ${caption}`);
                  }
                  widget.low = low;
                  widget.high = high;
                }
              }
            }
          }

          if (tag === "button" && !widget.actionType) {
            widget.actionType = "toggle";
          }
          if (tag === "slider") {
            widget.low ??= 0;
            widget.high ??= 255;
            widget.widgetStyle = attrs.WidgetStyle;
          }

          const map = tag === "button" ? buttons : sliders;
          map.set(exactKey, widget);
          widgets.push(widget);
          continue;
        }

        visit(child, true, parentFrame, framePath);
      }
    }
  };

  visit(parsed, false);
  return { buttons, sliders, widgets };
}
