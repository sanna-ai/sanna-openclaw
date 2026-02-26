/**
 * CLI commands: openclaw sanna doctor|status|audit|verify
 *
 * These commands are registered via api.registerCli and exposed
 * through the OpenClaw CLI tool.
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import type { Constitution } from "@sanna-ai/core";
import { ReceiptStore, verifyReceipt } from "@sanna-ai/core";
import { readHooksEnabled } from "./http.js";
import type { KeyObject } from "node:crypto";

export interface CliDeps {
  constitution: Constitution;
  store: ReceiptStore;
  constitutionPath: string;
  publicKey: KeyObject | null;
}

/** Register CLI commands under `openclaw sanna`. */
export function registerCli(
  api: PluginAPI,
  config: SannaConfig,
  deps: CliDeps
): void {
  const { constitution, store, constitutionPath, publicKey } = deps;

  api.registerCli(
    ({ program }) => {
      const prog = program as {
        command: (name: string) => CommandBuilder;
      };

      const sanna = prog.command("sanna");
      (sanna as unknown as { description: (d: string) => void }).description(
        "Sanna governance"
      );

      // openclaw sanna status
      addCommand(sanna, "status", "Show governance status", async () => {
        console.log(`Mode: ${config.enforcementMode ?? "enforce"}`);
        console.log(
          `Constitution: ${constitution.identity.agent_name} (${constitutionPath})`
        );
        console.log(
          `Governed tools: ${(config.governedTools ?? []).join(", ")}`
        );

        try {
          const total = store.count();
          const allowed = store.count({ status: "PASS" });
          const denied = store.count({ status: "FAIL" });
          console.log(
            `Stats: total=${total} allowed=${allowed} denied=${denied}`
          );
        } catch {
          console.log("Stats: unavailable");
        }
      });

      // openclaw sanna audit
      addCommandWithOptions(
        sanna,
        "audit",
        "Show recent enforcement decisions",
        {
          "--limit <n>": "Number of recent decisions",
          "--json": "Output raw JSON instead of formatted table",
        },
        async (opts: Record<string, string>) => {
          try {
            const limit = parseInt(opts.limit ?? "20", 10);
            const receipts = store.query({ limit });
            if (receipts.length === 0) {
              console.log("No enforcement decisions recorded.");
              return;
            }
            if (opts.json) {
              for (const entry of receipts) {
                console.log(JSON.stringify(entry));
              }
              return;
            }
            const mode = config.enforcementMode ?? "enforce";
            printAuditTable(receipts, constitution.identity.agent_name, mode);
          } catch {
            console.error("Receipt query failed");
          }
        }
      );

      // openclaw sanna verify <receipt-id>
      addCommandWithArgAndOptions(
        sanna,
        "verify",
        "Verify a receipt",
        "<receipt-id>",
        {
          "--strict": "Enable strict verification (all checks evaluated)",
          "--json": "Output verification result as JSON",
        },
        async (receiptId: string, opts: Record<string, string>) => {
          try {
            const results = store.query({ limit: 1000 });
            const match = results.find(
              (r) => (r as Record<string, unknown>).receipt_id === receiptId
            );
            if (!match) {
              console.error(`Receipt not found: ${receiptId}`);
              return;
            }
            const receipt = match as Record<string, unknown>;
            const vResult = verifyReceipt(
              receipt,
              publicKey ?? undefined
            );

            // Strict mode: verify all receipt checks were evaluated
            let strictPass = true;
            let strictDetail = "";
            if (opts.strict) {
              const checks = (receipt.checks ?? []) as Array<
                Record<string, unknown>
              >;
              const allEvaluated =
                checks.length > 0 &&
                checks.every(
                  (c) => c.status === "PASS" || c.status === "FAIL"
                );
              strictPass = allEvaluated;
              strictDetail = allEvaluated
                ? "all checks evaluated"
                : checks.length === 0
                  ? "no checks in receipt"
                  : "unevaluated checks found";
            }

            if (opts.json) {
              const jsonOut = {
                ...vResult,
                strict: opts.strict
                  ? { passed: strictPass, detail: strictDetail }
                  : undefined,
              };
              console.log(JSON.stringify(jsonOut, null, 2));
              return;
            }

            // Formatted output
            const stageMap: Record<string, string> = {
              schema: "Stage 1 — Schema",
              content_hashes: "Stage 2 — Integrity",
              fingerprint: "Stage 3 — Fingerprint",
            };

            console.log(`Receipt: ${receiptId}`);

            for (const [checkKey, label] of Object.entries(stageMap)) {
              const performed = vResult.checks_performed.includes(checkKey);
              if (!performed) {
                console.log(`${label}:`.padEnd(30) + "SKIP");
                continue;
              }
              const failed = vResult.errors.find((e) =>
                e.toLowerCase().includes(checkKey.replace("_", " "))
              );
              if (failed) {
                console.log(
                  `${label}:`.padEnd(30) +
                    `${ANSI.red}FAIL${ANSI.reset} (${failed})`
                );
              } else {
                console.log(
                  `${label}:`.padEnd(30) + `${ANSI.green}PASS${ANSI.reset}`
                );
              }
            }

            // Signature stage
            const sig = receipt.receipt_signature as
              | Record<string, unknown>
              | undefined;
            if (!publicKey) {
              console.log("Stage 4 — Signature:".padEnd(30) + "SKIP");
            } else if (!sig?.signature) {
              console.log(
                "Stage 4 — Signature:".padEnd(30) +
                  `${ANSI.red}FAIL${ANSI.reset} (unsigned receipt)`
              );
            } else {
              const sigError = vResult.errors.find((e) =>
                e.toLowerCase().includes("signature")
              );
              if (sigError) {
                console.log(
                  "Stage 4 — Signature:".padEnd(30) +
                    `${ANSI.red}FAIL${ANSI.reset} (${sigError})`
                );
              } else {
                const keyId = (sig.key_id as string) ?? "unknown";
                console.log(
                  "Stage 4 — Signature:".padEnd(30) +
                    `${ANSI.green}PASS${ANSI.reset} (signer: ${keyId})`
                );
              }
            }

            // Strict stage
            if (opts.strict) {
              if (strictPass) {
                console.log(
                  "Stage 5 — Strict:".padEnd(30) +
                    `${ANSI.green}PASS${ANSI.reset} (${strictDetail})`
                );
              } else {
                console.log(
                  "Stage 5 — Strict:".padEnd(30) +
                    `${ANSI.red}FAIL${ANSI.reset} (${strictDetail})`
                );
              }
            }

            // Overall verdict
            const overallPass = vResult.valid && (!opts.strict || strictPass);
            if (overallPass) {
              console.log(
                `Overall: ${ANSI.green}${ANSI.bold}VERIFIED${ANSI.reset}`
              );
            } else {
              console.log(
                `Overall: ${ANSI.red}${ANSI.bold}FAILED${ANSI.reset}`
              );
            }
          } catch {
            console.error("Receipt query failed");
          }
        }
      );

      // openclaw sanna doctor
      addCommand(sanna, "doctor", "Check governance readiness", async () => {
        let allPassed = true;

        // 1. hooks.internal.enabled
        const hooksEnabled = readHooksEnabled();
        if (hooksEnabled) {
          console.log("PASS  hooks.internal.enabled = true");
        } else {
          console.log("FAIL  hooks.internal.enabled is not set");
          allPassed = false;
        }

        // 2. constitution loads
        try {
          console.log(
            `PASS  constitution: ${constitution.identity.agent_name} (${constitutionPath})`
          );
          if (constitution.policy_hash) {
            console.log(
              `INFO  policy_hash: ${constitution.policy_hash.slice(0, 16)}...`
            );
          }
          console.log(
            `INFO  version: ${constitution.schema_version}`
          );
        } catch {
          console.log("FAIL  constitution failed to load");
          allPassed = false;
        }

        // 3. receipt store writable
        try {
          store.count();
          console.log("PASS  receipt store writable");
        } catch {
          console.log("WARN  receipt store not writable");
        }

        // 4. public key
        if (config.publicKeyPath) {
          if (publicKey) {
            console.log("PASS  public key loaded");
          } else {
            console.log(
              `FAIL  public key not found: ${config.publicKeyPath}`
            );
            allPassed = false;
          }
        }

        // 5. signing + verification combo
        if (deps.publicKey && config.privateKeyPath) {
          console.log("INFO  signing + verification keys configured");
        }

        // Summary
        console.log(
          allPassed
            ? "\nGovernance is ready."
            : "\nGovernance has issues. Fix the FAIL items above."
        );
      });
    },
    { commands: ["sanna"] }
  );
}

