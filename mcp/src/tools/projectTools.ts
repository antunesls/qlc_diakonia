import { z } from "zod";
import type { ToolDefinition } from "../mcpCompat.js";
import { Action } from "../qlc/actionCodes.js";
import { assertSafeWorkspaceXml } from "../qlc/projectModel.js";
import { freshModel, json, opt, readyClient, requireFeature, tool } from "./toolkit.js";
import { text } from "../mcpCompat.js";

export const PROJECT_FEATURE = "project";

export function createProjectTools(): ToolDefinition[] {
  return [
    tool(
      "qlc_project_summary",
      "Overview of the open QLC+ project: universes and patch, fixtures, fixture groups, functions by type, Virtual Console pages and widget counts, and which extended (fork) features the server supports.",
      z.object({}),
      async () => {
        const client = readyClient();
        const model = await freshModel(client);
        const byType: Record<string, number> = {};
        for (const fn of model.functions) byType[fn.type] = (byType[fn.type] ?? 0) + 1;
        return json({
          extendedApi: client.getState().extendedApi,
          universes: model.universes,
          fixtures: model.fixtures.map((f) => ({
            id: f.id,
            name: f.name,
            type: `${f.manufacturer} ${f.model}`,
            mode: f.mode,
            universe: f.universe + 1,
            address: f.address + 1,
            channels: f.channels,
          })),
          fixtureGroups: model.fixtureGroups.map((g) => ({
            id: g.id,
            name: g.name,
            size: `${g.width}x${g.height}`,
            heads: g.heads.length,
          })),
          functions: byType,
          virtualConsole: model.vcPages.map((page) => ({
            id: page.id,
            caption: page.caption,
            widgets: model.vcWidgets.filter((w) => w.vcPage === model.vcPages.indexOf(page)).length,
          })),
        });
      },
    ),

    tool(
      "qlc_project_export_xml",
      "Return the raw QLC+ workspace XML (.qxw) of the open project, exactly as QLC+ serialized it. Useful for backups or to inspect details no other tool exposes.",
      z.object({
        maxChars: opt(z.number().int().min(1000).max(5_000_000)).describe(
          "Truncate the returned XML to this many characters (default 200000)",
        ),
      }),
      async ({ maxChars }) => {
        const model = await freshModel(readyClient());
        const limit = maxChars ?? 200_000;
        const xml = model.xml;
        return text(
          xml.length > limit
            ? `${xml.slice(0, limit)}\n<!-- truncated: ${xml.length - limit} more characters -->`
            : xml,
        );
      },
    ),

    tool(
      "qlc_project_save",
      "Save the open QLC+ project to disk (requires the QLC+ fork). Without a path QLC+ saves to the file the project was opened from.",
      z.object({
        path: opt(z.string().min(1)).describe("Absolute .qxw path on the QLC+ machine"),
      }),
      async ({ path }) => {
        const client = readyClient();
        requireFeature(client, PROJECT_FEATURE, "Saving the project");
        const result = await client.request(Action.NetProjectSave, { path });
        return json(result, "Project saved");
      },
    ),

    tool(
      "qlc_project_new",
      "Close the current QLC+ project and start an empty one (requires the QLC+ fork). Unsaved changes are lost.",
      z.object({
        confirm: z.literal(true).describe("Must be true: this discards the open project"),
      }),
      async () => {
        const client = readyClient();
        requireFeature(client, PROJECT_FEATURE, "Creating a new project");
        await client.request(Action.NetProjectNew, {});
        const model = await waitForReload(client);
        return json({ fixtures: model.fixtures.length, functions: model.functions.length }, "New empty project");
      },
    ),

    tool(
      "qlc_project_load",
      "Open a .qxw project file that exists on the QLC+ machine (requires the QLC+ fork). The current project is replaced.",
      z.object({
        path: z.string().min(1).describe("Absolute .qxw path on the QLC+ machine"),
      }),
      async ({ path }) => {
        const client = readyClient();
        requireFeature(client, PROJECT_FEATURE, "Loading a project");
        await client.request(Action.NetProjectLoadFile, { path });
        const model = await waitForReload(client);
        return json(
          { fixtures: model.fixtures.length, functions: model.functions.length, widgets: model.vcWidgets.length },
          `Loaded ${path}`,
        );
      },
    ),

    tool(
      "qlc_project_upload_xml",
      "Replace the open QLC+ project with a complete workspace XML document (requires the QLC+ fork). Accepts the output of qlc_project_export_xml.",
      z.object({
        xml: z.string().min(20).describe("Complete .qxw document starting with <?xml and <!DOCTYPE Workspace>"),
      }),
      async ({ xml }) => {
        const client = readyClient();
        requireFeature(client, PROJECT_FEATURE, "Uploading a project");
        assertSafeWorkspaceXml(xml);
        if (!/<Workspace[\s>]/.test(xml)) throw new Error("The document has no <Workspace> root");
        const data = Buffer.from(xml, "utf8");
        const chunkSize = 32 * 1024;
        const chunks = Math.ceil(data.length / chunkSize);
        for (let index = 0; index < chunks; index += 1) {
          await client.request(Action.NetProjectUpload, {
            index,
            count: chunks,
            data: data.subarray(index * chunkSize, (index + 1) * chunkSize).toString("base64"),
          });
        }
        const model = await waitForReload(client);
        return json(
          { fixtures: model.fixtures.length, functions: model.functions.length, widgets: model.vcWidgets.length },
          "Project uploaded and loaded by QLC+",
        );
      },
    ),
  ];
}

/** After a project switch QLC+ announces the new workspace; fetch it explicitly */
async function waitForReload(client: ReturnType<typeof readyClient>) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (client.getState().ready) {
      try {
        return await client.refreshProject();
      } catch {
        // the session is switching projects: retry until it settles
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("QLC+ did not finish loading the project in time");
}
