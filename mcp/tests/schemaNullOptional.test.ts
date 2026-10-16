import { describe, expect, it } from "vitest";
import { ButtonPressInputSchema } from "../src/types";
import { GetStateInputSchema } from "../src/tools/qlc_get_state";
import { ListWidgetsInputSchema } from "../src/tools/qlc_list_widgets";

describe("nullable optional tool arguments", () => {
  it("treats null as absent for optional button fields", () => {
    expect(
      ButtonPressInputSchema.safeParse({
        widgetName: "blue speed",
        oscPath: null,
        speaker: null,
      }).success,
    ).toBe(true);
  });

  it("treats null as absent for optional diagnostic and discovery fields", () => {
    expect(
      GetStateInputSchema.safeParse({ freshnessSeconds: null }).success,
    ).toBe(true);
    expect(
      ListWidgetsInputSchema.safeParse({ type: null, query: null, limit: null })
        .success,
    ).toBe(true);
  });
});
