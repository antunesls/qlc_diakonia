import { z } from "zod";
import { text, type ToolDefinition } from "../mcpCompat.js";
import { getLogger } from "../logger.js";
import { getNativeClient } from "../qlc/nativeClient.js";
import {
  optionalInt,
  optionalString,
  nullToUndefined,
  WidgetTypeSchema,
} from "../types.js";

export const ListWidgetsInputSchema = z.object({
  type: z
    .preprocess(nullToUndefined, WidgetTypeSchema.optional())
    .describe("Only return widgets of this type."),
  query: optionalString().describe(
    "Case-insensitive text filter on widget caption or containing Frame path.",
  ),
  limit: optionalInt(z.number().int().min(1).max(200)).describe(
    "Maximum number of widgets to return.",
  ),
});

export function createListWidgetsTool(): ToolDefinition {
  const logger = getLogger();

  return {
    name: "qlc_list_widgets",
    description:
      "List widgets discovered from the current QLC+ 5 native project inventory. Numeric IDs are session-only and refresh after reconnect.",
    schema: ListWidgetsInputSchema,
    cb: async (input: any) => {
      logger.debug("Tool: qlc_list_widgets", input);

      const query =
        typeof input?.query === "string" ? input.query.toLowerCase() : "";
      const type = input?.type;
      const limit = input?.limit ?? 100;

      const client = getNativeClient();
      const nativeState = client?.getState();
      if (!client || !nativeState?.ready) {
        return text(
          JSON.stringify(
            {
              count: 0,
              state: nativeState?.state ?? "not-initialized",
              widgets: [],
            },
            null,
            2,
          ),
        );
      }
      const widgets = client
        .listWidgets()
        .filter((widget) => !type || widget.kind === type)
        .filter((widget) => {
          if (!query) return true;
          return (
            widget.caption.toLowerCase().includes(query) ||
            widget.framePath.join(" / ").toLowerCase().includes(query)
          );
        })
        .slice(0, limit);

      const payload = {
        count: widgets.length,
        widgets: widgets.map((widget) => ({
          id: widget.id,
          name: widget.caption,
          type: widget.kind,
          actionType: widget.actionType,
          minValue: widget.low,
          maxValue: widget.high,
          framePath: widget.framePath,
        })),
      };

      return text(JSON.stringify(payload, null, 2));
    },
  };
}
