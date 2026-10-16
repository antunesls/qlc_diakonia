import { describe, expect, it } from "vitest";
import {
  nativeColor,
  nativeFloat,
  nativeFont,
  nativePointF,
  nativeRectF,
  nativeSceneValue,
  nativeStringDoublePair,
  nativeStringIntPair,
  nativeStringStringPair,
  nativeUIntPair,
  nativeVector3D,
  parseNativeSections,
} from "../src/qlc/nativeCodec.js";

describe("QLC+ native typed sections", () => {
  it("lays out SceneValue like NetworkPacketizer::addSection", () => {
    // type 9, fxi (4 bytes BE), channel (2 bytes BE), value (1 byte)
    expect(nativeSceneValue(0x01020304, 0x0506, 0x07).toString("hex")).toBe("0901020304050607");
  });

  it("lays out QColor as opaque 0xAARRGGBB big endian", () => {
    expect(nativeColor(0x00ff8000).toString("hex")).toBe("07ffff8000");
  });

  it("round-trips every typed section", () => {
    const sections = [
      nativeFloat(1.5),
      nativeVector3D(1, 2, 3),
      nativeRectF(10, 20, 300, 400),
      nativePointF(64, 128),
      nativeColor(0xff112233),
      nativeFont("Arial,12,-1,5,50,0,0,0,0,0"),
      nativeSceneValue(7, 3, 255),
      nativeUIntPair(42, 3),
      nativeStringIntPair("speed", 12),
      nativeStringDoublePair("ratio", 0.25),
      nativeStringStringPair("orientation", "Vertical"),
    ];
    expect(parseNativeSections(Buffer.concat(sections), sections.length)).toEqual([
      1.5,
      { type: "vector3d", x: 1, y: 2, z: 3 },
      { type: "rectf", x: 10, y: 20, width: 300, height: 400 },
      { type: "pointf", x: 64, y: 128 },
      { type: "color", argb: 0xff112233 },
      { type: "font", value: "Arial,12,-1,5,50,0,0,0,0,0" },
      { type: "scenevalue", fixtureId: 7, channel: 3, value: 255 },
      { type: "uintpair", first: 42, second: 3 },
      { type: "stringintpair", first: "speed", second: 12 },
      { type: "stringdoublepair", first: "ratio", second: 0.25 },
      { type: "stringstringpair", first: "orientation", second: "Vertical" },
    ]);
  });

  it("rejects truncated typed sections", () => {
    expect(() => parseNativeSections(nativeSceneValue(1, 2, 3).subarray(0, 5), 1)).toThrow(/Truncated/);
  });
});
