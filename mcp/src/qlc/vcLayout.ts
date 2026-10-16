import type { WidgetSpec, WidgetType } from "./xml/vc.js";

/**
 * Automatic placement for Virtual Console widgets the agent did not position
 * explicitly. Widgets flow left to right in rows, wrapping at the available
 * width or after `columns` items; frames grow to fit their content.
 */

type Geometry = { x?: number; y?: number; width?: number; height?: number };

// interface indirection lets the recursive alias resolve lazily
export interface UnplacedList extends Array<UnplacedWidget> {}

type Unplace<T> = T extends WidgetSpec
  ? Omit<T, "x" | "y" | "width" | "height" | "children"> &
      Geometry & {
        children?: UnplacedList;
        /** Frames: wrap after this many children */
        columns?: number;
      }
  : never;

/** A widget spec whose geometry is still optional */
export type UnplacedWidget = Unplace<WidgetSpec>;

export const DEFAULT_SIZES: Record<WidgetType, { width: number; height: number }> = {
  frame: { width: 300, height: 200 },
  soloframe: { width: 300, height: 200 },
  button: { width: 110, height: 70 },
  slider: { width: 70, height: 220 },
  cuelist: { width: 340, height: 260 },
  speeddial: { width: 210, height: 190 },
  xypad: { width: 240, height: 240 },
  label: { width: 160, height: 40 },
  clock: { width: 160, height: 50 },
  audiotriggers: { width: 320, height: 220 },
  animation: { width: 240, height: 220 },
};

export const GAP = 10;
export const PADDING = 10;
export const FRAME_HEADER = 45;

function defaultSize(widget: UnplacedWidget): { width: number; height: number } {
  if (widget.type === "slider" && (widget as { style?: string }).style === "knob") {
    return { width: 90, height: 110 };
  }
  return DEFAULT_SIZES[widget.type];
}

function isFrame(widget: UnplacedWidget): boolean {
  return widget.type === "frame" || widget.type === "soloframe";
}

/** Flow children inside an area, assigning positions to the ones missing them */
function flow(
  children: WidgetSpec[],
  originX: number,
  originY: number,
  maxWidth: number,
  columns?: number,
): void {
  let x = originX;
  let y = originY;
  let rowHeight = 0;
  let inRow = 0;
  for (const widget of children) {
    if ((widget as Geometry & { _placed?: boolean })._placed) continue;
    const wraps =
      inRow > 0 &&
      ((columns !== undefined && inRow >= columns) ||
        (columns === undefined && x + widget.width > originX + maxWidth));
    if (wraps) {
      x = originX;
      y += rowHeight + GAP;
      rowHeight = 0;
      inRow = 0;
    }
    widget.x = x;
    widget.y = y;
    x += widget.width + GAP;
    rowHeight = Math.max(rowHeight, widget.height);
    inRow += 1;
  }
}

/** Resolve geometry recursively. `maxWidth` bounds the row width of the container. */
export function layoutWidget(widget: UnplacedWidget, maxWidth = 1200): WidgetSpec {
  const size = defaultSize(widget);
  const placed = {
    ...widget,
    x: widget.x ?? 0,
    y: widget.y ?? 0,
    width: widget.width ?? size.width,
    height: widget.height ?? size.height,
    _placed: widget.x !== undefined && widget.y !== undefined,
  } as WidgetSpec & { _placed: boolean; columns?: number };

  if (isFrame(widget)) {
    const frame = placed as Extract<WidgetSpec, { type: "frame" | "soloframe" }> & {
      _placed: boolean;
      columns?: number;
    };
    const showHeader = frame.showHeader ?? true;
    const top = showHeader ? FRAME_HEADER : PADDING;
    const innerWidth = (widget.width ?? maxWidth) - 2 * PADDING;
    frame.children = (widget.children ?? []).map((child) => layoutWidget(child, innerWidth));
    flow(frame.children, PADDING, top, innerWidth, widget.columns);
    if (widget.width === undefined || widget.height === undefined) {
      const right = Math.max(0, ...frame.children.map((c) => c.x + c.width));
      const bottom = Math.max(top, ...frame.children.map((c) => c.y + c.height));
      if (widget.width === undefined) frame.width = Math.max(size.width, right + PADDING);
      if (widget.height === undefined) frame.height = Math.max(size.height / 2, bottom + PADDING);
    }
    delete (frame as { columns?: number }).columns;
  }
  return placed;
}

/**
 * Lay out a list of top-level widgets for a page or an existing frame.
 * `occupiedBottom` keeps new widgets below what is already there.
 */
export function layoutWidgets(
  widgets: UnplacedWidget[],
  options: { originX?: number; originY?: number; maxWidth?: number; columns?: number } = {},
): WidgetSpec[] {
  const maxWidth = options.maxWidth ?? 1200;
  const placed = widgets.map((w) => layoutWidget(w, maxWidth));
  flow(placed, options.originX ?? PADDING, options.originY ?? PADDING, maxWidth, options.columns);
  return placed.map(stripInternal);
}

function stripInternal(widget: WidgetSpec): WidgetSpec {
  const { _placed: _ignored, ...rest } = widget as WidgetSpec & { _placed?: boolean };
  if (rest.type === "frame" || rest.type === "soloframe") {
    return { ...rest, children: rest.children.map(stripInternal) };
  }
  return rest as WidgetSpec;
}

/** QFont::toString for a family/size/bold triple */
export function fontString(family = "Arial", size = 12, bold = false): string {
  return `${family},${size},-1,5,${bold ? 75 : 50},0,0,0,0,0`;
}
