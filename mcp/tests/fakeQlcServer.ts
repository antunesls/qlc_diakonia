import net, { type Server, type Socket } from "node:net";
import { Action } from "../src/qlc/actionCodes.js";
import {
  NATIVE_DEFAULT_KEY,
  NativeFrameDecoder,
  makeNativePacket,
  nativeBoolean,
  nativeByteArray,
  nativeInt,
  nativeString,
  parseNativeSections,
  type NativeSection,
} from "../src/qlc/nativeCodec.js";

/**
 * Minimal emulation of the QLC+ 5 native server: it applies the buffered
 * creation/deletion actions the way Tardis::processBufferedAction does (an
 * object whose ID already exists is silently ignored) and serves the
 * resulting workspace on NetProjectRequest.
 */
export interface ReceivedAction {
  code: number;
  objectId: number;
  sections: NativeSection[];
}

interface Widget {
  id: number;
  parentId: number;
  xml: string;
}

export class FakeQlcServer {
  readonly received: ReceivedAction[] = [];
  readonly fixtures = new Map<number, string>();
  readonly groups = new Map<number, string>();
  readonly functions = new Map<number, string>();
  readonly widgets: Widget[] = [];
  readonly pages = [{ id: 0, caption: "Page 1" }];
  /** When set, answer NetApiInfo like the QLC+ fork does */
  forkFeatures: string[] | null = null;
  /** Extended API handlers: return a JSON value, or throw to answer with an error */
  readonly extended = new Map<number, (args: any) => unknown>();
  private server: Server | null = null;
  private sockets = new Set<Socket>();

  async start(): Promise<number> {
    this.server = net.createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    return address.port;
  }

