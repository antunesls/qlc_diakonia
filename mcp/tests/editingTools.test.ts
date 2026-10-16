import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initLogger } from "../src/logger.js";
import type { Config } from "../src/config.js";
import { Action } from "../src/qlc/actionCodes.js";
import { configureFixtureDirectories } from "../src/qlc/libraryProvider.js";
import { getNativeClient, initNativeClient, stopNativeClient } from "../src/qlc/nativeClient.js";
import { createRuntimeTools } from "../src/tools/runtimeTools.js";
import { FakeQlcServer } from "./fakeQlcServer.js";

const RGBW_PAR = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE FixtureDefinition>
<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Manufacturer>Test</Manufacturer>
 <Model>RGBW Par</Model>
 <Type>Color Changer</Type>
 <Channel Name="Dimmer" Preset="IntensityMasterDimmer"/>
 <Channel Name="Red" Preset="IntensityRed"/>
 <Channel Name="Green" Preset="IntensityGreen"/>
 <Channel Name="Blue" Preset="IntensityBlue"/>
 <Channel Name="White" Preset="IntensityWhite"/>
 <Channel Name="Strobe"><Group Byte="0">Shutter</Group>
  <Capability Min="0" Max="9" Preset="ShutterOpen">Open</Capability>
  <Capability Min="10" Max="255" Preset="StrobeSlowToFast">Strobe</Capability>
 </Channel>
 <Mode Name="6 Channel">
  <Channel Number="0">Dimmer</Channel><Channel Number="1">Red</Channel>
  <Channel Number="2">Green</Channel><Channel Number="3">Blue</Channel>
  <Channel Number="4">White</Channel><Channel Number="5">Strobe</Channel>
 </Mode>