// ---------------------------------------------------------------------------
// Audit table formatting
// ---------------------------------------------------------------------------

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

interface AuditRow {
  time: string;
  tool: string;
  verdict: string;
  reason: string;
}

function extractRow(entry: unknown): AuditRow {
  const r = entry as Record<string, unknown>;
  const inputs = (r.inputs ?? {}) as Record<string, unknown>;
  const outputs = (r.outputs ?? {}) as Record<string, unknown>;
  const enforcement = (r.enforcement ?? {}) as Record<string, unknown>;

  // Time: parse ISO timestamp to local HH:MM:SS
  let time = "??:??:??";
  const ts = enforcement.timestamp as string | undefined;
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      time = d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    }
  }

  const tool = (inputs.tool as string) ?? "unknown";
  const rawVerdict = (outputs.verdict as string) ?? "unknown";
  const reason = (outputs.reason as string) ?? "";

  // Normalize verdict display
  let verdict: string;
  if (rawVerdict === "allow") verdict = "ALLOW";
  else if (rawVerdict === "escalate") verdict = "ESCALATE";
  else verdict = "HALT";

  return { time, tool, verdict, reason };
}

function colorVerdict(verdict: string): string {
  if (verdict === "ALLOW") return `${ANSI.green}${verdict}${ANSI.reset}`;
  if (verdict === "ESCALATE") return `${ANSI.yellow}${verdict}${ANSI.reset}`;
  return `${ANSI.red}${verdict}${ANSI.reset}`;
}

