import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getLogger } from "../logger.js";
import { error, text, type ToolDefinition } from "../mcpCompat.js";
import { EditSession, type CommitResult } from "../qlc/editSession.js";
import { getNativeClient, type QlcNativeClient } from "../qlc/nativeClient.js";
import type { ProjectModel } from "../qlc/projectModel.js";

/** Optional field that also accepts null, like the rest of the tool schemas */
export function opt<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === null ? undefined : value), schema.optional());
}

/** A reference to a project object: numeric ID or exact name/caption */
export const Ref = z
  .union([z.number().int().nonnegative(), z.string().min(1)])
  .describe("Numeric ID, or the exact name (case-insensitive)");

export const Percent = z.number().min(0).max(100);
export const Dmx = z.number().int().min(0).max(255);
export const Millis = z.number().int().nonnegative().describe("Time in milliseconds");

export function readyClient(): QlcNativeClient {
  const client = getNativeClient();
  if (!client) throw new Error("QLC+ native client is not initialized");
  const state = client.getState();
  if (!client.dryRun && !state.ready) {
    throw new Error(
      `QLC+ is not ready (state: ${state.state}). Check that QLC+ is running with the Native Server enabled and that QLCPlus-MCP was authorized.`,
    );
  }
  return client;
}

/** Model to edit against: refreshed when a QLC+ session is live */
export async function freshModel(client: QlcNativeClient): Promise<ProjectModel> {
  return client.dryRun ? client.getModel() : client.refreshProject();
}

export async function newSession(client = readyClient()): Promise<EditSession> {
  return new EditSession(client, await freshModel(client));
}

export function requireFeature(client: QlcNativeClient, feature: string, what: string): void {
  if (!client.hasFeature(feature)) {
    throw new Error(
      `${what} needs the QLC+ fork with the extended native API (feature '${feature}'). The connected QLC+ does not provide it.`,
    );
  }
}

export function json(value: unknown, summary?: string): CallToolResult {
  const body = JSON.stringify(value, null, 2);
  return text(summary ? `${summary}\n\n${body}` : body);
}

export function commitReport(result: CommitResult, summary: string, extra: Record<string, unknown> = {}): CallToolResult {
  if (result.problems.length) {
    return error(
      `${summary} — QLC+ did not apply everything:\n- ${result.problems.join("\n- ")}\n\n${JSON.stringify(
        { actions: result.actions, ...extra },
        null,
        2,
      )}`,
    );
  }
  return json(
    { dryRun: result.dryRun || undefined, ...extra, actionsSent: result.actions.length, actions: result.dryRun ? result.actions : undefined },
    result.dryRun ? `[dry-run] ${summary}` : summary,
  );
}

/** Wrap a tool body: schema-parsed input in, errors turned into MCP errors */
export function tool<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: S,
  body: (input: z.infer<S>) => Promise<CallToolResult>,
): ToolDefinition {
  return {
    name,
    description,
    schema,
    cb: async (input: unknown) => {
      getLogger().debug({ input }, `Tool: ${name}`);
      try {
        return await body(input as z.infer<S>);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        getLogger().warn(`Tool ${name} failed: ${message}`);
        return error(`${name} failed: ${message}`);
      }
    },
  };
}
