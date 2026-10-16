import { describe, expect, it } from "vitest";
import { readAgentPrompt } from "../src/agentPrompt.js";
import { createButtonPressTool } from "../src/tools/qlc_button_control.js";

describe("QLC+ runtime agent policy", () => {
  it("keeps current verify-then-execute routing behavior in PROMPT.md", async () => {
    const prompt = await readAgentPrompt();
    expect(prompt).toContain("If Command:");
    expect(prompt).toContain("Verify: Call qlc_list_widgets(<user_caption>)");
    expect(prompt).toContain("case-insensitive");
    expect(prompt).toContain("internal spaces, punctuation, accents, underscores, hyphens are significant");
    expect(prompt).toContain("If *one* exact match, call qlc_button_press(<exact_caption>) immediately");
    expect(prompt).toContain("No confirmation");
    expect(prompt).toContain("Only *exact* caption matches trigger execution");
    expect(prompt).toContain("No fuzzy, semantic, or substring matching");
  });
});

describe("qlc_button_press MCP contract", () => {
  it("documents technical matching semantics without agent behavior policy", () => {
    const tool = createButtonPressTool();
    expect(tool.description).toContain("Press a QLC+ 5 Virtual Console button");
    expect(tool.description).toContain("Matching ignores case only");
    expect(tool.description).toContain("internal spaces");
    expect(tool.description).not.toContain("Immediately");
    expect(tool.description?.toLowerCase()).not.toContain("confirmation");
  });
});
