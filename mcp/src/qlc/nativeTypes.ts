/**
 * Typed QVariant values carried by QLC+ native packets.
 *
 * Mirrors the section type enum of qmlui/tardis/networkpacketizer.h and the
 * byte layout written by NetworkPacketizer::addSection.
 */

export const NativeSectionType = {
  Boolean: 0,
  Integer: 1,
  Float: 2,
  String: 3,
  ByteArray: 4,
  Vector3D: 5,
  RectF: 6,
  Color: 7,
  Font: 8,
  SceneValue: 9,
  UIntPair: 10,
  StringIntPair: 11,
  StringDoublePair: 12,
  StringStringPair: 13,
  PointF: 14,
} as const;

export interface NativeVector3D {
  type: "vector3d";
  x: number;
  y: number;
  z: number;
}
export interface NativeRectF {
  type: "rectf";
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface NativePointF {
  type: "pointf";
  x: number;
  y: number;
}
export interface NativeColor {
  type: "color";
  /** 0xAARRGGBB, as produced by QColor::rgb() */
  argb: number;
}
export interface NativeFont {
  type: "font";
  /** QFont::toString() representation */
  value: string;
}
export interface NativeSceneValue {
  type: "scenevalue";
  fixtureId: number;
  channel: number;
  value: number;
}
export interface NativeUIntPair {
  type: "uintpair";
  first: number;
  second: number;
}
export interface NativeStringIntPair {
  type: "stringintpair";
  first: string;
  second: number;
}
export interface NativeStringDoublePair {
  type: "stringdoublepair";
  first: string;
  second: number;
}
export interface NativeStringStringPair {
  type: "stringstringpair";
  first: string;
  second: string;
}

export type NativeSection =
  | boolean
  | number
  | string
  | Buffer
  | NativeVector3D
  | NativeRectF
  | NativePointF
  | NativeColor
  | NativeFont
  | NativeSceneValue
  | NativeUIntPair
  | NativeStringIntPair
  | NativeStringDoublePair
  | NativeStringStringPair;

function variable(type: number, value: Buffer): Buffer {
  if (value.length > 0xffff)
    throw new Error("QLC+ section exceeds protocol limit");
  const header = Buffer.allocUnsafe(3);
  header[0] = type;
  header.writeUInt16BE(value.length, 1);
  return Buffer.concat([header, value]);
}

function floats(type: number, values: number[]): Buffer {
  const section = Buffer.allocUnsafe(1 + values.length * 4);
  section[0] = type;
  values.forEach((value, index) => section.writeFloatLE(value, 1 + index * 4));
  return section;
}

function lengthPrefixed(value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  if (data.length > 0xffff)
    throw new Error("QLC+ section exceeds protocol limit");
  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(data.length);
  return Buffer.concat([length, data]);
}

export function nativeInt(value: number): Buffer {
  const section = Buffer.allocUnsafe(5);
  section[0] = NativeSectionType.Integer;
  section.writeUInt32BE(value >>> 0, 1);
  return section;
}

export function nativeBoolean(value: boolean): Buffer {
  return Buffer.from([NativeSectionType.Boolean, value ? 1 : 0]);
}

export function nativeString(value: string): Buffer {
  return variable(NativeSectionType.String, Buffer.from(value, "utf8"));
}

export function nativeByteArray(value: Buffer): Buffer {
  return variable(NativeSectionType.ByteArray, value);
}

/** QVariant(float/double): QLC+ always transmits a 32 bit host-order float */
export function nativeFloat(value: number): Buffer {
  return floats(NativeSectionType.Float, [value]);
}

export function nativeVector3D(x: number, y: number, z: number): Buffer {
  return floats(NativeSectionType.Vector3D, [x, y, z]);
}

export function nativeRectF(
  x: number,
  y: number,
  width: number,
  height: number,
): Buffer {
  return floats(NativeSectionType.RectF, [x, y, width, height]);
}

export function nativePointF(x: number, y: number): Buffer {
  return floats(NativeSectionType.PointF, [x, y]);
}

/** @param argb 0xAARRGGBB; the alpha is forced opaque like QColor::rgb() */
export function nativeColor(argb: number): Buffer {
  const section = Buffer.allocUnsafe(5);
  section[0] = NativeSectionType.Color;
  section.writeUInt32BE((argb | 0xff000000) >>> 0, 1);
  return section;
}

export function nativeFont(value: string): Buffer {
  return variable(NativeSectionType.Font, Buffer.from(value, "utf8"));
}

export function nativeSceneValue(
  fixtureId: number,
  channel: number,
  value: number,
): Buffer {
  const section = Buffer.allocUnsafe(8);
  section[0] = NativeSectionType.SceneValue;
  section.writeUInt32BE(fixtureId >>> 0, 1);
  section.writeUInt16BE(channel & 0xffff, 5);
  section[7] = value & 0xff;
  return section;
}

export function nativeUIntPair(first: number, second: number): Buffer {
  const section = Buffer.allocUnsafe(9);
  section[0] = NativeSectionType.UIntPair;
  section.writeUInt32BE(first >>> 0, 1);
  section.writeUInt32BE(second >>> 0, 5);
  return section;
}

export function nativeStringIntPair(first: string, second: number): Buffer {
  const tail = Buffer.allocUnsafe(4);
  tail.writeUInt32BE(second >>> 0);
  return Buffer.concat([
    Buffer.from([NativeSectionType.StringIntPair]),
    lengthPrefixed(first),
    tail,
  ]);
}

export function nativeStringDoublePair(first: string, second: number): Buffer {
  const tail = Buffer.allocUnsafe(8);
  tail.writeDoubleLE(second);
  return Buffer.concat([
    Buffer.from([NativeSectionType.StringDoublePair]),
    lengthPrefixed(first),
    tail,
  ]);
}

export function nativeStringStringPair(first: string, second: string): Buffer {
  return Buffer.concat([
    Buffer.from([NativeSectionType.StringStringPair]),
    lengthPrefixed(first),
    lengthPrefixed(second),
  ]);
}

export function parseNativeSections(
  payload: Buffer,
  count: number,
  requiredPrefixOnly = false,
): NativeSection[] {
  const result: NativeSection[] = [];
  let position = 0;
  const need = (bytes: number, what: string) => {
    if (payload.length - position < bytes)
      throw new Error(`Truncated QLC+ ${what} section`);
  };
  const readFloats = (count: number, what: string): number[] => {
    need(count * 4, what);
    const values = Array.from({ length: count }, (_, index) =>
      payload.readFloatLE(position + index * 4),
    );
    position += count * 4;
    return values;
  };
  const readBytes = (what: string): Buffer => {
    need(2, what);
    const length = payload.readUInt16BE(position);
    position += 2;
    need(length, what);
    const value = payload.subarray(position, position + length);
    position += length;
    return value;
  };
  const readString = (what: string): string =>
    new TextDecoder("utf-8", { fatal: true }).decode(readBytes(what));

  for (let index = 0; index < count; index += 1) {
    if (position >= payload.length)
      throw new Error("Truncated QLC+ section header");
    const type = payload[position++];
    switch (type) {
      case NativeSectionType.Boolean:
        if (position >= payload.length || payload[position] > 1) {
          throw new Error("Invalid QLC+ boolean section");
        }
        result.push(payload[position++] === 1);
        break;
      case NativeSectionType.Integer:
        need(4, "integer");
        result.push(payload.readUInt32BE(position));
        position += 4;
        break;
      case NativeSectionType.Float:
        result.push(readFloats(1, "float")[0]);
        break;
      case NativeSectionType.String:
        result.push(readString("string"));
        break;
      case NativeSectionType.ByteArray:
        result.push(Buffer.from(readBytes("variable")));
        break;
      case NativeSectionType.Vector3D: {
        const [x, y, z] = readFloats(3, "vector3d");
        result.push({ type: "vector3d", x, y, z });
        break;
      }
      case NativeSectionType.RectF: {
        const [x, y, width, height] = readFloats(4, "rectf");
        result.push({ type: "rectf", x, y, width, height });
        break;
      }
      case NativeSectionType.PointF: {
        const [x, y] = readFloats(2, "pointf");
        result.push({ type: "pointf", x, y });
        break;
      }
      case NativeSectionType.Color:
        need(4, "color");
        result.push({ type: "color", argb: payload.readUInt32BE(position) });
        position += 4;
        break;
      case NativeSectionType.Font:
        result.push({ type: "font", value: readString("font") });
        break;
      case NativeSectionType.SceneValue:
        need(7, "scenevalue");
        result.push({
          type: "scenevalue",
          fixtureId: payload.readUInt32BE(position),
          channel: payload.readUInt16BE(position + 4),
          value: payload[position + 6],
        });
        position += 7;
        break;
      case NativeSectionType.UIntPair:
        need(8, "uintpair");
        result.push({
          type: "uintpair",
          first: payload.readUInt32BE(position),
          second: payload.readUInt32BE(position + 4),
        });
        position += 8;
        break;
      case NativeSectionType.StringIntPair: {
        const first = readString("stringintpair");
        need(4, "stringintpair");
        result.push({
          type: "stringintpair",
          first,
          second: payload.readUInt32BE(position),
        });
        position += 4;
        break;
      }
      case NativeSectionType.StringDoublePair: {
        const first = readString("stringdoublepair");
        need(8, "stringdoublepair");
        result.push({
          type: "stringdoublepair",
          first,
          second: payload.readDoubleLE(position),
        });
        position += 8;
        break;
      }
      case NativeSectionType.StringStringPair: {
        const first = readString("stringstringpair");
        const second = readString("stringstringpair");
        result.push({ type: "stringstringpair", first, second });
        break;
      }
      default:
        throw new Error(`Unsupported QLC+ section type ${type}`);
    }
  }
  if (!requiredPrefixOnly && position !== payload.length) {
    throw new Error("QLC+ packet contains trailing section data");
  }
  return result;
}
