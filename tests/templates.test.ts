/**
 * Constitution template validation.
 *
 * Validates that all YAML templates in constitutions/ are valid sanna
 * constitutions with the required fields. Uses @sanna/core for
 * authoritative validation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONSTITUTIONS_DIR = join(__dirname, "../constitutions");

// Discover all YAML files in constitutions/
const yamlFiles = readdirSync(CONSTITUTIONS_DIR)
  .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
  .sort();

// Check if @sanna/core is available for deep validation
let sannaCore: typeof import("@sanna/core") | null = null;
try {
  sannaCore = await import("@sanna/core");
} catch {
  // @sanna/core not available
}

// ---------------------------------------------------------------------------
// Basic YAML structure tests (no @sanna/core needed)
// ---------------------------------------------------------------------------

describe("constitution templates", () => {
  it("has at least 3 templates", () => {
    expect(yamlFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("includes personal, developer, and team templates", () => {
    const names = yamlFiles.map((f) => f.replace(/\.ya?ml$/, ""));
    expect(names).toContain("personal");
    expect(names).toContain("developer");
    expect(names).toContain("team");
  });

  for (const file of yamlFiles) {
    describe(file, () => {
      const content = readFileSync(join(CONSTITUTIONS_DIR, file), "utf-8");

      it("declares sanna_constitution version", () => {
        expect(content).toContain("sanna_constitution:");
      });

      it("has identity section with agent_name", () => {
        expect(content).toContain("identity:");
        expect(content).toContain("agent_name:");
      });

      it("has provenance section", () => {
        expect(content).toContain("provenance:");
        expect(content).toContain("authored_by:");
        expect(content).toContain("approved_by:");
      });

      it("has boundaries section", () => {
        expect(content).toContain("boundaries:");
      });

      it("has authority_boundaries section", () => {
        expect(content).toContain("authority_boundaries:");
        expect(content).toContain("can_execute:");
        expect(content).toContain("cannot_execute:");
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Deep validation via @sanna/core
// ---------------------------------------------------------------------------

describe.skipIf(!sannaCore)("constitution templates: sanna validation", () => {
  for (const file of yamlFiles) {
    it(`${file} loads successfully with @sanna/core`, () => {
      const fullPath = join(CONSTITUTIONS_DIR, file);
      const constitution = sannaCore!.loadConstitution(fullPath);
      expect(constitution.identity.agent_name).toBeTruthy();
    });

    it(`${file} has valid authority_boundaries`, () => {
      const fullPath = join(CONSTITUTIONS_DIR, file);
      const constitution = sannaCore!.loadConstitution(fullPath);
      const ab = constitution.authority_boundaries;
      expect(ab).toBeDefined();
      expect(ab!.can_execute.length).toBeGreaterThan(0);
      expect(ab!.cannot_execute.length).toBeGreaterThan(0);
    });
  }
});
