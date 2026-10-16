import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  cb: (input: unknown) => Promise<CallToolResult> | CallToolResult;
}

export function text(value: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: value,
      },
    ],
  };
}

export function error(value: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: value,
      },
    ],
  };
}
