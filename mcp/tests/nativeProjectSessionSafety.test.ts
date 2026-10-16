import { afterEach, describe, expect, it } from "vitest";
import {
  NATIVE_DEFAULT_KEY,
  NativeFrameDecoder,
  makeNativePacket,
  nativeByteArray,
  nativeInt,
} from "../src/qlc/nativeCodec.js";
import {
  NET_PROJECT_TRANSFER,
  QlcNativeClient,
} from "../src/qlc/nativeClient.js";
import type { NativeWidget } from "../src/qlc/nativeInventory.js";

const clients: QlcNativeClient[] = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.stop());
});

function createClient(): QlcNativeClient {
  const client = new QlcNativeClient({
    enabled: true,
    host: "127.0.0.1",
    port: 9998,
    encryptionKey: "",
    reconnectMs: 20,
    connectTimeoutMs: 100,
    maximumProjectSize: 1024 * 1024,
    clientName: "session-safety-test",
    dryRun: false,
  });
  clients.push(client);
  return client;
}

function projectFrame(sections: ReturnType<typeof nativeInt>[]) {
  const packet = makeNativePacket(
    NET_PROJECT_TRANSFER,
    NATIVE_DEFAULT_KEY,
    sections,
  );
  return new NativeFrameDecoder(NATIVE_DEFAULT_KEY).push(packet)[0];
}

function startFrame(project: Buffer, chunk: Buffer) {
  return projectFrame([
    nativeInt(0),
    nativeInt(project.length),
    nativeByteArray(chunk),
  ] as ReturnType<typeof nativeInt>[]);
}

function endFrame(chunk: Buffer) {
  return projectFrame([
    nativeInt(2),
    nativeByteArray(chunk),
  ] as ReturnType<typeof nativeInt>[]);
}

function seedReadyInventory(client: QlcNativeClient): void {
  const oldWidget: NativeWidget = {
    id: 17,
    caption: "Old button",
    normalizedCaption: "oldbutton",
    kind: "button",
    actionType: "toggle",
    framePath: [],
  };
  const internals = client as any;
  internals.state.state = "ready";
  internals.state.ready = true;
  internals.state.inventoryLoadedAt = new Date().toISOString();
  internals.state.widgetCount = 1;
  internals.state.buttonCount = 1;
  internals.inventory = {
    buttons: new Map([["old button", oldWidget]]),
    sliders: new Map(),
    widgets: [oldWidget],
  };
}

describe("native project/session safety", () => {
  it("invalidates the old inventory as soon as a replacement project starts", async () => {
    const client = createClient();
    const socket = { destroyed: false } as any;
    const internals = client as any;
    internals.socket = socket;
    seedReadyInventory(client);

    const project = Buffer.from(
      `<Workspace><VirtualConsole><Button ID="21" Caption="New button"/></VirtualConsole></Workspace>`,
    );
    const split = Math.floor(project.length / 2);

    await internals.handleProjectFrame(
      socket,
      startFrame(project, project.subarray(0, split)),
    );

    expect(client.getState()).toMatchObject({
      state: "downloading-project",
      ready: false,
      inventoryLoadedAt: null,
      widgetCount: 0,
      buttonCount: 0,
    });
    expect(client.listWidgets()).toEqual([]);
    await expect(client.pressButton("Old button")).rejects.toThrow(/not ready/);

    await internals.handleProjectFrame(socket, endFrame(project.subarray(split)));

    expect(client.getState()).toMatchObject({
      state: "ready",
      ready: true,
      inventoryGeneration: 1,
      widgetCount: 1,
      buttonCount: 1,
    });
    expect(client.listWidgets()[0]).toMatchObject({
      id: 21,
      caption: "New button",
    });
    internals.socket = null;
  });

  it("does not install a project parsed from a socket that is no longer current", async () => {
    const client = createClient();
    const oldSocket = { destroyed: false } as any;
    const newSocket = { destroyed: false } as any;
    const internals = client as any;
    internals.socket = oldSocket;
    seedReadyInventory(client);

    const project = Buffer.from(
      `<Workspace><VirtualConsole><Button ID="31" Caption="Stale socket"/></VirtualConsole></Workspace>`,
    );

    const parsing = internals.handleProjectFrame(
      oldSocket,
      startFrame(project, project),
    );
    internals.socket = newSocket;
    internals.state.state = "waiting-for-authorization";
    internals.state.ready = false;

    await parsing;

    expect(client.getState().inventoryGeneration).toBe(0);
    expect(client.listWidgets()).toEqual([]);
    internals.socket = null;
  });

  it("does not let an older parse overwrite a newer transfer on the same socket", async () => {
    const client = createClient();
    const socket = { destroyed: false } as any;
    const internals = client as any;
    internals.socket = socket;
    seedReadyInventory(client);

    const firstProject = Buffer.from(
      `<Workspace><VirtualConsole><Button ID="41" Caption="First"/></VirtualConsole></Workspace>`,
    );
    const secondProject = Buffer.from(
      `<Workspace><VirtualConsole><Button ID="42" Caption="Second"/></VirtualConsole></Workspace>`,
    );
    const split = Math.floor(secondProject.length / 2);

    const firstParsing = internals.handleProjectFrame(
      socket,
      startFrame(firstProject, firstProject),
    );
    await internals.handleProjectFrame(
      socket,
      startFrame(secondProject, secondProject.subarray(0, split)),
    );
    await firstParsing;

    expect(client.getState()).toMatchObject({
      state: "downloading-project",
      ready: false,
      inventoryGeneration: 0,
      widgetCount: 0,
    });

    await internals.handleProjectFrame(
      socket,
      endFrame(secondProject.subarray(split)),
    );

    expect(client.getState()).toMatchObject({
      state: "ready",
      inventoryGeneration: 1,
      widgetCount: 1,
    });
    expect(client.listWidgets()[0]).toMatchObject({
      id: 42,
      caption: "Second",
    });
    internals.socket = null;
  });
});
