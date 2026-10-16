import net, { type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  NATIVE_DEFAULT_KEY,
  NativeFrameDecoder,
  makeNativePacket,
  nativeByteArray,
  nativeInt,
  nativeString,
  parseNativeSections,
} from "../src/qlc/nativeCodec.js";
import {
  NET_AUTHENTICATION_REPLY,
  NET_PROJECT_TRANSFER,
  QlcNativeClient,
  VC_BUTTON_SET_PRESSED,
} from "../src/qlc/nativeClient.js";
import type { NativeWidget } from "../src/qlc/nativeInventory.js";

const clients: QlcNativeClient[] = [];
const servers: Server[] = [];
const sockets = new Set<net.Socket>();

afterEach(async () => {
  clients.splice(0).forEach((client) => client.stop());
  sockets.forEach((socket) => socket.destroy());
  sockets.clear();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for native client state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("QLC+ native client lifecycle", () => {
  it("sends press-only for Toggle and press/release for Flash", async () => {
    const sent: Buffer[] = [];
    const fakeSocket = {
      destroyed: false,
      write(data: Buffer, callback: (error?: Error) => void) {
        sent.push(Buffer.from(data));
        callback();
        return true;
      },
    };
    const client = new QlcNativeClient({
      enabled: true,
      host: "127.0.0.1",
      port: 9998,
      encryptionKey: "",
      reconnectMs: 20,
      connectTimeoutMs: 100,
      maximumProjectSize: 1024,
      clientName: "test",
      dryRun: false,
    });
    clients.push(client);
    const toggle: NativeWidget = {
      id: 7,
      caption: "Toggle",
      normalizedCaption: "toggle",
      kind: "button",
      actionType: "toggle",
      framePath: [],
    };
    const flash: NativeWidget = {
      ...toggle,
      id: 8,
      caption: "Flash",
      normalizedCaption: "flash",
      actionType: "flash",
    };
    const internals = client as any;
    internals.socket = fakeSocket;
    internals.state.state = "ready";
    internals.state.ready = true;
    internals.inventory = {
      buttons: new Map([
        ["toggle", toggle],
        ["flash", flash],
      ]),
      sliders: new Map(),
      widgets: [toggle, flash],
    };

    await client.pressButton("Toggle");
    expect(sent).toHaveLength(1);
    await client.pressButton("Flash");
    expect(sent).toHaveLength(3);

    const decoded = sent.map((packet) => {
      const frame = new NativeFrameDecoder(NATIVE_DEFAULT_KEY).push(packet)[0];
      expect(frame.opcode).toBe(VC_BUTTON_SET_PRESSED);
      return parseNativeSections(frame.payload, frame.sectionCount);
    });
    expect(decoded).toEqual([
      [7, true],
      [8, true],
      [8, false],
    ]);
    expect(client.getState()).toMatchObject({
      sentCount: 2,
      lastSentWidgetId: 8,
      lastSentCaption: "Flash",
    });
    internals.socket = null;
  });

  it("rejects commands outside ready and wrong widget kinds", async () => {
    const client = new QlcNativeClient({
      enabled: true,
      host: "127.0.0.1",
      port: 9998,
      encryptionKey: "",
      reconnectMs: 20,
      connectTimeoutMs: 100,
      maximumProjectSize: 1024,
      clientName: "test",
      dryRun: false,
    });
    clients.push(client);
    await expect(client.pressButton("Missing")).rejects.toThrow(/not ready/);
    const internals = client as any;
    internals.socket = { destroyed: false };
    internals.state.state = "ready";
    const slider = {
      id: 1,
      caption: "Master",
      normalizedCaption: "master",
      kind: "slider",
      framePath: [],
    };
    internals.inventory = {
      buttons: new Map(),
      sliders: new Map([["master", slider]]),
      widgets: [slider],
    };
    await expect(client.pressButton("Master")).rejects.toThrow(/slider/);
    internals.socket = null;
  });

  it("rejects partial and separator-insensitive button names", async () => {
    const widget: NativeWidget = {
      id: 7,
      caption: "DISCOBRAIN",
      normalizedCaption: "discobrain",
      kind: "button",
      actionType: "toggle",
      framePath: [],
    };
    const client = new QlcNativeClient({
      enabled: true,
      host: "127.0.0.1",
      port: 9998,
      encryptionKey: "",
      reconnectMs: 20,
      connectTimeoutMs: 100,
      maximumProjectSize: 1024,
      clientName: "test",
      dryRun: false,
    });
    clients.push(client);
    const internals = client as any;
    internals.socket = { destroyed: false };
    internals.state.state = "ready";
    internals.inventory = {
      buttons: new Map([["discobrain", widget]]),
      sliders: new Map(),
      widgets: [widget],
    };
    await expect(client.pressButton("disco")).rejects.toThrow(/Exact/);
    await expect(client.pressButton("disco brain")).rejects.toThrow(/Exact/);
    internals.socket = null;
  });

  it("authenticates, loads inventory, invalidates it and reconnects", async () => {
    const project = Buffer.from(
      `<Workspace><VirtualConsole><Button ID="9" Caption="Ready"/></VirtualConsole></Workspace>`,
    );
    let connections = 0;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      connections += 1;
      socket.once("data", () => {
        const auth = makeNativePacket(
          NET_AUTHENTICATION_REPLY,
          NATIVE_DEFAULT_KEY,
          [nativeString("Success"), nativeInt(0x7f)],
        );
        const transfer = makeNativePacket(
          NET_PROJECT_TRANSFER,
          NATIVE_DEFAULT_KEY,
          [nativeInt(0), nativeInt(project.length), nativeByteArray(project)],
        );
        socket.write(Buffer.concat([auth, transfer]));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server address");
    const client = new QlcNativeClient({
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      encryptionKey: "",
      reconnectMs: 20,
      connectTimeoutMs: 500,
      maximumProjectSize: 1024 * 1024,
      clientName: "QLCPlus-MCP-Test",
      dryRun: false,
    });
    clients.push(client);
    client.start();
    await waitFor(() => client.getState().ready);
    expect(client.getState()).toMatchObject({
      state: "ready",
      widgetCount: 1,
      inventoryGeneration: 1,
    });
    expect(client.listWidgets()[0]).toMatchObject({
      id: 9,
      caption: "Ready",
      kind: "button",
    });

    sockets.forEach((socket) => socket.destroy());
    await waitFor(() => connections >= 2 && client.getState().ready);
    expect(client.getState()).toMatchObject({
      state: "ready",
      widgetCount: 1,
      inventoryGeneration: 2,
    });
    expect(connections).toBeGreaterThanOrEqual(2);
  });

  it("dry-run opens no socket", async () => {
    const client = new QlcNativeClient({
      enabled: true,
      host: "127.0.0.1",
      port: 1,
      encryptionKey: "",
      reconnectMs: 20,
      connectTimeoutMs: 100,
      maximumProjectSize: 1024,
      clientName: "dry-run",
      dryRun: true,
    });
    clients.push(client);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.getState().state).toBe("disconnected");
    expect(client.getState().reconnectCount).toBe(0);
  });
});