</FixtureDefinition>`;

const server = new FakeQlcServer();
const tools = new Map<string, (input: unknown) => Promise<any>>();
let fixtureDir: string;

async function call(name: string, input: unknown = {}) {
  const fn = tools.get(name);
  if (!fn) throw new Error(`no tool ${name}`);
  const result = await fn(input);
  const body = result.content?.[0]?.text ?? "";
  if (result.isError) throw new Error(body);
  const jsonStart = body.indexOf("{") >= 0 && (body.indexOf("[") < 0 || body.indexOf("{") < body.indexOf("[")) ? body.indexOf("{") : body.indexOf("[");
  return jsonStart >= 0 ? JSON.parse(body.slice(jsonStart)) : body;
}

async function until(predicate: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  initLogger({ logLevel: "fatal", transport: "stdio", nodeEnv: "development" } as Config);
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "qlc-fixtures-"));
  fs.mkdirSync(path.join(fixtureDir, "Test"));
  fs.writeFileSync(path.join(fixtureDir, "Test", "Test-RGBW-Par.qxf"), RGBW_PAR);
  configureFixtureDirectories([fixtureDir]);

  server.forkFeatures = ["project"];
  const port = await server.start();
  initNativeClient({
    enabled: true,
    host: "127.0.0.1",
    port,
    encryptionKey: "",
    reconnectMs: 50,
    connectTimeoutMs: 1000,
    maximumProjectSize: 4 * 1024 * 1024,
    clientName: "editing-test",
    dryRun: false,
    requestTimeoutMs: 2000,
  });
  for (const tool of createRuntimeTools({})) tools.set(tool.name, tool.cb as any);
  await until(() => getNativeClient()!.getState().ready);
});

afterAll(async () => {
  stopNativeClient();
  await server.stop();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe("editing tools against an emulated QLC+ server", () => {
  it("detects the extended API of the fork", async () => {
    await until(() => getNativeClient()!.getState().extendedApi !== null);
    expect(getNativeClient()!.getState().extendedApi?.features).toEqual(["project"]);
  });

  it("patches fixtures back to back from the library", async () => {
    const result = await call("qlc_fixture_add", { manufacturer: "test", model: "rgbw par", name: "PAR {n}", count: 4 });
    expect(result.fixtures).toEqual([
      { id: 0, name: "PAR 1", universe: 1, address: 1 },
      { id: 1, name: "PAR 2", universe: 1, address: 7 },
      { id: 2, name: "PAR 3", universe: 1, address: 13 },
      { id: 3, name: "PAR 4", universe: 1, address: 19 },
    ]);
    await expect(call("qlc_fixture_add", { manufacturer: "Test", model: "RGBW Par", address: 3 })).rejects.toThrow(/overlaps/);
  });

  it("creates scenes from looks, a chaser and a group", async () => {
    const red = await call("qlc_scene_set", { name: "Red", looks: [{ fixtures: ["PAR 1", "PAR 2", 2, 3], color: "red" }] });
    const blue = await call("qlc_scene_set", { name: "Blue", fadeIn: 300, looks: [{ fixtures: [0, 1, 2, 3], color: "blue", dimmer: 60 }] });
    expect([red.functionId, blue.functionId]).toEqual([0, 1]);
    const model = getNativeClient()!.getModel();
    expect(model.functions.find((f) => f.id === 0)?.values?.filter((v) => v.fixtureId === 0)).toEqual([
      { fixtureId: 0, channel: 0, value: 255 },
      { fixtureId: 0, channel: 1, value: 255 },
      { fixtureId: 0, channel: 2, value: 0 },
      { fixtureId: 0, channel: 3, value: 0 },
      { fixtureId: 0, channel: 5, value: 0 },
    ]);

    const chaser = await call("qlc_chaser_set", { name: "Red/Blue", duration: 1000, steps: [{ function: "Red" }, { function: "Blue" }] });
    expect(chaser.functionId).toBe(2);
    const group = await call("qlc_fixture_group_create", { name: "All pars", fixtures: [0, 1, 2, 3], columns: 4 });
    expect(group.groupId).toBe(0);
    await call("qlc_rgbmatrix_set", { name: "Waves", group: "All pars", algorithm: "Waves", colors: ["red", "blue"] });
    await call("qlc_collection_set", { name: "Both", functions: ["Red", "Waves"] });
  });

  it("builds a Virtual Console declaratively", async () => {
    const result = await call("qlc_vc_build", {
      widgets: [
        {
          type: "frame",
          caption: "Colors",
          columns: 3,
          children: [
            { type: "button", caption: "Red", function: "Red", backgroundColor: "red" },
            { type: "button", caption: "Blue", function: "Blue", backgroundColor: "blue" },
            { type: "button", caption: "Chase", function: "Red/Blue", action: "flash" },
            { type: "slider", caption: "Master", fixtures: [0, 1, 2, 3] },
          ],
        },
        { type: "cuelist", caption: "Cues", chaser: "Red/Blue" },
      ],
    });
    expect(result.widgets.map((w: any) => w.caption)).toEqual(["Colors", "Red", "Blue", "Chase", "Master", "Cues"]);
    const tree = await call("qlc_vc_tree");
    const colors = tree[0].children[0];
    expect(colors).toMatchObject({ caption: "Colors", type: "frame" });
    expect(colors.children.map((c: any) => [c.caption, c.function])).toEqual([
      ["Red", "Red"],
      ["Blue", "Blue"],
      ["Chase", "Red/Blue"],
      ["Master", undefined],
    ]);
    const slider = getNativeClient()!.getModel().vcWidgets.find((w) => w.caption === "Master");
    expect(slider?.levelChannels).toEqual([0, 1, 2, 3].map((fixtureId) => ({ fixtureId, channel: 0 })));
  });

  it("updates a scene in place, keeping chaser references", async () => {
    await call("qlc_scene_set", { name: "Red", replace: "Red", looks: [{ fixtures: [0, 1], color: "red" }] });
    const model = getNativeClient()!.getModel();
    const red = model.functions.find((f) => f.name === "Red")!;
    expect(red.id).toBe(0);
    expect(red.sceneFixtures).toEqual([0, 1]);
    expect(server.actions(Action.FunctionDelete)).toHaveLength(0);
    expect(model.functions.find((f) => f.name === "Red/Blue")?.steps?.map((s) => s.functionId)).toEqual([0, 1]);
  });

  it("replaces a function that others use and restores the references", async () => {
    const waves = getNativeClient()!.getModel().functions.find((f) => f.name === "Waves")!;
    await call("qlc_rgbmatrix_set", { name: "Fire", replace: "Waves", group: 0, algorithm: "Fire" });
    const model = getNativeClient()!.getModel();
    const fire = model.functions.find((f) => f.id === waves.id)!;
    expect(fire).toMatchObject({ name: "Fire", algorithm: "Fire" });
    expect(model.functions.find((f) => f.name === "Both")?.functionIds).toEqual([0, waves.id]);
  });

  it("runs live commands without refreshing the project", async () => {
    const before = server.actions(Action.FunctionStart).length;
    await call("qlc_function_start", { functions: ["Red"] });
    const button = getNativeClient()!.getModel().vcWidgets.find((w) => w.caption === "Blue")!;
    await call("qlc_button_press", { widgetId: button.id });
    await call("qlc_slider_set", { widget: "Master", percent: 50 });
    await until(() => server.actions(Action.VCSliderSetValue).length === 1);
    expect(server.actions(Action.FunctionStart)).toHaveLength(before + 1);
    expect(server.actions(Action.VCButtonSetPressed)[0]).toMatchObject({ objectId: button.id, sections: [true] });
    expect(server.actions(Action.VCSliderSetValue)[0].sections).toEqual([128]);
  });

  it("deletes widgets and functions", async () => {
    await call("qlc_vc_widget_delete", { widgets: ["Colors"] });
    expect(getNativeClient()!.getModel().vcWidgets.map((w) => w.caption)).toEqual(["Cues"]);
    await call("qlc_function_delete", { functions: ["Blue"] });
    const chaser = getNativeClient()!.getModel().functions.find((f) => f.name === "Red/Blue");
    expect(chaser?.steps?.map((s) => s.functionId)).toEqual([0]);
  });

  it("reports fork-only tools clearly on stock features", async () => {
    await expect(call("qlc_io_list")).rejects.toThrow(/fork/);
  });
});