  async stop(): Promise<void> {
    this.sockets.forEach((s) => s.destroy());
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  actions(code: number): ReceivedAction[] {
    return this.received.filter((a) => a.code === code);
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    const decoder = new NativeFrameDecoder(NATIVE_DEFAULT_KEY);
    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const sections = parseNativeSections(frame.payload, frame.sectionCount);
        this.handle(socket, frame.opcode, sections);
      }
    });
  }

  private send(socket: Socket, code: number, sections: Buffer[]): void {
    socket.write(makeNativePacket(code, NATIVE_DEFAULT_KEY, sections));
  }

  private sendProject(socket: Socket): void {
    const data = Buffer.from(this.workspace(), "utf8");
    const chunk = 30_000;
    for (let offset = 0, n = 0; offset < data.length || n === 0; offset += chunk, n += 1) {
      const part = data.subarray(offset, offset + chunk);
      const head =
        n === 0
          ? [nativeInt(0), nativeInt(data.length)]
          : [nativeInt(part.length < chunk ? 2 : 1)];
      this.send(socket, Action.NetProjectTransfer, [...head, nativeByteArray(part)]);
    }
  }

  /** NetworkManager::sendCommandResult: 20000-character chunks */
  private reply(socket: Socket, requestId: number, success: boolean, payload: string): void {
    const chunks = payload.match(/[\s\S]{1,20000}/g) ?? [""];
    chunks.forEach((chunk, index) =>
      this.send(socket, Action.NetCommandResult, [
        nativeInt(requestId),
        nativeBoolean(success),
        nativeInt(index),
        nativeInt(chunks.length),
        nativeString(chunk),
      ]),
    );
  }

  private handle(socket: Socket, code: number, sections: NativeSection[]): void {
    if (code === Action.NetAuthentication) {
      this.send(socket, Action.NetAuthenticationReply, [nativeString("Success"), nativeInt(0x7f)]);
      this.sendProject(socket);
      return;
    }
    if (code === Action.NetProjectRequest) {
      this.sendProject(socket);
      return;
    }
    if (code === Action.NetApiInfo) {
      if (this.forkFeatures) {
        this.reply(socket, sections[0] as number, true, JSON.stringify({ version: "5.x-test", apiLevel: 1, features: this.forkFeatures, accessMask: 0xff }));
      }
      return;
    }
    const handler = this.extended.get(code);
    if (handler) {
      try {
        const value = handler(JSON.parse(String(sections[1])));
        this.reply(socket, sections[0] as number, true, JSON.stringify(value ?? null));
      } catch (error) {
        this.reply(socket, sections[0] as number, false, (error as Error).message);
      }
      return;
    }

    const objectId = sections[0] as number;
    this.received.push({ code, objectId, sections: sections.slice(1) });
    const xml = Buffer.isBuffer(sections[1]) ? sections[1].toString("utf8") : "";
    const attrId = Number(xml.match(/^<\w+[^>]*\sID="(\d+)"/)?.[1]);

    switch (code) {
      case Action.FixtureCreate: {
        const id = Number(xml.match(/<ID>(\d+)<\/ID>/)?.[1]);
        if (!this.fixtures.has(id)) this.fixtures.set(id, xml);
        break;
      }
      case Action.FixtureDelete:
        this.fixtures.delete(objectId);
        break;
      case Action.FixtureGroupCreate:
        if (!this.groups.has(attrId)) this.groups.set(attrId, xml);
        break;
      case Action.FunctionCreate:
        if (!this.functions.has(attrId)) this.functions.set(attrId, xml);
        break;
      case Action.FunctionDelete:
        this.functions.delete(objectId);
        // Chaser/Collection::slotFunctionRemoved drop every step using it
        for (const [id, fn] of this.functions) {
          this.functions.set(id, this.editSteps(fn, (steps) => steps.filter((s) => s.text !== String(objectId))));
        }
        break;
      case Action.ChaserAddStep: {
        const fn = this.functions.get(objectId);
        const number = Number(xml.match(/Number="(\d+)"/)?.[1] ?? 0);
        if (fn) this.functions.set(objectId, this.editSteps(fn, (steps) => {
          steps.splice(number, 0, { xml, text: xml.match(/>([^<]*)</)?.[1] ?? "" });
          return steps;
        }));
        break;
      }
      case Action.CollectionAddFunction: {
        const fn = this.functions.get(objectId);
        const pair = sections[1] as { first: number; second: number };
        if (fn) this.functions.set(objectId, this.editSteps(fn, (steps) => {
          steps.splice(pair.second, 0, { xml: `<Step Number="0">${pair.first}</Step>`, text: String(pair.first) });
          return steps;
        }));
        break;
      }
      case Action.SceneSetChannelValue: {
        const v = sections[1] as { fixtureId: number; channel: number; value: number };
        this.editScene(objectId, v.fixtureId, (pairs) => pairs.set(v.channel, v.value));
        break;
      }
      case Action.SceneAddFixture: {
        const v = sections[1] as { fixtureId: number };
        this.editScene(objectId, v.fixtureId, () => undefined);
        break;
      }
      case Action.SceneRemoveFixture: {
        const v = sections[1] as { fixtureId: number };
        const fn = this.functions.get(objectId);
        if (fn) {
          this.functions.set(
            objectId,
            fn.replace(new RegExp(`\\s*<FixtureVal ID="${v.fixtureId}"(?:/>|>[^<]*</FixtureVal>)`), ""),
          );
        }
        break;
      }
      case Action.FunctionSetName: {
        const fn = this.functions.get(objectId);
        if (fn) this.functions.set(objectId, fn.replace(/ Name="[^"]*"/, ` Name="${sections[1]}"`));
        break;
      }
      case Action.VCWidgetCreate: {
        const parentExists = this.pages.some((p) => p.id === objectId) || this.widgets.some((w) => w.id === objectId);
        if (parentExists) this.addWidgetTree(objectId, xml);
        break;
      }
      case Action.VCWidgetDelete:
        this.deleteWidget(attrId);
        break;
      case Action.VCWidgetCaption: {
        const widget = this.widgets.find((w) => w.id === objectId);
        if (widget) widget.xml = widget.xml.replace(/ Caption="[^"]*"/, ` Caption="${sections[1]}"`);
        break;
      }
    }
  }

  private editSteps(
    fn: string,
    edit: (steps: { xml: string; text: string }[]) => { xml: string; text: string }[],
  ): string {
    const pattern = /<Step\b[^>]*>([^<]*)<\/Step>/g;
    const steps = [...fn.matchAll(pattern)].map((m) => ({ xml: m[0], text: m[1].trim() }));
    if (!steps.length && !/Type="(Chaser|Collection)"/.test(fn)) return fn;
    const next = edit(steps).map((s, index) => s.xml.replace(/Number="\d+"/, `Number="${index}"`));
    const stripped = fn.replace(/\s*<Step\b[^>]*>[^<]*<\/Step>/g, "");
    const close = stripped.lastIndexOf("</Function>");
    return `${stripped.slice(0, close)}${next.join("\n")}${stripped.slice(close)}`;
  }

  private editScene(sceneId: number, fixtureId: number, edit: (pairs: Map<number, number>) => void): void {
    const fn = this.functions.get(sceneId);
    if (!fn) return;
    const pattern = new RegExp(`<FixtureVal ID="${fixtureId}"(?:/>|>([^<]*)</FixtureVal>)`);
    const match = fn.match(pattern);
    const parts = (match?.[1] ?? "").split(",").filter(Boolean).map(Number);
    const pairs = new Map<number, number>();
    for (let i = 0; i + 1 < parts.length; i += 2) pairs.set(parts[i], parts[i + 1]);
    edit(pairs);
    const text = [...pairs.entries()].sort(([a], [b]) => a - b).map(([c, v]) => `${c},${v}`).join(",");
    const element = text ? `<FixtureVal ID="${fixtureId}">${text}</FixtureVal>` : `<FixtureVal ID="${fixtureId}"/>`;
    if (match) {
      this.functions.set(sceneId, fn.replace(pattern, element));
    } else {
      const close = fn.lastIndexOf("</Function>");
      this.functions.set(sceneId, `${fn.slice(0, close)}${element}${fn.slice(close)}`);
    }
  }

  /** Nested widgets of a fragment are kept inside the fragment itself */
  private addWidgetTree(parentId: number, xml: string): void {
    const ids = [...xml.matchAll(/<(?:Frame|SoloFrame|Button|Slider|CueList|SpeedDial|XYPad|Label|Clock|AudioTriggers|Matrix)\b[^>]*\sID="(\d+)"/g)].map((m) => Number(m[1]));
    if (ids.some((id) => this.widgets.some((w) => w.id === id))) return;
    this.widgets.push({ id: ids[0], parentId, xml });
  }

  private deleteWidget(id: number): void {
    const index = this.widgets.findIndex((w) => w.id === id);
    if (index < 0) return;
    this.widgets.splice(index, 1);
    for (const child of this.widgets.filter((w) => w.parentId === id)) this.deleteWidget(child.id);
  }

  private renderWidget(widget: Widget): string {
    const children = this.widgets.filter((w) => w.parentId === widget.id).map((w) => this.renderWidget(w));
    if (!children.length) return widget.xml;
    const close = widget.xml.lastIndexOf("</");
    return `${widget.xml.slice(0, close)}${children.join("\n")}${widget.xml.slice(close)}`;
  }

  workspace(): string {
    const pages = this.pages
      .map((page) => {
        const children = this.widgets.filter((w) => w.parentId === page.id).map((w) => this.renderWidget(w));
        return `<Frame Caption="${page.caption}" ID="${page.id}"><WindowState Visible="True" X="0" Y="0" Width="1920" Height="1080"/>${children.join("\n")}</Frame>`;
      })
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Workspace>
<Workspace xmlns="http://www.qlcplus.org/Workspace">
<Engine>
<InputOutputMap><Universe Name="Universe 1" ID="0"/></InputOutputMap>
${[...this.fixtures.values()].join("\n")}
${[...this.groups.values()].join("\n")}
${[...this.functions.values()].join("\n")}
</Engine>
<VirtualConsole>
${pages}
</VirtualConsole>
</Workspace>`;
  }
}
