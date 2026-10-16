/**
 * Color parsing for agent input. Accepts hex (#RGB, #RRGGBB, #AARRGGBB),
 * rgb(r,g,b) and common color names in English and Portuguese.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const NAMED: Record<string, string> = {
  black: "#000000",
  preto: "#000000",
  white: "#ffffff",
  branco: "#ffffff",
  red: "#ff0000",
  vermelho: "#ff0000",
  green: "#00ff00",
  verde: "#00ff00",
  blue: "#0000ff",
  azul: "#0000ff",
  yellow: "#ffff00",
  amarelo: "#ffff00",
  cyan: "#00ffff",
  ciano: "#00ffff",
  magenta: "#ff00ff",
  purple: "#8000ff",
  roxo: "#8000ff",
  violet: "#8f00ff",
  violeta: "#8f00ff",
  orange: "#ff8000",
  laranja: "#ff8000",
  amber: "#ffbf00",
  ambar: "#ffbf00",
  pink: "#ff69b4",
  rosa: "#ff69b4",
  lime: "#bfff00",
  teal: "#008080",
  gold: "#ffd700",
  dourado: "#ffd700",
  "warm white": "#ffd8a8",
  "branco quente": "#ffd8a8",
  "cold white": "#e0f0ff",
  "branco frio": "#e0f0ff",
  uv: "#6a00ff",
  indigo: "#4b0082",
};

function stripAccents(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** @returns 0xAARRGGBB with opaque alpha */
export function parseColor(input: string | number): number {
  if (typeof input === "number") return (input | 0xff000000) >>> 0;
  const raw = stripAccents(input.trim().toLowerCase());
  const named = NAMED[raw];
  const value = named ?? raw;

  const rgbMatch = value.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/,
  );
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1).map((part) => Math.min(255, Number(part)));
    return rgbToArgb({ r, g, b });
  }

  let hex = value.startsWith("#") ? value.slice(1) : value;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    hex = hex
      .split("")
      .map((digit) => digit + digit)
      .join("");
  }
  if (/^[0-9a-f]{6}$/.test(hex)) return (0xff000000 | parseInt(hex, 16)) >>> 0;
  if (/^[0-9a-f]{8}$/.test(hex)) return parseInt(hex, 16) >>> 0;
  throw new Error(
    `Unrecognized color '${input}'. Use #RRGGBB, rgb(r,g,b) or a common color name.`,
  );
}

export function argbToRgb(argb: number): Rgb {
  return { r: (argb >>> 16) & 0xff, g: (argb >>> 8) & 0xff, b: argb & 0xff };
}

export function rgbToArgb({ r, g, b }: Rgb): number {
  return (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
}

export function argbToHex(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
