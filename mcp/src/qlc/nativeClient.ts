import net, { type Socket } from "node:net";
import { getLogger } from "../logger.js";
import { Action, actionName, LIVE_ACTIONS_START_CODE } from "./actionCodes.js";
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
import {
  emptyProjectModel,
  parseProjectModel,
  type ProjectModel,
} from "./projectModel.js";

export const NET_AUTHENTICATION = Action.NetAuthentication;
export const NET_AUTHENTICATION_REPLY = Action.NetAuthenticationReply;
export const NET_PROJECT_TRANSFER = Action.NetProjectTransfer;
export const VC_BUTTON_SET_PRESSED = Action.VCButtonSetPressed;

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
  /** Timeout for project refreshes and extended API requests */
  requestTimeoutMs?: number;
}

/** Capabilities reported by the QLC+ fork (NetApiInfo). Null on stock QLC+. */
export interface ExtendedApiInfo {
  version: string;
  apiLevel: number;
  features: string[];
  accessMask: number;
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
  fixtureCount: number;
  functionCount: number;
  reconnectCount: number;
  lastDisconnectedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  sentCount: number;
  lastSentAt: string | null;
  lastSentWidgetId: number | null;
  lastSentCaption: string | null;
  lastAction: string | null;
  extendedApi: ExtendedApiInfo | null;
}

const EMPTY_INVENTORY: NativeInventory = {
  buttons: new Map(),
  sliders: new Map(),
  widgets: [],
};

const isoNow = () => new Date().toISOString();
const RECONNECT_LOG_REPEAT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** Debounce for resyncing after edits made by QLC+ itself or other clients */
const EXTERNAL_EDIT_RESYNC_MS = 750;

interface PendingRequest {
  resolve: (payload: string) => void;
  reject: (error: Error) => void;
  chunks: string[];
  timer: NodeJS.Timeout;
}

