/**
 * Sidecar lifecycle management.
 *
 * Spawns the Python sidecar as a child process, waits for health,
 * and registers it as a managed service with the Gateway.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SannaConfig, PluginAPI } from "./types.js";

/** Plugin root directory (parent of dist/). */
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HEALTH_RETRIES = 10;
const HEALTH_DELAY_MS = 500;

export function registerSidecar(api: PluginAPI, config: SannaConfig): void {
  let child: ChildProcess | null = null;

  api.registerService({
    id: "sanna-sidecar",

    start: async () => {
      const port = config.sidecarPort ?? 18890;
      const args = ["-m", "sidecar", "--port", String(port)];
      if (config.constitutionPath) {
        args.push("--constitution", config.constitutionPath);
      }

      // Add plugin root to PYTHONPATH so Python can find the sidecar package
      const existingPythonPath = process.env.PYTHONPATH ?? "";
      const pythonPath = existingPythonPath
        ? `${PLUGIN_ROOT}:${existingPythonPath}`
        : PLUGIN_ROOT;

      child = spawn("python3", args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: PLUGIN_ROOT,
        env: { ...process.env, PYTHONPATH: pythonPath },
      });

      child.stdout?.on("data", (data: Buffer) => {
        api.logger.info(`[sanna:sidecar] ${data.toString().trimEnd()}`);
      });

      child.stderr?.on("data", (data: Buffer) => {
        api.logger.warn(`[sanna:sidecar] ${data.toString().trimEnd()}`);
      });

      child.on("error", (err) => {
        api.logger.error(`[sanna] Sidecar process error: ${err.message}`);
      });

      child.on("exit", (code) => {
        if (code !== null && code !== 0) {
          api.logger.error(`[sanna] Sidecar exited with code ${code}`);
        }
        child = null;
      });

      // Wait for health check
      const url = `http://127.0.0.1:${port}/health`;
      let healthy = false;

      for (let i = 0; i < HEALTH_RETRIES; i++) {
        await delay(HEALTH_DELAY_MS);
        try {
          const res = await fetch(url);
          if (res.ok) {
            healthy = true;
            break;
          }
        } catch {
          // Sidecar not ready yet
        }
      }

      if (!healthy) {
        // Kill the child if health never passed
        if (child) {
          child.kill("SIGTERM");
          child = null;
        }
        throw new Error(
          `[sanna] Sidecar failed health check after ${HEALTH_RETRIES} retries`
        );
      }

      api.logger.info(`[sanna] Sidecar started on port ${port}`);
    },

    stop: async () => {
      if (child) {
        child.kill("SIGTERM");
        child = null;
      }
      api.logger.info("[sanna] Sidecar stopped");
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
