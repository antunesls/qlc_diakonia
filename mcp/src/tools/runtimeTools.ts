import {isLocalGatewayEnabled} from "@infrafast/stage-command-core";
import type {ToolDefinition} from "../mcpCompat.js";
import {createAgentPromptTool} from "../agentPrompt.js";
import {createGetStateTool} from "./qlc_get_state.js";
import {createListWidgetsTool} from "./qlc_list_widgets.js";
import {createButtonPressTool} from "./qlc_button_control.js";
import {createQlcLocalGatewayTools} from "./lsa_local_gateway.js";

export function createRuntimeTools(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    createAgentPromptTool(),
    createGetStateTool(),
    createListWidgetsTool(),
    createButtonPressTool(),
  ];

  if (isLocalGatewayEnabled(env)) {
    tools.push(...createQlcLocalGatewayTools());
  }

  return tools;
}
