import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GOVERNED_TOOLS_DEFAULT } from "../src/config.js";

const SKILL_PATH = resolve(__dirname, "../skills/sanna/SKILL.md");
const skillContent = readFileSync(SKILL_PATH, "utf-8");

describe("SKILL.md", () => {
  it("exists and has valid frontmatter", () => {
    expect(skillContent).toContain("---");
    expect(skillContent).toContain("name: sanna");
    expect(skillContent).toContain('description:');
  });

  it("mentions all default governed tools", () => {
    for (const tool of GOVERNED_TOOLS_DEFAULT) {
      expect(skillContent).toContain(`sanna_${tool}`);
    }
  });

  it("includes the tool mapping table", () => {
    expect(skillContent).toContain("| Instead of | Use |");
    expect(skillContent).toContain("| exec | sanna_exec |");
    expect(skillContent).toContain("| browser | sanna_browser |");
    expect(skillContent).toContain("| message | sanna_message |");
  });

  it("explains composite tools", () => {
    expect(skillContent).toContain("action");
    expect(skillContent).toContain("sanna_browser");
    expect(skillContent).toContain("navigate");
  });

  it("mentions receipts", () => {
    expect(skillContent).toContain("receipt");
  });
});
