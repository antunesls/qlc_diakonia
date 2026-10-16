import { describe, expect, it } from "vitest";
import {
  NATIVE_DEFAULT_KEY,
  NativeFrameDecoder,
  decryptNativePayload,
  makeNativePacket,
  nativeBoolean,
  nativeInt,
  parseNativeSections,
} from "../src/qlc/nativeCodec.js";

describe("QLC+ native codec", () => {
  it("decodes the fixed QLC+ SimpleCrypt vector validated by OculizerQLC", () => {
    const packet = Buffer.from("e686f20002000c030211844609224170662d58", "hex");
    const decoder = new NativeFrameDecoder(NATIVE_DEFAULT_KEY);
    const frames = decoder.push(packet);
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(0xf200);
    expect(
      parseNativeSections(frames[0].payload, frames[0].sectionCount),
    ).toEqual([71, true]);
  });

  it("preserves split and coalesced TCP frames", () => {
    const first = makeNativePacket(0xf200, NATIVE_DEFAULT_KEY, [
      nativeInt(1),
      nativeBoolean(true),
    ]);
    const second = makeNativePacket(0xf200, NATIVE_DEFAULT_KEY, [
      nativeInt(2),
      nativeBoolean(false),
    ]);
    const decoder = new NativeFrameDecoder(NATIVE_DEFAULT_KEY);
    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    const frames = decoder.push(Buffer.concat([first.subarray(3), second]));
    expect(
      frames.map((frame) =>
        parseNativeSections(frame.payload, frame.sectionCount),
      ),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it("rejects malformed ciphertext and invalid headers", () => {
    expect(() =>
      decryptNativePayload(Buffer.from([3, 0]), NATIVE_DEFAULT_KEY),
    ).toThrow();
    expect(() =>
      new NativeFrameDecoder(NATIVE_DEFAULT_KEY).push(Buffer.alloc(7)),
    ).toThrow(/header/);
  });
});
