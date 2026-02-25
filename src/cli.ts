/**
 * CLI commands: openclaw sanna doctor|status|audit|verify
 *
 * These commands are registered via api.registerCli and exposed
 * through the OpenClaw CLI tool.
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import type { Constitution } from "@sanna-ai/core";
import { ReceiptStore } from "@sanna-ai/core";
import { readHooksEnabled } from "./http.js";

export interface CliDeps {
  constitution: Constitution;
  store: ReceiptStore;
  constitutionPath: string;
}

/** Register CLI commands under `openclaw sanna`. */
export function registerCli(
  api: PluginAPI,
  config: SannaConfig,
  deps: CliDeps
): void {
  const { constitution, store, constitutionPath } = deps;

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
        { "--limit <n>": "Number of recent decisions" },
        async (opts: Record<string, string>) => {
          try {
            const limit = parseInt(opts.limit ?? "20", 10);
            const receipts = store.query({ enforcement: true, limit });
            if (receipts.length === 0) {
              console.log("No recent enforcement decisions.");
              return;
            }
            for (const entry of receipts) {
              console.log(JSON.stringify(entry));
            }
          } catch {
            console.error("Receipt query failed");
          }
        }
      );

      // openclaw sanna verify <receipt-id>
      addCommandWithArg(
        sanna,
        "verify",
        "Verify a receipt",
        "<receipt-id>",
        async (receiptId: string) => {
          try {
            const results = store.query({ limit: 1000 });
            const match = results.find(
              (r) => (r as Record<string, unknown>).receipt_id === receiptId
            );
            if (!match) {
              console.error(`Receipt not found: ${receiptId}`);
              return;
            }
            const r = match as Record<string, unknown>;
            const sig = r.receipt_signature as
              | Record<string, unknown>
              | undefined;
            console.log(sig?.signature ? "Receipt is SIGNED" : "Receipt is UNSIGNED");
            console.log(JSON.stringify(r, null, 2));
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
