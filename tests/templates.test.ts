/**
 * Constitution template validation.
 *
 * Validates that all YAML templates in constitutions/ are valid sanna
 * constitutions with the required fields. Uses Python + sanna library
 * for authoritative validation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const CONSTITUTIONS_DIR = join(__dirname, "../constitutions");
const PROJECT_ROOT = join(__dirname, "..");

// Discover all YAML files in constitutions/
const yamlFiles = readdirSync(CONSTITUTIONS_DIR)
  .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
  .sort();

// Check if sanna library is available for deep validation
let sannaAvailable = false;
try {
  execSync("python3 -c 'import sanna'", { stdio: "ignore" });
  sannaAvailable = true;
} catch {
  // sanna not installed
}

// ---------------------------------------------------------------------------
// Basic YAML structure tests (no Python needed)
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
// Deep validation via sanna library (requires Python)
// ---------------------------------------------------------------------------

describe.skipIf(!sannaAvailable)("constitution templates: sanna validation", () => {
  for (const file of yamlFiles) {
    it(`${file} loads successfully with sanna library`, () => {
      const fullPath = join(CONSTITUTIONS_DIR, file);
      const result = execSync(
        `python3 -c "
from sanna.constitution import load_constitution
c = load_constitution('${fullPath}')
print(f'{c.identity.agent_name}')
"`,
        { cwd: PROJECT_ROOT, encoding: "utf-8" }
      );
      expect(result.trim()).toBeTruthy();
    });

    it(`${file} has valid authority_boundaries`, () => {
      const fullPath = join(CONSTITUTIONS_DIR, file);
      const result = execSync(
        `python3 -c "
from sanna.constitution import load_constitution
c = load_constitution('${fullPath}')
ab = c.authority_boundaries
assert len(ab.can_execute) > 0, 'can_execute must not be empty'
assert len(ab.cannot_execute) > 0, 'cannot_execute must not be empty'
print('ok')
"`,
        { cwd: PROJECT_ROOT, encoding: "utf-8" }
      );
      expect(result.trim()).toBe("ok");
    });
  }
});
