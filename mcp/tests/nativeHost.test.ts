import { describe, expect, it } from "vitest";
import {
  loopbackAddressForProcess,
  resolveNativeEndpoint,
} from "../src/qlc/nativeHost.js";

describe("native per-process endpoint", () => {
  it("derives stable and distinct loopback identities", () => {
    expect(loopbackAddressForProcess(7047)).toBe("127.0.27.135");
    expect(loopbackAddressForProcess(8183)).toBe("127.0.31.247");
    expect(resolveNativeEndpoint("127.0.0.1", 15764, "linux")).toEqual({
      host: "127.0.0.1",
      localAddress: "127.0.61.148",
    });
  });

  it("does not force a source address for a remote server", () => {
    expect(resolveNativeEndpoint("192.168.1.10", 42, "linux")).toEqual({
      host: "192.168.1.10",
      localAddress: undefined,
    });
  });

  it("does not bind an undeclared loopback alias on macOS", () => {
    expect(resolveNativeEndpoint("127.0.0.1", 42, "darwin")).toEqual({
      host: "127.0.0.1",
      localAddress: undefined,
    });
  });
});