/** Visible character length (strips ANSI escape sequences). */
function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padRight(s: string, width: number): string {
  const pad = width - visLen(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function printAuditTable(
  receipts: unknown[],
  constitutionName: string,
  mode: string
): void {
  const rows = receipts.map(extractRow);

  // Column widths: auto-size with reasonable maximums
  const MAX_TIME = 8;
  const MAX_TOOL = 20;
  const MAX_VERDICT = 8; // "ESCALATE"
  const MAX_REASON = 50;

  const colTime = Math.max(4, ...rows.map((r) => r.time.length), MAX_TIME);
  const colTool = Math.min(
    MAX_TOOL,
    Math.max(4, ...rows.map((r) => r.tool.length))
  );
  const colVerdict = MAX_VERDICT;
  const colReason = Math.min(
    MAX_REASON,
    Math.max(6, ...rows.map((r) => r.reason.length))
  );

  // Box drawing helpers
  const hLine = (left: string, mid: string, right: string) =>
    `${left}${"─".repeat(colTime + 2)}${mid}${"─".repeat(colTool + 2)}${mid}${"─".repeat(colVerdict + 2)}${mid}${"─".repeat(colReason + 2)}${right}`;

  const row = (a: string, b: string, c: string, d: string) =>
    `│ ${padRight(a, colTime)} │ ${padRight(b, colTool)} │ ${padRight(c, colVerdict)} │ ${padRight(d, colReason)} │`;

  // Header banner (full-width, no column dividers)
  // Inner width between ┌ and ┐ must match hLine: (col+2)*4 + 3 mids = cols + 11
  const bannerWidth = colTime + colTool + colVerdict + colReason + 11;
  const title = `${ANSI.bold}SANNA GOVERNANCE AUDIT${ANSI.reset}`;
  const info = `Constitution: ${constitutionName}    Mode: ${mode}`;

  console.log(`┌${"─".repeat(bannerWidth)}┐`);
  console.log(`│ ${padRight(title, bannerWidth - 1)}│`);
  console.log(`│ ${padRight(info, bannerWidth - 1)}│`);

  // Column headers
  console.log(hLine("├", "┬", "┤"));
  console.log(
    row(
      `${ANSI.bold}TIME${ANSI.reset}`,
      `${ANSI.bold}TOOL${ANSI.reset}`,
      `${ANSI.bold}VERDICT${ANSI.reset}`,
      `${ANSI.bold}REASON${ANSI.reset}`
    )
  );
  console.log(hLine("├", "┼", "┤"));

  // Data rows
  for (const r of rows) {
    console.log(
      row(
        r.time,
        truncate(r.tool, colTool),
        colorVerdict(r.verdict),
        truncate(r.reason, colReason)
      )
    );
  }

  // Bottom border
  console.log(hLine("└", "┴", "┘"));

  // Summary line
  const total = rows.length;
  const allowed = rows.filter((r) => r.verdict === "ALLOW").length;
  const escalated = rows.filter((r) => r.verdict === "ESCALATE").length;
  const halted = rows.filter((r) => r.verdict === "HALT").length;
  console.log(
    `${ANSI.dim}${total} decisions: ${allowed} allowed, ${escalated} escalated, ${halted} halted${ANSI.reset}`
  );
}

// ---------------------------------------------------------------------------
// Commander helpers (loose typing since we don't depend on Commander)
// ---------------------------------------------------------------------------

interface CommandBuilder {
  command: (name: string) => CommandBuilder;
  description: (desc: string) => CommandBuilder;
  option: (flags: string, desc: string) => CommandBuilder;
  argument: (arg: string) => CommandBuilder;
  action: (fn: (...args: unknown[]) => void | Promise<void>) => CommandBuilder;
}

function addCommand(
  parent: CommandBuilder,
  name: string,
  desc: string,
  fn: () => Promise<void>
): void {
  parent.command(name).description(desc).action(fn);
}

function addCommandWithOptions(
  parent: CommandBuilder,
  name: string,
  desc: string,
  options: Record<string, string>,
  fn: (opts: Record<string, string>) => Promise<void>
): void {
  let cmd = parent.command(name).description(desc);
  for (const [flags, optDesc] of Object.entries(options)) {
    cmd = cmd.option(flags, optDesc);
  }
  cmd.action(fn as (...args: unknown[]) => Promise<void>);
}

function addCommandWithArg(
  parent: CommandBuilder,
  name: string,
  desc: string,
  arg: string,
  fn: (value: string) => Promise<void>
): void {
  parent
    .command(name)
    .description(desc)
    .argument(arg)
    .action(fn as (...args: unknown[]) => Promise<void>);
}

function addCommandWithArgAndOptions(
  parent: CommandBuilder,
  name: string,
  desc: string,
  arg: string,
  options: Record<string, string>,
  fn: (value: string, opts: Record<string, string>) => Promise<void>
): void {
  let cmd = parent.command(name).description(desc).argument(arg);
  for (const [flags, optDesc] of Object.entries(options)) {
    cmd = cmd.option(flags, optDesc);
  }
  cmd.action(fn as (...args: unknown[]) => Promise<void>);
}
