import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getLogger } from "../logger.js";
import { Config } from "../config.js";
import { createQlcMcpServer } from "../mcpServer.js";
import { stopNativeClient } from "../qlc/nativeClient.js";
import type { ToolDefinition } from "../mcpCompat.js";

export function shutdownStdioRuntime(
  exitCode: number,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  stopNativeClient();
  exit(exitCode);
}

export async function startStdioServer(
  config: Config,
  tools: ToolDefinition[],
): Promise<void> {
  const logger = getLogger();

  logger.info("Starting MCP server in STDIO mode");
  logger.debug({ tools: tools.map((t) => t.name) }, "Tools registered");

  const server = createQlcMcpServer(tools);
  const transport = new StdioServerTransport();
  let shuttingDown = false;
  const shutdown = (exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownStdioRuntime(exitCode);
  };
  transport.onclose = () => {
    logger.info("STDIO transport closed");
    shutdown(0);
  };
  transport.onerror = (error) => {
    logger.error({ err: error }, "STDIO transport error");
    shutdown(1);
  };

  await server.connect(transport);

  logger.info("MCP server ready on STDIO");
}
