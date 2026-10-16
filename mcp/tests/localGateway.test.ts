import {describe, expect, it, vi} from "vitest";
import {GATEWAY_PROTOCOL} from "@infrafast/stage-command-core";
import {QlcLocalCommandGateway} from "../src/tools/lsa_local_gateway.js";
import {createRuntimeTools} from "../src/tools/runtimeTools.js";
import type {QlcNativeClient, NativeRuntimeState} from "../src/qlc/nativeClient.js";
import type {NativeWidget} from "../src/qlc/nativeInventory.js";

function makeButton(caption: string, id = 1): NativeWidget {
  return {
    id,
    caption,
    normalizedCaption: caption.toLowerCase(),
    kind: "button",
    actionType: "toggle",
    framePath: [],
  };
}

function makeClient(options: {
  generation?: number;
  widgets?: NativeWidget[];
  ready?: boolean;
}) {
  let generation = options.generation ?? 7;
  const widgets = options.widgets ?? [makeButton("Blue Speed")];
  const pressButton = vi.fn(async (caption: string) => {
    const found = widgets.find(
      (widget) =>
        widget.kind === "button" &&
        widget.caption.toLowerCase() === caption.toLowerCase(),
    );
    if (!found) throw new Error("not found");
    return found;
  });

  const state = (): NativeRuntimeState => ({
    enabled: true,
    state: options.ready === false ? "downloading-project" : "ready",
    ready: options.ready !== false,
    host: "127.0.0.1",
    localAddress: null,
    port: 9998,
    clientName: "test",
    connectedAt: null,
    authorizedAt: null,
    inventoryLoadedAt: null,
    inventoryGeneration: generation,
    widgetCount: widgets.length,
    buttonCount: widgets.filter((widget) => widget.kind === "button").length,
    sliderCount: 0,
    reconnectCount: 0,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastError: null,
    sentCount: 0,
    lastSentAt: null,
    lastSentWidgetId: null,
    lastSentCaption: null,
  });

  const client = {
    getState: state,
    listWidgets: () => widgets.map((widget) => ({...widget, framePath: [...widget.framePath]})),
    pressButton,
  } as unknown as QlcNativeClient;

  return {
    client,
    pressButton,
    setGeneration(value: number) {
      generation = value;
    },
  };
}

describe("QLC Local deterministic gateway", () => {
  it("accepts and ignores generic host context", () => {
    const fake = makeClient({});
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    const state = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "qlc état",
      context: {
        speaker: {
          name: "Laurent",
          confidence: 0.9,
          backend: "resemblyzer",
        },
      },
    });

    expect(state.status).toBe("ready");
    expect(state.effect).toBe("read");
  });

  it("recognizes state and list as read plans", () => {
    const fake = makeClient({});
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    const state = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "qlc état",
    });
    const list = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "liste tous les contrôles qlc",
    });

    expect(state.status).toBe("ready");
    expect(state.effect).toBe("read");
    expect(list.status).toBe("ready");
    expect(list.effect).toBe("read");
  });

  it("authorizes exact captions case-insensitively while preserving accents", async () => {
    const fake = makeClient({widgets: [makeButton("Été")]});
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    const analyzed = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "qlc été",
    });

    expect(analyzed.status).toBe("ready");
    expect(analyzed.effect).toBe("write");
    if (analyzed.status !== "ready") throw new Error("expected ready");

    const result = await gateway.execute(analyzed.planToken);
    expect(result.ok).toBe(true);
    expect(fake.pressButton).toHaveBeenCalledWith("Été");
  });

  it("treats trailing sentence punctuation as STT syntax, not button identity", async () => {
    const fake = makeClient({
      widgets: [makeButton("Rouge"), makeButton("Blanc", 2), makeButton("Violet", 3)],
    });
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    for (const utterance of ["QLC rouge.", "QLC blanc?", "QLC, violet."]) {
      const analyzed = gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: utterance,
      });
      expect(analyzed.status).toBe("ready");
      if (analyzed.status !== "ready") throw new Error("expected ready");
      expect((await gateway.execute(analyzed.planToken)).ok).toBe(true);
    }

    expect(fake.pressButton).toHaveBeenNthCalledWith(1, "Rouge");
    expect(fake.pressButton).toHaveBeenNthCalledWith(2, "Blanc");
    expect(fake.pressButton).toHaveBeenNthCalledWith(3, "Violet");
  });

  it("prefers a literal punctuation-bearing caption before stripping sentence punctuation", async () => {
    const fake = makeClient({
      widgets: [makeButton("Alert!"), makeButton("Alert", 2)],
    });
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    const analyzed = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "QLC Alert!",
    });
    expect(analyzed.status).toBe("ready");
    if (analyzed.status !== "ready") throw new Error("expected ready");

    expect((await gateway.execute(analyzed.planToken)).ok).toBe(true);
    expect(fake.pressButton).toHaveBeenCalledWith("Alert!");
  });

  it("does not authorize accent or separator mismatches", () => {
    const fake = makeClient({
      widgets: [makeButton("Été"), makeButton("Blue Speed", 2)],
    });
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    const accent = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "qlc Ete",
    });
    const underscore = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "qlc Blue_Speed",
    });

    expect(accent.status).toBe("clarification");
    expect(underscore.status).toBe("clarification");
  });

  it("rejects a write plan after inventory generation changes", async () => {
    const fake = makeClient({});
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    const analyzed = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "qlc Blue Speed",
    });
    if (analyzed.status !== "ready") throw new Error("expected ready");

    fake.setGeneration(8);
    const result = await gateway.execute(analyzed.planToken);

    expect(result).toMatchObject({
      ok: false,
      errorCode: "stale_plan",
    });
    expect(fake.pressButton).not.toHaveBeenCalled();
  });

  it("consumes write plans once", async () => {
    const fake = makeClient({});
    const gateway = new QlcLocalCommandGateway(() => fake.client);

    const analyzed = gateway.analyze({
      protocol: GATEWAY_PROTOCOL,
      text: "qlc Blue Speed",
    });
    if (analyzed.status !== "ready") throw new Error("expected ready");

    expect((await gateway.execute(analyzed.planToken)).ok).toBe(true);
    expect((await gateway.execute(analyzed.planToken)).ok).toBe(false);
    expect(fake.pressButton).toHaveBeenCalledTimes(1);
  });
});

describe("gateway tool inventory", () => {
  it("keeps cloud/ordinary inventory unchanged when gateway is disabled", () => {
    const names = createRuntimeTools({}).map((tool) => tool.name);
    expect(names).toEqual([
      "get_agent_prompt",
      "qlc_get_state",
      "qlc_list_widgets",
      "qlc_button_press",
    ]);
  });

  it("adds exactly two reserved tools when gateway is enabled", () => {
    const names = createRuntimeTools({LSA_LOCAL_COMMAND_GATEWAY: "1"}).map(
      (tool) => tool.name,
    );
    expect(names).toContain("lsa_local_analyze_command");
    expect(names).toContain("lsa_local_execute_command");
    expect(names).toHaveLength(6);
  });
});
