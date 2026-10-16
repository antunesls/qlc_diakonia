import { z } from "zod";

export const nullToUndefined = (value: unknown) =>
  value === null ? undefined : value;

export const optionalString = () =>
  z.preprocess(nullToUndefined, z.string().optional());

export const optionalInt = (schema: z.ZodNumber = z.number().int()) =>
  z.preprocess(nullToUndefined, schema.optional());

export const WidgetTypeSchema = z.enum(["button", "slider"]);
export type WidgetType = z.infer<typeof WidgetTypeSchema>;

export const ButtonPressInputSchema = z.object({
  widgetName: optionalString().describe(
    "Complete exact QLC+ button caption. Matching is case-insensitive only; spaces, accents, punctuation, underscores and hyphens remain significant.",
  ),
  oscPath: optionalString().describe(
    "Deprecated compatibility field. OSC control is not supported.",
  ),
  speaker: optionalString().describe(
    "Optional recognized speaker name supplied by the voice agent; ignored by QLCPlus-MCP.",
  ),
});
export type ButtonPressInput = z.infer<typeof ButtonPressInputSchema>;
