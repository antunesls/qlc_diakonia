import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNativeClient,
  initNativeClient,
  stopNativeClient,
} from "../src/qlc/nativeClient.js";
import { shutdownStdioRuntime } from "../src/transports/stdio.js";

afterEach(() => {
  stopNativeClient();
  vi.restoreAllMocks();
});

describe("stdio lifecycle hardening", () => {
  it("stops and clears the active native client before exiting", () => {
    const client = initNativeClient({
      enabled: true,
      host: "127.0.0.1",
      port: 9998,
      encryptionKey: "",
      reconnectMs: 20,
      connectTimeoutMs: 100,
      maximumProjectSize: 1024,
      clientName: "lifecycle-test",
      dryRun: true,
    });
    const stopSpy = vi.spyOn(client, "stop");
    let exitCode: number | undefined;

    shutdownStdioRuntime(0, (code) => {
      exitCode = code;
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(getNativeClient()).toBeNull();
    expect(client.getState().state).toBe("stopped");
    expect(exitCode).toBe(0);
  });

  it("keeps SIGINT and SIGTERM wired through the shared process cleanup", () => {
    const source = fs.readFileSync("src/index.ts", "utf8");
    expect(source).toContain('process.once("SIGINT", () => shutdown(0))');
    expect(source).toContain('process.once("SIGTERM", () => shutdown(0))');
  });
});
