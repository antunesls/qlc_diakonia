import { z } from "zod";
import { text, type ToolDefinition } from "../mcpCompat.js";
import { getLogger } from "../logger.js";
import { optionalInt } from "../types.js";
import { getNativeRuntimeState } from "../qlc/nativeClient.js";

export const GetStateInputSchema = z.object({
  freshnessSeconds: optionalInt(z.number().int().min(1).max(300)).describe(
    "Legacy optional argument retained for MCP schema compatibility.",
  ),
});

export function createGetStateTool(): ToolDefinition {
  const logger = getLogger();

  return {
    name: "qlc_get_state",
    description:
      "Report QLC+ native connection lifecycle, authorization, inventory readiness, reconnects, and last successful command.",
    schema: GetStateInputSchema,
    cb: async (input: any) => {
      logger.debug("Tool: qlc_get_state", input);

      const native = getNativeRuntimeState();
      const nativeSummary = native?.enabled
        ? `QLC+ native state is ${native.state}${native.ready ? ` with ${native.widgetCount} discovered widgets` : ""}.`
        : "QLC+ native client is disabled.";

      return text(`${nativeSummary}

${JSON.stringify({ native }, null, 2)}`);
    },
  };
}
