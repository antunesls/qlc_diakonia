import {isLocalGatewayEnabled} from "@infrafast/stage-command-core";
import type {ToolDefinition} from "../mcpCompat.js";
import {createAgentPromptTool} from "../agentPrompt.js";
import {createGetStateTool} from "./qlc_get_state.js";
import {createListWidgetsTool} from "./qlc_list_widgets.js";
import {createButtonPressTool} from "./qlc_button_control.js";
import {createQlcLocalGatewayTools} from "./lsa_local_gateway.js";
import {createProjectTools} from "./projectTools.js";
import {createFixtureTools} from "./fixtureTools.js";
import {createFunctionTools} from "./functionTools.js";
import {createVcTools} from "./vcTools.js";
import {createLiveTools} from "./liveTools.js";

export function createRuntimeTools(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    createAgentPromptTool(),
    createGetStateTool(),
    createListWidgetsTool(),
    createButtonPressTool(),
  ];

  // QLC_TOOLSET=control keeps the small show-control inventory of upstream
  // QLCPlus-MCP (voice agents); the default exposes full project editing.
  if ((env.QLC_TOOLSET ?? "full").trim().toLowerCase() !== "control") {
    tools.push(
      ...createProjectTools(),
      ...createFixtureTools(),
      ...createFunctionTools(),
      ...createVcTools(),
      ...createLiveTools(),
    );
  }

  if (isLocalGatewayEnabled(env)) {
    tools.push(...createQlcLocalGatewayTools());
  }

  return tools;
}
