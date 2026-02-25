/**
 * CLI commands: openclaw sanna status|audit|verify
 *
 * These commands are registered via api.registerCli and exposed
 * through the OpenClaw CLI tool.
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import { fetchWithTimeout, readHooksEnabled } from "./http.js";
import { existsSync } from "node:fs";

const SIDECAR_TIMEOUT_MS = 5_000;

/** Register CLI commands under `openclaw sanna`. */
export function registerCli(api: PluginAPI, config: SannaConfig): void {
  const port = config.sidecarPort ?? 18890;
  const baseUrl = `http://127.0.0.1:${port}`;

  api.registerCli(
    ({ program }) => {
      // program is a Commander instance — cast to any for subcommand API
      const prog = program as {
        command: (name: string) => CommandBuilder;
      };

      const sanna = prog.command("sanna");
      (sanna as unknown as { description: (d: string) => void }).description(
        "Sanna governance"
      );

      // openclaw sanna status
      addCommand(sanna, "status", "Show governance status", async () => {
        try {
          const healthRes = await fetchWithTimeout(
            `${baseUrl}/health`,
            {},
            SIDECAR_TIMEOUT_MS
          );
          const healthy = healthRes.ok;

          if (!healthy) {
            console.log("Sidecar: unreachable");
            console.log(`Mode: ${config.enforcementMode ?? "enforce"}`);
            return;
          }

          const statusRes = await fetchWithTimeout(
            `${baseUrl}/status`,
            {},
            SIDECAR_TIMEOUT_MS
          );
          if (statusRes.ok) {
            const status = (await statusRes.json()) as Record<string, unknown>;
            console.log("Sidecar: healthy");
            console.log(`Mode: ${config.enforcementMode ?? "enforce"}`);
            console.log(
              `Constitution: ${config.constitutionPath ?? "(not set)"}`
            );
            console.log(
              `Governed tools: ${(config.governedTools ?? []).join(", ")}`
            );
            if (status.constitution) {
              console.log(
                `Constitution loaded: ${JSON.stringify(status.constitution)}`
              );
            }
            if (status.enforcement_stats) {
              console.log(
                `Stats: ${JSON.stringify(status.enforcement_stats)}`
              );
            }
          }
        } catch {
          console.log("Sidecar: unreachable");
          console.log(`Mode: ${config.enforcementMode ?? "enforce"}`);
        }
      });

      // openclaw sanna audit (POST /audit)
      addCommandWithOptions(
        sanna,
        "audit",
        "Show recent enforcement decisions",
        { "--limit <n>": "Number of recent decisions" },
        async (opts: Record<string, string>) => {
          try {
            const limit = parseInt(opts.limit ?? "20", 10);
            const res = await fetchWithTimeout(
              `${baseUrl}/audit`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ limit }),
              },
              SIDECAR_TIMEOUT_MS
            );
            if (!res.ok) {
              console.error(`Sidecar returned HTTP ${res.status}`);
              return;
            }
            const data = (await res.json()) as unknown[];
            if (data.length === 0) {
              console.log("No recent enforcement decisions.");
              return;
            }
            for (const entry of data) {
              console.log(JSON.stringify(entry));
            }
          } catch {
            console.error("Sidecar unreachable");
          }
        }
      );

      // openclaw sanna verify <receipt-hash>
      addCommandWithArg(
        sanna,
        "verify",
        "Verify a receipt",
        "<receipt-hash>",
        async (hash: string) => {
          try {
            const res = await fetchWithTimeout(
              `${baseUrl}/verify/${hash}`,
              {},
              SIDECAR_TIMEOUT_MS
            );
            if (!res.ok) {
              console.error(`Verification failed: HTTP ${res.status}`);
              return;
            }
            const data = (await res.json()) as Record<string, unknown>;
            console.log(
              data.valid ? "Receipt is VALID" : "Receipt is INVALID"
            );
            console.log(JSON.stringify(data, null, 2));
          } catch {
            console.error("Sidecar unreachable");
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

        // 2. sidecar reachable
        try {
          const res = await fetchWithTimeout(
            `${baseUrl}/health`,
            {},
            SIDECAR_TIMEOUT_MS
          );
          if (res.ok) {
            console.log("PASS  sidecar reachable");
          } else {
            console.log(`FAIL  sidecar returned HTTP ${res.status}`);
            allPassed = false;
          }
        } catch {
          console.log("FAIL  sidecar unreachable");
          allPassed = false;
        }

        // 3. constitution exists
        const constitutionPath = config.constitutionPath;
        if (constitutionPath && existsSync(constitutionPath)) {
          console.log(`PASS  constitution exists: ${constitutionPath}`);
        } else if (constitutionPath) {
          console.log(`FAIL  constitution not found: ${constitutionPath}`);
          allPassed = false;
        } else {
          console.log("WARN  no constitutionPath configured");
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
