/**
 * Integration tests — real Python sidecar, real constitution, real enforcement.
 *
 * These tests spawn the actual sidecar process with a test constitution and
 * exercise the TS enforce() function against it. They verify the full loop
 * including the verdict→decision field mapping and receipt extraction.
 *
 * Skipped if Python or the sanna library is not available.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enforce } from "../src/enforce.js";
import type { SannaConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Check if sanna is available
// ---------------------------------------------------------------------------

let sannaAvailable = false;
try {
  execSync("python3 -c 'import sanna'", { stdio: "ignore" });
  sannaAvailable = true;
} catch {
  // sanna not installed — skip integration tests
}

// ---------------------------------------------------------------------------
// Test constitution — controls what is allowed/denied/escalated
// ---------------------------------------------------------------------------

const TEST_CONSTITUTION_YAML = `
sanna_constitution: "0.1.0"

identity:
  agent_name: integration-test-agent
  domain: testing
  description: Test constitution for integration tests

provenance:
  authored_by: test-suite
  approved_by:
    - test-runner
  approval_date: "2024-01-01"
  approval_method: automated-test

boundaries:
  - id: B001
    description: Test boundary
    category: scope
    severity: high

authority_boundaries:
  can_execute:
    - exec
    - bash
  must_escalate:
    - condition: browser
  cannot_execute:
    - process
`.trim();

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

const SIDECAR_PORT = 18899;
const PROJECT_ROOT = join(__dirname, "..");

describe.skipIf(!sannaAvailable)("integration: real sidecar enforcement", () => {
  let sidecar: ChildProcess | null = null;
  let tmpDir: string;
  let constitutionPath: string;

  const config: SannaConfig = {
    sidecarPort: SIDECAR_PORT,
    enforcementMode: "enforce",
  };

  beforeAll(async () => {
    // Write test constitution to temp dir
    tmpDir = mkdtempSync(join(tmpdir(), "sanna-integration-"));
    constitutionPath = join(tmpDir, "test-constitution.yaml");
    writeFileSync(constitutionPath, TEST_CONSTITUTION_YAML);

    // Spawn real sidecar
    sidecar = spawn(
      "python3",
      ["-m", "sidecar", "--port", String(SIDECAR_PORT), "--constitution", constitutionPath],
      {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SANNA_ALLOW_TEMP_DB: "1" },
      }
    );

    // Wait for health
    const url = `http://127.0.0.1:${SIDECAR_PORT}/health`;
    let healthy = false;

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(url);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        // Not ready yet
      }
    }

    if (!healthy) {
      sidecar?.kill("SIGTERM");
      sidecar = null;
      throw new Error("Sidecar failed to start within 10s");
    }
  }, 30000);

  afterAll(() => {
    if (sidecar) {
      sidecar.kill("SIGTERM");
      sidecar = null;
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  // -------------------------------------------------------------------------
  // 1. Allow — exec is in can_execute
  // -------------------------------------------------------------------------

  it("allows tools in can_execute", async () => {
    const result = await enforce(config, "exec", { command: "ls" });

    expect(result.decision).toBe("allow");
    expect(result.reason).toBeDefined();
  }, 10000);

  // -------------------------------------------------------------------------
  // 2. Deny — process is in cannot_execute (sidecar returns "halt")
  // -------------------------------------------------------------------------

  it("denies tools in cannot_execute (halt→deny mapping)", async () => {
    const result = await enforce(config, "process", { pid: 1234 });

    expect(result.decision).toBe("deny");
    expect(result.reason).toBeDefined();
  }, 10000);

  // -------------------------------------------------------------------------
  // 3. Escalate — browser is in must_escalate
  // -------------------------------------------------------------------------

  it("escalates tools in must_escalate", async () => {
    const result = await enforce(config, "browser", { url: "https://example.com" });

    expect(result.decision).toBe("escalate");
    expect(result.reason).toBeDefined();
  }, 10000);

  // -------------------------------------------------------------------------
  // 4. Sidecar down — fail closed
  // -------------------------------------------------------------------------

  it("returns deny when sidecar is unreachable (fail closed)", async () => {
    const badConfig: SannaConfig = {
      sidecarPort: 19999, // Nothing listening here
      enforcementMode: "enforce",
    };

    const result = await enforce(badConfig, "exec", { command: "ls" });

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("Sidecar unreachable");
  }, 10000);

  // -------------------------------------------------------------------------
  // 5. Receipt annotation — receipt_hash populated from sidecar receipt
  // -------------------------------------------------------------------------

  it("extracts receipt_hash from sidecar response", async () => {
    const result = await enforce(config, "exec", { command: "pwd" });

    expect(result.decision).toBe("allow");
    // The sidecar returns receipt.receipt_id, which gets mapped to receipt_hash
    expect(result.receipt_hash).toBeDefined();
    expect(typeof result.receipt_hash).toBe("string");
    expect(result.receipt_hash!.length).toBeGreaterThan(0);

    // Full receipt object should also be available
    expect(result.receipt).toBeDefined();
  }, 10000);
});
