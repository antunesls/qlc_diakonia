import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { initLogger } from "../src/logger.js";
import { Action } from "../src/qlc/actionCodes.js";
import { getNativeClient, initNativeClient, stopNativeClient } from "../src/qlc/nativeClient.js";
import { createRuntimeTools } from "../src/tools/runtimeTools.js";
import { FakeQlcServer } from "./fakeQlcServer.js";

const server = new FakeQlcServer();
const tools = new Map<string, (input: unknown) => Promise<any>>();

async function call(name: string, input: unknown = {}) {
  const result = await tools.get(name)!(input);
  const body: string = result.content?.[0]?.text ?? "";
  if (result.isError) throw new Error(body);
  const start = body.search(/[[{]/);
  return start >= 0 ? JSON.parse(body.slice(start)) : body;
}

/** A definition large enough to need several NetCommandResult chunks */
function bigDefinition() {
  const capabilities = Array.from({ length: 400 }, (_, i) => ({
    min: i % 256,
    max: i % 256,
    name: `Macro effect number ${i} with a long descriptive name, ação ✓`,
    preset: "ColorMacro",
    color: "#ff0000",
  }));
  return {
    manufacturer: "Big",
    model: "Wash 1000",
    type: "Moving Head",
    channels: [
      { name: "Pan", preset: "PositionPan", group: "Pan", groupByte: 0 },
      { name: "Tilt", preset: "PositionTilt", group: "Tilt", groupByte: 0 },
      { name: "Dimmer", preset: "IntensityMasterDimmer", group: "Intensity", groupByte: 0 },
      { name: "Macros", group: "Colour", groupByte: 0, capabilities },
    ],
    modes: [{ name: "Standard", channels: ["Pan", "Tilt", "Dimmer", "Macros"], heads: [] }],
  };
}

beforeAll(async () => {
  initLogger({ logLevel: "fatal", transport: "stdio", nodeEnv: "development" } as Config);
  server.forkFeatures = ["project", "fixtureLibrary", "io"];
  server.extended.set(Action.NetFixtureLibraryQuery, (args) => {
    if (args.op === "search") return [{ manufacturer: "Big", model: "Wash 1000", type: "Moving Head" }];
    if (args.op === "get") return args.model.toLowerCase() === "wash 1000" ? bigDefinition() : null;
    throw new Error(`bad op ${args.op}`);
  });
  server.extended.set(Action.NetProjectSave, (args) => {
    if (!args.path) throw new Error("The project has never been saved: a path is required");
    return { path: args.path };
  });
  server.extended.set(Action.NetIOQuery, () => {
    throw new Error("Access denied: this client was not granted the right to perform NetIOQuery");
  });
  const port = await server.start();
  initNativeClient({
    enabled: true,
    host: "127.0.0.1",
    port,
    encryptionKey: "",
    reconnectMs: 50,
    connectTimeoutMs: 1000,
    maximumProjectSize: 1024 * 1024,
    clientName: "extended-test",
    dryRun: false,
    requestTimeoutMs: 2000,
  });
  for (const tool of createRuntimeTools({})) tools.set(tool.name, tool.cb as any);
  const deadline = Date.now() + 3000;
  while (!getNativeClient()!.getState().extendedApi && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
});

afterAll(async () => {
  stopNativeClient();
  await server.stop();
});

describe("extended native API (QLC+ fork)", () => {
  it("uses the server fixture library and reassembles chunked answers", async () => {
    expect(getNativeClient()!.getState().extendedApi?.features).toContain("fixtureLibrary");
    expect(await call("qlc_fixture_library_search", { query: "wash" })).toEqual([
      { manufacturer: "Big", model: "Wash 1000", type: "Moving Head" },
    ]);
    const def = await call("qlc_fixture_definition", { manufacturer: "Big", model: "Wash 1000", withCapabilities: true });
    expect(def.modes[0].channels.map((c: any) => c.role)).toEqual(["pan", "tilt", "master_dimmer", "color_macro"]);
    expect(def.modes[0].channels[3].capabilities).toHaveLength(400);
    expect(def.modes[0].channels[3].capabilities[399]).toContain("ação ✓");
  });

  it("saves the project and relays server errors", async () => {
    expect(await call("qlc_project_save", { path: "C:/shows/test.qxw" })).toEqual({ path: "C:/shows/test.qxw" });
    await expect(call("qlc_project_save", {})).rejects.toThrow(/never been saved/);
    await expect(call("qlc_io_list")).rejects.toThrow(/Access denied/);
  });
});
