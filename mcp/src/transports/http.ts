import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getLogger, getRecentLogLines, subscribeLogLines } from "../logger.js";
import type { Config } from "../config.js";
import {
  createQlcMcpServer,
  resourceSummaries,
  toolSummaries,
} from "../mcpServer.js";
import type { ToolDefinition } from "../mcpCompat.js";
import { getNativeRuntimeState } from "../qlc/nativeClient.js";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";

function normalizeUnsupportedModernProtocol(req: IncomingMessage): boolean {
  const header = req.headers["mcp-protocol-version"];
  const protocolVersion = Array.isArray(header) ? header[0] : header;
  if (protocolVersion !== MODERN_PROTOCOL_VERSION) return false;

  req.headers["mcp-protocol-version"] = LEGACY_PROTOCOL_VERSION;

  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === "mcp-protocol-version") {
      req.rawHeaders[i + 1] = LEGACY_PROTOCOL_VERSION;
    }
  }

  return true;
}

function getConnectableHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendLogStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");

  const unsubscribe = subscribeLogLines((line) => {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  });
  req.on("close", unsubscribe);
}

function secureTokenEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function isAuthorized(req: IncomingMessage, config: Config): boolean {
  if (config.authMode !== "bearer") return true;

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  return Boolean(
    token && config.authToken && secureTokenEqual(token, config.authToken),
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new Error("HTTP request body exceeds 1 MiB limit");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

export function buildAgentConfig(config: Config): unknown {
  const connectableHost = getConnectableHost(config.httpHost);
  const mcpUrl =
    `http://${connectableHost}:${config.httpPort}${config.httpMcpPath}`;
  return {
    mcpServers: {
      qlcplus: {
        type: "streamable-http",
        url: mcpUrl,
        ...(config.authMode === "bearer"
          ? { headers: { Authorization: "Bearer <MCP_AUTH_TOKEN>" } }
          : {}),
        assistantOptions: {
          routing:
            "qlc,qlcplus,lumière,light,éclairage,scène,fixture,projecteur,couleur",
        },
      },
    },
  };
}

function runtimeConfig(config: Config, envFile: string | undefined): unknown {
  return {
    qlcNativeEnabled: config.qlcNativeEnabled,
    qlcNativeHost: config.qlcNativeHost,
    qlcNativePort: config.qlcNativePort,
    qlcNativeReconnectMs: config.qlcNativeReconnectMs,
    qlcNativeConnectTimeoutMs: config.qlcNativeConnectTimeoutMs,
    qlcNativeMaximumProjectSize: config.qlcNativeMaximumProjectSize,
    qlcNativeClientName: config.qlcNativeClientName,
    qlcDryRun: config.qlcDryRun,
    authMode: config.authMode,
    logLevel: config.logLevel,
    nodeEnv: config.nodeEnv,
    envFile: envFile || null,
  };
}

function healthPayload(): unknown {
  const native = getNativeRuntimeState();
  return {
    ok: true,
    service: "qlcplus-mcp",
    version: "1.0.0",
    native: native
      ? {
          enabled: native.enabled,
          state: native.state,
          ready: native.ready,
          widgetCount: native.widgetCount,
        }
      : null,
  };
}

function statusPayload(
  config: Config,
  tools: ToolDefinition[],
  envFile: string | undefined,
): unknown {
  return {
    ok: true,
    service: "qlcplus-mcp",
    version: "1.0.0",
    transport: "http",
    uptime: process.uptime(),
    runtimeConfig: runtimeConfig(config, envFile),
    native: getNativeRuntimeState(),
    resources: resourceSummaries(),
    tools: toolSummaries(tools),
    agentConfig: buildAgentConfig(config),
  };
}

function renderAdminPage(config: Config): string {
  const connectableHost = getConnectableHost(config.httpHost);
  const mcpUrl = `http://${connectableHost}:${config.httpPort}${config.httpMcpPath}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QLCPlus-MCP</title>
<style>
:root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--text:#18202a;--muted:#687282;--border:#d7dde5;--ok:#0f7a45;--warn:#a15c00;--bad:#b42318;--code:#111827}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}main{width:min(1100px,calc(100vw - 28px));margin:20px auto;display:grid;gap:14px}h1,h2{margin:0}.muted{color:var(--muted)}.panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px;display:grid;gap:10px}.row{display:flex;justify-content:space-between;gap:12px;align-items:center}.pill{border:1px solid var(--border);border-radius:999px;padding:4px 9px;font-size:12px;font-weight:700}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}pre,textarea{margin:0;background:var(--code);color:#eef2f7;border:0;border-radius:6px;padding:12px;white-space:pre-wrap;overflow:auto;font:12px/1.45 ui-monospace,monospace}textarea{width:100%;height:260px;resize:vertical}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<div><h1>QLCPlus-MCP</h1><div class="muted">QLC+ 5 native-protocol MCP server · <span id="mcp-url">${mcpUrl}</span></div></div>
<section class="panel"><div class="row"><h2>Native connection</h2><span id="pill" class="pill">Loading</span></div><pre id="native">Loading...</pre></section>
<div class="grid"><section class="panel"><h2>Agent config</h2><pre id="agent"></pre></section><section class="panel"><h2>Runtime</h2><pre id="runtime"></pre></section></div>
<section class="panel"><h2>Runtime log</h2><textarea id="log" readonly></textarea></section>
<script>
const nativeEl=document.getElementById("native"),runtimeEl=document.getElementById("runtime"),agentEl=document.getElementById("agent"),pill=document.getElementById("pill"),logEl=document.getElementById("log"),mcpUrlEl=document.getElementById("mcp-url");
const currentPath=window.location.pathname;
const mcpBase=currentPath.endsWith("/")?currentPath.slice(0,-1):currentPath;
const mcpRelative=(path="")=>mcpBase+path;
mcpUrlEl.textContent=window.location.origin+mcpBase;
function appendLog(line){logEl.value+=(logEl.value?"\\n":"")+line;logEl.scrollTop=logEl.scrollHeight}
async function load(){const r=await fetch(mcpRelative("/status"),{headers:{accept:"application/json"},cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Unable to read status");nativeEl.textContent=JSON.stringify(d.native,null,2);runtimeEl.textContent=JSON.stringify(d.runtimeConfig,null,2);agentEl.textContent=JSON.stringify({...d.agentConfig,mcpServers:{...d.agentConfig?.mcpServers,qlcplus:{...d.agentConfig?.mcpServers?.qlcplus,url:window.location.origin+mcpBase}}},null,2);const n=d.native||{};pill.textContent=n.state||"not initialized";pill.className="pill "+(n.ready?"ok":n.enabled?"warn":"bad")}
async function logs(){const r=await fetch(mcpRelative("/logs"),{headers:{accept:"application/json"},cache:"no-store"});if(r.ok){const d=await r.json();logEl.value=(d.lines||[]).join("\\n")}}
function stream(){const e=new EventSource(mcpRelative("/logs/stream"));e.onmessage=x=>appendLog(JSON.parse(x.data))}
load().catch(e=>nativeEl.textContent=e.message);logs().then(stream).catch(()=>{});setInterval(()=>load().catch(()=>{}),3000);
</script>
</main></body></html>`;
}

export async function startHttpServer(
  config: Config,
  tools: ToolDefinition[],
  runtimeEnvFile?: string,
): Promise<void> {
  const logger = getLogger();

  logger.info("Starting MCP server in stateless HTTP mode");
  logger.debug({ tools: tools.map((tool) => tool.name) }, "Tools registered");

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (url.pathname === "/health") {
        sendJson(res, 200, healthPayload());
        return;
      }

      if (!isAuthorized(req, config)) {
        sendJson(res, 401, { error: "Missing or invalid authorization" });
        return;
      }

      if (url.pathname === "/mcp/status" && req.method === "GET") {
        sendJson(res, 200, statusPayload(config, tools, runtimeEnvFile));
        return;
      }
      if (url.pathname === "/mcp/logs" && req.method === "GET") {
        sendJson(res, 200, { lines: getRecentLogLines() });
        return;
      }
      if (url.pathname === "/mcp/logs/stream" && req.method === "GET") {
        sendLogStream(req, res);
        return;
      }
      if (url.pathname === "/mcp/tools" && req.method === "GET") {
        sendJson(res, 200, { tools: toolSummaries(tools) });
        return;
      }
      if (url.pathname === "/mcp/resources" && req.method === "GET") {
        sendJson(res, 200, { resources: resourceSummaries() });
        return;
      }

      if (url.pathname !== config.httpMcpPath) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      if (req.method === "GET") {
        const accept = Array.isArray(req.headers.accept)
          ? req.headers.accept.join(",")
          : req.headers.accept || "";
        if (!accept || accept.includes("text/html") || accept.includes("*/*")) {
          sendHtml(res, renderAdminPage(config));
          return;
        }
      }

      const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;
      const downgradedModernProbe = normalizeUnsupportedModernProtocol(req);
      if (downgradedModernProbe) {
        logger.info(
          "MCP 2026-07-28 request detected; using legacy 2025 compatibility for client fallback",
        );
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      transport.onerror = (error) => {
        logger.error({ err: error }, "HTTP MCP transport error");
      };

      const mcpServer = createQlcMcpServer(tools);
      await mcpServer.connect(transport);
      try {
        await transport.handleRequest(req, res, parsedBody);
      } finally {
        await transport.close();
      }
    } catch (error) {
      logger.error({ err: error }, "HTTP request failed");
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(config.httpPort, config.httpHost, resolve);
  });

  const connectableHost = getConnectableHost(config.httpHost);
  const mcpUrl = `http://${connectableHost}:${config.httpPort}${config.httpMcpPath}`;
  logger.info(`MCP server listening on ${mcpUrl}`);
  logger.info(`Health endpoint: http://${connectableHost}:${config.httpPort}/health`);
  logger.info("Streamable HTTP sessions: stateless (no Mcp-Session-Id)");
  logger.info(`HTTP auth: ${config.authMode}`);
  logger.debug({ agentConfig: buildAgentConfig(config) }, "Agent HTTP MCP config");
}
