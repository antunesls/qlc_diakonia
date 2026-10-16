import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { initLogger, getLogger } from "./logger.js";
import { initNativeClient, stopNativeClient } from "./qlc/nativeClient.js";
import { startStdioServer } from "./transports/stdio.js";
import { startHttpServer } from "./transports/http.js";
import { createRuntimeTools } from "./tools/runtimeTools.js";

function loadRuntimeEnv(): string | undefined {
  const candidates = [
    process.env.QLCPLUS_MCP_ENV_FILE,
    "/etc/qlcplusmcp.env",
    "/config/.env",
    "config/.env",
    ".env",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const envPath = path.resolve(candidate);
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
      return envPath;
    }
  }

  dotenv.config({ quiet: true });
  return undefined;
}

const runtimeEnvFile = loadRuntimeEnv();

let shuttingDown = false;
function shutdown(exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stopNativeClient();
  process.exit(exitCode);
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    const logger = initLogger(config);

    logger.info("=== QLCPlus-MCP Server Starting ===");
    logger.info(`Transport: ${config.transport}`);
    logger.info(
      `QLC+ native endpoint: ${config.qlcNativeHost}:${config.qlcNativePort}`,
    );
    logger.info(`Log Level: ${config.logLevel}`);
    logger.info(
      runtimeEnvFile
        ? `Runtime env file: ${runtimeEnvFile}`
        : "Runtime env file: default dotenv lookup",
    );

    initNativeClient({
      enabled: true,
      host: config.qlcNativeHost,
      port: config.qlcNativePort,
      encryptionKey: config.qlcNativeEncryptionKey,
      reconnectMs: config.qlcNativeReconnectMs,
      connectTimeoutMs: config.qlcNativeConnectTimeoutMs,
      maximumProjectSize: config.qlcNativeMaximumProjectSize,
      clientName: config.qlcNativeClientName,
      dryRun: config.qlcDryRun,
    });

    const tools = createRuntimeTools();
    logger.info(`Registered ${tools.length} MCP tools`);

    if (config.transport === "http") {
      await startHttpServer(config, tools, runtimeEnvFile);
    } else {
      await startStdioServer(config, tools);
    }
  } catch (error) {
    const logger = getLogger();
    logger.fatal(
      { err: error instanceof Error ? error : String(error) },
      "Failed to start server",
    );
    shutdown(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  shutdown(1);
});
