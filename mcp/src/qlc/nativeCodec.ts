import { createHash, randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

export const NATIVE_PROTOCOL_ID = Buffer.from([0xe6, 0x86]);
export const NATIVE_HEADER_LENGTH = 7;
export const NATIVE_DEFAULT_KEY = 0x5131632b4e33744bn;
export const MAX_NATIVE_ENCRYPTED_PAYLOAD = 0xffff;
export const MAX_NATIVE_DECRYPTED_PAYLOAD = 1024 * 1024;

export const NativeSectionType = {
  Boolean: 0,
  Integer: 1,
  Float: 2,
  String: 3,
  ByteArray: 4,
} as const;

export type NativeSection = boolean | number | string | Buffer;

export interface NativeFrame {
  opcode: number;
  sectionCount: number;
  payload: Buffer;
}

const CRC_TABLE = [
  0x0000, 0x1081, 0x2102, 0x3183, 0x4204, 0x5285, 0x6306, 0x7387, 0x8408,
  0x9489, 0xa50a, 0xb58b, 0xc60c, 0xd68d, 0xe70e, 0xf78f,
];

export function nativeSessionKey(customKey: string): bigint {
  if (!customKey) return NATIVE_DEFAULT_KEY;
  const digest = createHash("sha256").update(customKey, "utf8").digest();
  return digest.readBigUInt64BE(0);
}

function crc16(data: Buffer): number {
  let crc = 0xffff;
  for (let value of data) {
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TABLE[(crc ^ value) & 0x0f];
    value >>= 4;
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TABLE[(crc ^ value) & 0x0f];
  }
  return ~crc & 0xffff;
}

function simpleCryptCrc(data: Buffer): number {
  const nul = data.indexOf(0);
  return crc16(nul >= 0 ? data.subarray(0, nul) : data);
}

function keyParts(key: bigint): number[] {
  return Array.from({ length: 8 }, (_, index) =>
    Number((key >> BigInt(index * 8)) & 0xffn),
  );
}

export function encryptNativePayload(
  clearPayload: Buffer,
  key: bigint,
): Buffer {
  let flags = 0;
  let payload = clearPayload;
  const compressedBody = deflateSync(clearPayload, { level: 9 });
  const compressed = Buffer.allocUnsafe(4 + compressedBody.length);
  compressed.writeUInt32BE(clearPayload.length, 0);
  compressedBody.copy(compressed, 4);
  if (compressed.length < clearPayload.length) {
    payload = compressed;
    flags |= 0x01;
  }

  const integrity = Buffer.allocUnsafe(2);
  integrity.writeUInt16BE(simpleCryptCrc(payload));
  flags |= 0x02;
  const data = Buffer.concat([randomBytes(1), integrity, payload]);
  const parts = keyParts(key);
  let previous = 0;
  for (let index = 0; index < data.length; index += 1) {
    const encrypted = data[index] ^ parts[index % 8] ^ previous;
    data[index] = encrypted;
    previous = encrypted;
  }
  return Buffer.concat([Buffer.from([3, flags]), data]);
}

export function decryptNativePayload(
  ciphertext: Buffer,
  key: bigint,
  maximumSize = MAX_NATIVE_DECRYPTED_PAYLOAD,
): Buffer {
  if (ciphertext.length < 3 || ciphertext[0] !== 3) {
    throw new Error("Unsupported QLC+ SimpleCrypt payload");
  }
  const flags = ciphertext[1];
  if ((flags & ~0x07) !== 0 || (flags & 0x02 && flags & 0x04)) {
    throw new Error(
      `Unsupported QLC+ SimpleCrypt flags 0x${flags.toString(16)}`,
    );
  }
  const data = Buffer.from(ciphertext.subarray(2));
  const parts = keyParts(key);
  let previous = 0;
  for (let index = 0; index < data.length; index += 1) {
    const current = data[index];
    data[index] = current ^ previous ^ parts[index % 8];
    previous = current;
  }
  let payload = data.subarray(1);
  if (flags & 0x02) {
    if (payload.length < 2) throw new Error("Truncated QLC+ SimpleCrypt CRC");
    const expected = payload.readUInt16BE(0);
    payload = payload.subarray(2);
    if (simpleCryptCrc(payload) !== expected) {
      throw new Error("QLC+ SimpleCrypt CRC mismatch");
    }
  } else if (flags & 0x04) {
    if (payload.length < 20)
      throw new Error("Truncated QLC+ SimpleCrypt SHA-1");
    const expected = payload.subarray(0, 20);
    payload = payload.subarray(20);
    const actual = createHash("sha1").update(payload).digest();
    if (!actual.equals(expected))
      throw new Error("QLC+ SimpleCrypt SHA-1 mismatch");
  }
  if (flags & 0x01) {
    if (payload.length < 4)
      throw new Error("Truncated QLC+ compressed payload");
    const expectedSize = payload.readUInt32BE(0);
    if (expectedSize > maximumSize)
      throw new Error("QLC+ payload exceeds safe limit");
    const inflated = inflateSync(payload.subarray(4), {
      maxOutputLength: maximumSize + 1,
    });
    if (inflated.length !== expectedSize || inflated.length > maximumSize) {
      throw new Error("QLC+ compressed payload size mismatch");
    }
    return inflated;
  }
  if (payload.length > maximumSize)
    throw new Error("QLC+ payload exceeds safe limit");
  return Buffer.from(payload);
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
  return nativeVariableSection(
    NativeSectionType.String,
    Buffer.from(value, "utf8"),
  );
}

export function nativeByteArray(value: Buffer): Buffer {
  return nativeVariableSection(NativeSectionType.ByteArray, value);
}

function nativeVariableSection(type: number, value: Buffer): Buffer {
  if (value.length > 0xffff)
    throw new Error("QLC+ section exceeds protocol limit");
  const header = Buffer.allocUnsafe(3);
  header[0] = type;
  header.writeUInt16BE(value.length, 1);
  return Buffer.concat([header, value]);
}

export function makeNativePacket(
  opcode: number,
  key: bigint,
  sections: Buffer[],
): Buffer {
  if (sections.length > 0xff) throw new Error("Too many QLC+ packet sections");
  const encrypted = encryptNativePayload(Buffer.concat(sections), key);
  if (encrypted.length > MAX_NATIVE_ENCRYPTED_PAYLOAD) {
    throw new Error("QLC+ encrypted packet exceeds protocol limit");
  }
  const header = Buffer.allocUnsafe(NATIVE_HEADER_LENGTH);
  NATIVE_PROTOCOL_ID.copy(header, 0);
  header.writeUInt16BE(opcode, 2);
  header[4] = sections.length;
  header.writeUInt16BE(encrypted.length, 5);
  return Buffer.concat([header, encrypted]);
}

export function parseNativeSections(
  payload: Buffer,
  count: number,
  requiredPrefixOnly = false,
): NativeSection[] {
  const result: NativeSection[] = [];
  let position = 0;
  for (let index = 0; index < count; index += 1) {
    if (position >= payload.length)
      throw new Error("Truncated QLC+ section header");
    const type = payload[position++];
    if (type === NativeSectionType.Boolean) {
      if (position >= payload.length || payload[position] > 1) {
        throw new Error("Invalid QLC+ boolean section");
      }
      result.push(payload[position++] === 1);
    } else if (type === NativeSectionType.Integer) {
      if (payload.length - position < 4)
        throw new Error("Truncated QLC+ integer section");
      result.push(payload.readUInt32BE(position));
      position += 4;
    } else if (type === NativeSectionType.Float) {
      if (payload.length - position < 4)
        throw new Error("Truncated QLC+ float section");
      result.push(payload.readFloatLE(position));
      position += 4;
    } else if (
      type === NativeSectionType.String ||
      type === NativeSectionType.ByteArray
    ) {
      if (payload.length - position < 2)
        throw new Error("Truncated QLC+ variable section");
      const length = payload.readUInt16BE(position);
      position += 2;
      if (payload.length - position < length)
        throw new Error("Truncated QLC+ section payload");
      const value = payload.subarray(position, position + length);
      position += length;
      result.push(
        type === NativeSectionType.String
          ? new TextDecoder("utf-8", { fatal: true }).decode(value)
          : Buffer.from(value),
      );
    } else {
      throw new Error(`Unsupported QLC+ section type ${type}`);
    }
  }
  if (!requiredPrefixOnly && position !== payload.length) {
    throw new Error("QLC+ packet contains trailing section data");
  }
  return result;
}

export class NativeFrameDecoder {
  private buffer = Buffer.alloc(0);

  constructor(private readonly key: bigint) {}

  push(chunk: Buffer): NativeFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: NativeFrame[] = [];
    while (this.buffer.length >= NATIVE_HEADER_LENGTH) {
      if (!this.buffer.subarray(0, 2).equals(NATIVE_PROTOCOL_ID)) {
        this.buffer = Buffer.alloc(0);
        throw new Error("Invalid QLC+ native packet header");
      }
      const encryptedLength = this.buffer.readUInt16BE(5);
      if (encryptedLength < 3)
        throw new Error("Invalid QLC+ encrypted payload length");
      const frameLength = NATIVE_HEADER_LENGTH + encryptedLength;
      if (this.buffer.length < frameLength) break;
      const encrypted = this.buffer.subarray(NATIVE_HEADER_LENGTH, frameLength);
      frames.push({
        opcode: this.buffer.readUInt16BE(2),
        sectionCount: this.buffer[4],
        payload: decryptNativePayload(encrypted, this.key),
      });
      this.buffer = this.buffer.subarray(frameLength);
    }
    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