interface ProjectWaiter {
  afterGeneration: number;
  resolve: (model: ProjectModel) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class QlcNativeClient {
  private socket: Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private resyncTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private decoder;
  private inventory: NativeInventory = EMPTY_INVENTORY;
  private model: ProjectModel = emptyProjectModel();
  private projectChunks: Buffer[] = [];
  private projectLength = 0;
  private expectedProjectSize: number | null = null;
  private projectStarted = false;
  private projectTransferGeneration = 0;
  /** A refresh we asked for: the old inventory stays usable until it lands */
  private refreshRequested = false;
  private refreshTransfer = false;
  /**
   * Stock QLC+ answers an authorization with the project file on disk,
   * which is stale for a modified project (or empty when never saved).
   * The first transfer is therefore followed by one explicit request, which
   * QLC+ serves from memory.
   */
  private initialRefreshPending = false;
  private projectWaiters: ProjectWaiter[] = [];
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
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
      fixtureCount: 0,
      functionCount: 0,
      reconnectCount: 0,
      lastDisconnectedAt: null,
      lastErrorAt: null,
      lastError: null,
      sentCount: 0,
      lastSentAt: null,
      lastSentWidgetId: null,
      lastSentCaption: null,
      lastAction: null,
      extendedApi: null,
    };
  }

  private get key(): bigint {
    return nativeSessionKey(this.options.encryptionKey);
  }

  private get requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  get dryRun(): boolean {
    return this.options.dryRun;
  }

  start(): void {
    if (!this.options.enabled || this.options.dryRun || this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.reconnectTimer = null;
    this.connectTimer = null;
    this.resyncTimer = null;
    this.socket?.destroy();
    this.socket = null;
    this.projectTransferGeneration += 1;
    this.resetProjectTransfer();
    this.invalidateInventory();
    this.failPending(new Error("QLC+ native client stopped"));
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

  /** Last project model received from QLC+ (empty until the first transfer) */
  getModel(): ProjectModel {
    return this.model;
  }

  hasFeature(feature: string): boolean {
    return this.state.extendedApi?.features.includes(feature) ?? false;
  }

  private requireReadySocket(): Socket {
    const socket = this.socket;
    if (this.state.state !== "ready" || !socket || socket.destroyed) {
      throw new Error(
        `QLC+ native session is not ready (state: ${this.state.state})`,
      );
    }
    return socket;
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

    this.requireReadySocket();
    const exactKey = exactNativeCaptionKey(caption);
    if (this.inventory.ambiguous?.has(exactKey)) {
      const ids = this.inventory.widgets
        .filter((w) => exactNativeCaptionKey(w.caption) === exactKey)
        .map((w) => w.id);
      throw new Error(
        `QLC+ caption '${caption}' is used by several widgets (IDs ${ids.join(", ")}); press it by widget ID`,
      );
    }
    const widget = this.inventory.buttons.get(exactKey);
    if (!widget) {
      if (this.inventory.sliders.has(exactKey)) {
        throw new Error(`QLC+ widget '${caption}' is a slider, not a button`);
      }
      throw new Error(
        `Exact QLC+ button caption '${caption}' was not found in the current project. Spaces, accents, punctuation, underscores and hyphens are significant; matching ignores case only.`,
      );
    }
    return this.pressWidget(widget);
  }

  async pressButtonById(id: number): Promise<NativeWidget> {
    this.requireReadySocket();
    const widget = this.inventory.widgets.find((w) => w.id === id);
    if (!widget) throw new Error(`QLC+ widget ID ${id} was not found`);
    if (widget.kind !== "button") throw new Error(`QLC+ widget ${id} is a ${widget.kind}, not a button`);
    return this.pressWidget(widget);
  }

  private async pressWidget(widget: NativeWidget): Promise<NativeWidget> {
    const socket = this.requireReadySocket();
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
    await this.write(
      socket,
      makeNativePacket(VC_BUTTON_SET_PRESSED, this.key, [
        nativeInt(widget.id),
        nativeBoolean(pressed),
      ]),
    );
  }

  private async write(socket: Socket, packet: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      socket.write(packet, (error) => (error ? reject(error) : resolve()));
    });
  }

  /**
   * Send one Tardis action: the object ID section followed by the encoded
   * value section(s). Actions without a value (FunctionStart, ...) send the
   * object ID alone.
   */
  async sendAction(code: number, objectId: number, ...value: Buffer[]): Promise<void> {
    if (this.options.dryRun) return;
    const socket = this.requireReadySocket();
    await this.write(socket, makeNativePacket(code, this.key, [nativeInt(objectId), ...value]));
    this.state.sentCount += 1;
    this.state.lastSentAt = isoNow();
    this.state.lastAction = actionName(code);
  }

  /**
   * Ask QLC+ for the current project and wait for it. Packets on one socket
   * are processed in order, so the returned model reflects every action sent
   * before this call.
   */
  async refreshProject(): Promise<ProjectModel> {
    if (this.options.dryRun) return this.model;
    const socket = this.requireReadySocket();
    const waiter = this.waitForProject();
    // a rejection may land while the request is still being written
    waiter.catch(() => undefined);
    this.refreshRequested = true;
    try {
      await this.write(socket, makeNativePacket(Action.NetProjectRequest, this.key, []));
    } catch (error) {
      this.refreshRequested = false;
      throw error;
    }
    return waiter;
  }

  private waitForProject(): Promise<ProjectModel> {
    return new Promise<ProjectModel>((resolve, reject) => {
      const waiter: ProjectWaiter = {
        afterGeneration: this.state.inventoryGeneration,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.projectWaiters = this.projectWaiters.filter((w) => w !== waiter);
          this.refreshRequested = false;
          reject(new Error("Timed out waiting for the QLC+ project transfer"));
        }, this.requestTimeoutMs),
      };
      this.projectWaiters.push(waiter);
    });
  }

  /**
   * Extended API request (QLC+ fork only). Requests carry a numeric ID and a
   * JSON argument string; QLC+ answers with NetCommandResult packets that may
   * be split in chunks to fit the 64 KiB section limit.
   */
  async request(code: number, args: unknown = {}): Promise<unknown> {
    if (this.options.dryRun) throw new Error("Extended QLC+ requests are unavailable in dry-run mode");
    const socket = this.requireReadySocket();
    const requestId = this.nextRequestId++;
    const payload = new Promise<string>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        chunks: [],
        timer: setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error(`QLC+ did not answer ${actionName(code)}`));
        }, this.requestTimeoutMs),
      });
    });
    payload.catch(() => undefined);
    await this.write(
      socket,
      makeNativePacket(code, this.key, [nativeInt(requestId), nativeString(JSON.stringify(args))]),
    );
    this.state.lastAction = actionName(code);
    const text = await payload;
    return text ? JSON.parse(text) : null;
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
      const key = this.key;
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
      this.initialRefreshPending = true;
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

    if (frame.opcode === Action.NetProjectChanging) {
      this.projectTransferGeneration += 1;
      this.resetProjectTransfer();
      this.invalidateInventory();
      this.setConnectionState("downloading-project");
      return;
    }

    if (frame.opcode === Action.NetProjectLoaded) {
      void this.write(socket, makeNativePacket(Action.NetProjectRequest, this.key, [])).catch(
        (error) => this.recordError(error),
      );
      return;
    }

    if (frame.opcode === Action.NetCommandResult) {
      this.handleCommandResult(frame);
      return;
    }

    // Edits made in QLC+ itself or by another client: keep the model fresh
    if (frame.opcode < LIVE_ACTIONS_START_CODE && this.state.state === "ready") {
      this.scheduleResync();
      return;
    }

    getLogger().debug(
      { opcode: frame.opcode },
      "Ignoring unsupported QLC+ native opcode",
    );
  }

  private scheduleResync(): void {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      if (this.state.state !== "ready") return;
      this.refreshProject().catch((error) => this.recordError(error));
    }, EXTERNAL_EDIT_RESYNC_MS);
  }

  /** NetCommandResult: [requestId, success, chunkIndex, chunkCount, payload] */
  private handleCommandResult(frame: NativeFrame): void {
    const fields = parseNativeSections(frame.payload, frame.sectionCount, true);
    const [requestId, success, chunkIndex, chunkCount, payload] = fields;
    if (typeof requestId !== "number") return;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    const text = typeof payload === "string" ? payload : "";
    if (success !== true) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.reject(new Error(text || "QLC+ rejected the request"));
      return;
    }
    const index = typeof chunkIndex === "number" ? chunkIndex : 0;
    const count = typeof chunkCount === "number" && chunkCount > 0 ? chunkCount : 1;
    pending.chunks[index] = text;
    if (pending.chunks.filter((c) => c !== undefined).length >= count) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(pending.chunks.join(""));
    }
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
      this.refreshTransfer = this.refreshRequested && this.state.state === "ready";
      this.refreshRequested = false;
      if (!this.refreshTransfer) {
        this.invalidateInventory();
        this.setConnectionState("downloading-project");
      }
      this.projectStarted = true;
      this.expectedProjectSize = fields[1];
      if (fields[1] === 0) {
        // No workspace file to serve: ask for the in-memory project instead
        this.resetProjectTransfer();
        this.initialRefreshPending = false;
        void this.write(socket, makeNativePacket(Action.NetProjectRequest, this.key, [])).catch(
          (error) => this.recordError(error),
        );
        return;
      }
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

      const [nextInventory, nextModel] = await Promise.all([
        parseNativeProjectInventory(project, this.options.maximumProjectSize, {
          strict: false,
        }),
        parseProjectModel(project, this.options.maximumProjectSize),
      ]);
      if (
        this.socket !== socket ||
        socket.destroyed ||
        this.projectTransferGeneration !== transferGeneration
      ) {
        return;
      }

      this.inventory = nextInventory;
      this.model = nextModel;
      this.state.inventoryGeneration += 1;
      this.state.inventoryLoadedAt = isoNow();
      this.state.widgetCount = nextInventory.widgets.length;
      this.state.buttonCount = nextInventory.buttons.size;
      this.state.sliderCount = nextInventory.sliders.size;
      this.state.fixtureCount = nextModel.fixtures.length;
      this.state.functionCount = nextModel.functions.length;
      this.state.lastError = null;
      this.lastLoggedError = null;
      this.stateLogTimes.delete("connecting");
      this.stateLogTimes.delete("disconnected");
      const firstReady = this.state.state !== "ready" && !this.refreshTransfer;
      this.refreshTransfer = false;
      this.setConnectionState("ready");
      this.resolveProjectWaiters();
      if (this.initialRefreshPending) {
        this.initialRefreshPending = false;
        this.refreshProject().catch(() => undefined);
      }
      if (firstReady && this.state.extendedApi === null) this.probeExtendedApi();
    }
  }

  private resolveProjectWaiters(): void {
    const generation = this.state.inventoryGeneration;
    const done = this.projectWaiters.filter((w) => generation > w.afterGeneration);
    this.projectWaiters = this.projectWaiters.filter((w) => generation <= w.afterGeneration);
    for (const waiter of done) {
      clearTimeout(waiter.timer);
      waiter.resolve(this.model);
    }
  }

  private probeExtendedApi(): void {
    this.request(Action.NetApiInfo, { client: this.options.clientName })
      .then((info) => {
        const data = (info ?? {}) as Partial<ExtendedApiInfo>;
        this.state.extendedApi = {
          version: String(data.version ?? "unknown"),
          apiLevel: Number(data.apiLevel ?? 1),
          features: Array.isArray(data.features) ? data.features.map(String) : [],
          accessMask: Number(data.accessMask ?? 0),
        };
        getLogger().info(
          `QLC+ extended native API detected: ${this.state.extendedApi.features.join(", ")}`,
        );
      })
      .catch(() => {
        getLogger().info("QLC+ extended native API not available (stock QLC+ server)");
      });
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
    this.state.extendedApi = null;
    this.state.lastDisconnectedAt = isoNow();
    this.failPending(new Error("QLC+ native connection closed"));
    if (this.stopped) return;
    this.scheduleReconnect();
  }

  private failPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const waiter of this.projectWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.projectWaiters = [];
    this.refreshRequested = false;
    this.refreshTransfer = false;
  }

  private invalidateInventory(): void {
    this.inventory = EMPTY_INVENTORY;
    this.model = emptyProjectModel();
    this.state.ready = false;
    this.state.inventoryLoadedAt = null;
    this.state.widgetCount = 0;
    this.state.buttonCount = 0;
    this.state.sliderCount = 0;
    this.state.fixtureCount = 0;
    this.state.functionCount = 0;
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
