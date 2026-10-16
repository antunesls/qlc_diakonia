import net, { type Socket } from "node:net";
import { getLogger } from "../logger.js";
import {
  NativeFrameDecoder,
  makeNativePacket,
  nativeBoolean,
  nativeByteArray,
  nativeInt,
  nativeSessionKey,
  nativeString,
  parseNativeSections,
  type NativeFrame,
} from "./nativeCodec.js";
import {
  exactNativeCaptionKey,
  parseNativeProjectInventory,
  type NativeInventory,
  type NativeWidget,
} from "./nativeInventory.js";
import { resolveNativeEndpoint } from "./nativeHost.js";

export const NET_AUTHENTICATION = 0xff02;
export const NET_AUTHENTICATION_REPLY = 0xff03;
export const NET_PROJECT_TRANSFER = 0xff06;
export const VC_BUTTON_SET_PRESSED = 0xf200;

export type NativeConnectionState =
  | "disabled"
  | "connecting"
  | "waiting-for-authorization"
  | "downloading-project"
  | "ready"
  | "disconnected"
  | "stopped";

export interface NativeClientOptions {
  enabled: boolean;
  host: string;
  port: number;
  encryptionKey: string;
  reconnectMs: number;
  connectTimeoutMs: number;
  maximumProjectSize: number;
  clientName: string;
  dryRun: boolean;
}

export interface NativeRuntimeState {
  enabled: boolean;
  state: NativeConnectionState;
  ready: boolean;
  host: string;
  localAddress: string | null;
  port: number;
  clientName: string;
  connectedAt: string | null;
  authorizedAt: string | null;
  inventoryLoadedAt: string | null;
  inventoryGeneration: number;
  widgetCount: number;
  buttonCount: number;
  sliderCount: number;
  reconnectCount: number;
  lastDisconnectedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  sentCount: number;
  lastSentAt: string | null;
  lastSentWidgetId: number | null;
  lastSentCaption: string | null;
}

const EMPTY_INVENTORY: NativeInventory = {
  buttons: new Map(),
  sliders: new Map(),
  widgets: [],
};

const isoNow = () => new Date().toISOString();
const RECONNECT_LOG_REPEAT_MS = 30_000;

export class QlcNativeClient {
  private socket: Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private decoder;
  private inventory: NativeInventory = EMPTY_INVENTORY;
  private projectChunks: Buffer[] = [];
  private projectLength = 0;
  private expectedProjectSize: number | null = null;
  private projectStarted = false;
  private projectTransferGeneration = 0;
  private state: NativeRuntimeState;
  private lastLoggedError: string | null = null;
  private lastLoggedEndpoint: string | null = null;
  private stateLogTimes = new Map<NativeConnectionState, number>();

  constructor(private readonly options: NativeClientOptions) {
    this.decoder = new NativeFrameDecoder(nativeSessionKey(options.encryptionKey));
    this.state = {
      enabled: options.enabled,
      state: options.enabled ? "disconnected" : "disabled",
      ready: false,
      host: options.host,
      localAddress: null,
      port: options.port,
      clientName: options.clientName,
      connectedAt: null,
      authorizedAt: null,
      inventoryLoadedAt: null,
      inventoryGeneration: 0,
      widgetCount: 0,
      buttonCount: 0,
      sliderCount: 0,
      reconnectCount: 0,
      lastDisconnectedAt: null,
      lastErrorAt: null,
      lastError: null,
      sentCount: 0,
      lastSentAt: null,
      lastSentWidgetId: null,
      lastSentCaption: null,
    };
  }

