import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SKILL_PATH = resolve(__dirname, "../skills/sanna/SKILL.md");
const skillContent = readFileSync(SKILL_PATH, "utf-8");

describe("SKILL.md", () => {
  it("exists and has valid frontmatter", () => {
    expect(skillContent).toContain("---");
    expect(skillContent).toContain("name: sanna");
    expect(skillContent).toContain("description:");
  });

  it("does not reference sanna_ prefixed wrapper tools", () => {
    expect(skillContent).not.toContain("sanna_exec");
    expect(skillContent).not.toContain("sanna_bash");
    expect(skillContent).not.toContain("sanna_write");
    expect(skillContent).not.toContain("sanna_browser");
    expect(skillContent).not.toContain("| Instead of | Use |");
  });

  it("documents governance outcomes", () => {
    expect(skillContent).toContain("Allowed");
    expect(skillContent).toContain("Blocked");
    expect(skillContent).toContain("Escalated");
  });

  it("mentions tool tiers", () => {
    expect(skillContent).toContain("Tier");
    expect(skillContent).toContain("exec");
    expect(skillContent).toContain("browser");
    expect(skillContent).toContain("web_search");
  });

  it("mentions receipts", () => {
    expect(skillContent).toContain("receipt");
  });
});