  start(): void {
    if (!this.options.enabled || this.options.dryRun || this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.reconnectTimer = null;
    this.connectTimer = null;
    this.socket?.destroy();
    this.socket = null;
    this.projectTransferGeneration += 1;
    this.resetProjectTransfer();
    this.invalidateInventory();
    this.setConnectionState("stopped");
  }

  getState(): NativeRuntimeState {
    return { ...this.state };
  }

  listWidgets(): NativeWidget[] {
    return this.inventory.widgets.map((widget) => ({
      ...widget,
      framePath: [...widget.framePath],
    }));
  }

  async pressButton(caption: string): Promise<NativeWidget> {
    if (this.options.dryRun) {
      return {
        id: 0,
        caption,
        normalizedCaption: caption,
        kind: "button",
        actionType: "dry-run",
        framePath: [],
      };
    }

    const socket = this.socket;
    if (this.state.state !== "ready" || !socket || socket.destroyed) {
      throw new Error(
        `QLC+ native session is not ready (state: ${this.state.state})`,
      );
    }

    const exactKey = exactNativeCaptionKey(caption);
    const widget = this.inventory.buttons.get(exactKey);
    if (!widget) {
      if (this.inventory.sliders.has(exactKey)) {
        throw new Error(`QLC+ widget '${caption}' is a slider, not a button`);
      }
      throw new Error(
        `Exact QLC+ button caption '${caption}' was not found in the current project. Spaces, accents, punctuation, underscores and hyphens are significant; matching ignores case only.`,
      );
    }

    await this.writePacket(socket, widget, true);
    if (widget.actionType === "flash") {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      if (
        this.socket !== socket ||
        this.state.state !== "ready" ||
        socket.destroyed
      ) {
        throw new Error("QLC+ native session changed before Flash release");
      }
      await this.writePacket(socket, widget, false);
    }

    this.state.sentCount += 1;
    this.state.lastSentAt = isoNow();
    this.state.lastSentWidgetId = widget.id;
    this.state.lastSentCaption = widget.caption;
    return { ...widget, framePath: [...widget.framePath] };
  }

  private async writePacket(
    socket: Socket,
    widget: NativeWidget,
    pressed: boolean,
  ): Promise<void> {
    const packet = makeNativePacket(
      VC_BUTTON_SET_PRESSED,
      nativeSessionKey(this.options.encryptionKey),
      [nativeInt(widget.id), nativeBoolean(pressed)],
    );
    await new Promise<void>((resolve, reject) => {
      socket.write(packet, (error) => (error ? reject(error) : resolve()));
    });
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    const logger = getLogger();
    this.setConnectionState("connecting");
    this.decoder.reset();
    this.resetProjectTransfer();

    let endpoint;
    try {
      endpoint = resolveNativeEndpoint(this.options.host);
      this.state.host = endpoint.host;
      this.state.localAddress = endpoint.localAddress ?? null;
      const endpointDescription = endpoint.localAddress
        ? `QLC+ native loopback identity: ${endpoint.localAddress}`
        : `QLC+ native target: ${endpoint.host}`;
      if (endpointDescription !== this.lastLoggedEndpoint) {
        logger.info(endpointDescription);
        this.lastLoggedEndpoint = endpointDescription;
      }
    } catch (error) {
      this.recordError(error);
      this.scheduleReconnect();
      return;
    }

    const socket = net.createConnection({
      host: endpoint.host,
      port: this.options.port,
      localAddress: endpoint.localAddress,
    });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5_000);
    this.connectTimer = setTimeout(() => {
      socket.destroy(new Error("QLC+ native connection timed out"));
    }, this.options.connectTimeoutMs);

    socket.once("connect", () => {
      if (this.socket !== socket || socket.destroyed) return;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.state.connectedAt = isoNow();
      this.setConnectionState("waiting-for-authorization");
      const key = nativeSessionKey(this.options.encryptionKey);
      socket.write(
        makeNativePacket(NET_AUTHENTICATION, key, [
          nativeByteArray(Buffer.from(key.toString(16), "ascii")),
          nativeString(this.options.clientName),
        ]),
      );
      logger.warn(`Authorize '${this.options.clientName}' in QLC+ if prompted`);
    });
    socket.on("data", (chunk) => this.onData(socket, chunk));
    socket.once("error", (error) => {
      if (this.socket === socket) this.recordError(error);
    });
    socket.once("close", () => this.onClose(socket));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.setConnectionState("disconnected");
    this.state.reconnectCount += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectMs);
  }

  private onData(socket: Socket, chunk: Buffer): void {
    if (this.socket !== socket || socket.destroyed) return;
    try {
      for (const frame of this.decoder.push(chunk)) this.handleFrame(socket, frame);
    } catch (error) {
      if (this.socket !== socket) return;
      this.recordError(error);
      socket.destroy();
    }
  }

  private handleFrame(socket: Socket, frame: NativeFrame): void {
    if (this.socket !== socket || socket.destroyed) return;

    if (frame.opcode === NET_AUTHENTICATION_REPLY) {
      const fields = parseNativeSections(
        frame.payload,
        Math.min(frame.sectionCount, 2),
        true,
      );
      if (fields[0] !== "Success") {
        throw new Error("QLC+ native authorization was refused");
      }
      this.state.authorizedAt = isoNow();
      this.setConnectionState("downloading-project");
      return;
    }

    if (frame.opcode === NET_PROJECT_TRANSFER) {
      void this.handleProjectFrame(socket, frame).catch((error) => {
        if (this.socket !== socket) return;
        this.recordError(error);
        socket.destroy();
      });
      return;
    }

    getLogger().debug(
      { opcode: frame.opcode },
      "Ignoring unsupported QLC+ native opcode",
    );
  }

  private async handleProjectFrame(
    socket: Socket,
    frame: NativeFrame,
  ): Promise<void> {
    if (this.socket !== socket || socket.destroyed) return;

    const fields = parseNativeSections(
      frame.payload,
      Math.min(frame.sectionCount, 3),
      true,
    );
    const sequence = fields[0];
    if (typeof sequence !== "number") {
      throw new Error("Invalid QLC+ project sequence");
    }

    if (sequence === 0) {
      if (this.projectStarted || typeof fields[1] !== "number") {
        throw new Error("Invalid QLC+ project transfer start");
      }
      if (
        !Number.isSafeInteger(fields[1]) ||
        fields[1] < 0 ||
        fields[1] > this.options.maximumProjectSize
      ) {
        throw new Error("QLC+ native project exceeds configured limit");
      }

      this.projectTransferGeneration += 1;
      this.invalidateInventory();
      this.setConnectionState("downloading-project");
      this.projectStarted = true;
      this.expectedProjectSize = fields[1];
      if (Buffer.isBuffer(fields[2])) this.appendProjectChunk(fields[2]);
    } else if (sequence === 1 || sequence === 2) {
      if (!this.projectStarted || !Buffer.isBuffer(fields[1])) {
        throw new Error("Invalid QLC+ project transfer chunk");
      }
      this.appendProjectChunk(fields[1]);
    } else {
      throw new Error(`Invalid QLC+ project sequence ${sequence}`);
    }

    if (sequence === 2 || this.projectLength === this.expectedProjectSize) {
      if (this.projectLength !== this.expectedProjectSize) {
        throw new Error("QLC+ project ended before its declared size");
      }

      const transferGeneration = this.projectTransferGeneration;
      const project = Buffer.concat(this.projectChunks, this.projectLength);
      this.resetProjectTransfer();

      const nextInventory = await parseNativeProjectInventory(
        project,
        this.options.maximumProjectSize,
      );
      if (
        this.socket !== socket ||
        socket.destroyed ||
        this.projectTransferGeneration !== transferGeneration
      ) {
        return;
      }

      this.inventory = nextInventory;
      this.state.inventoryGeneration += 1;
      this.state.inventoryLoadedAt = isoNow();
      this.state.widgetCount = nextInventory.widgets.length;
      this.state.buttonCount = nextInventory.buttons.size;
      this.state.sliderCount = nextInventory.sliders.size;
      this.state.lastError = null;
      this.lastLoggedError = null;
      this.stateLogTimes.delete("connecting");
      this.stateLogTimes.delete("disconnected");
      this.setConnectionState("ready");
    }
  }

  private appendProjectChunk(chunk: Buffer): void {
    this.projectLength += chunk.length;
    if (
      this.projectLength > this.options.maximumProjectSize ||
      (this.expectedProjectSize !== null &&
        this.projectLength > this.expectedProjectSize)
    ) {
      throw new Error("QLC+ project exceeds its declared or configured size");
    }
    this.projectChunks.push(Buffer.from(chunk));
  }

  private onClose(socket: Socket): void {
    if (this.socket !== socket) return;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.socket = null;
    this.projectTransferGeneration += 1;
    this.decoder.reset();
    this.resetProjectTransfer();
    this.invalidateInventory();
    this.state.lastDisconnectedAt = isoNow();
    if (this.stopped) return;
    this.scheduleReconnect();
  }

  private invalidateInventory(): void {
    this.inventory = EMPTY_INVENTORY;
    this.state.ready = false;
    this.state.inventoryLoadedAt = null;
    this.state.widgetCount = 0;
    this.state.buttonCount = 0;
    this.state.sliderCount = 0;
  }

  private resetProjectTransfer(): void {
    this.projectChunks = [];
    this.projectLength = 0;
    this.expectedProjectSize = null;
    this.projectStarted = false;
  }

  private setConnectionState(state: NativeConnectionState): void {
    if (this.state.state === state) return;
    this.state.state = state;
    this.state.ready = state === "ready";
    const now = Date.now();
    const lastLoggedAt = this.stateLogTimes.get(state);
    if (
      (state === "connecting" || state === "disconnected") &&
      lastLoggedAt !== undefined &&
      now - lastLoggedAt < RECONNECT_LOG_REPEAT_MS
    ) {
      return;
    }
    this.stateLogTimes.set(state, now);
    getLogger().info(`QLC+ native state: ${state}`);
  }

  private recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.state.lastError = message;
    this.state.lastErrorAt = isoNow();
    if (message !== this.lastLoggedError) {
      getLogger().error(`QLC+ native connection unavailable: ${message}`);
      this.lastLoggedError = message;
    }
  }
}

let nativeClient: QlcNativeClient | null = null;

export function initNativeClient(options: NativeClientOptions): QlcNativeClient {
  nativeClient?.stop();
  nativeClient = new QlcNativeClient(options);
  nativeClient.start();
  return nativeClient;
}

export function stopNativeClient(): void {
  nativeClient?.stop();
  nativeClient = null;
}

export function getNativeClient(): QlcNativeClient | null {
  return nativeClient;
}

export function getNativeRuntimeState(): NativeRuntimeState | null {
  return nativeClient?.getState() ?? null;
}
