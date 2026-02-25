/**
 * sanna-openclaw plugin entry point.
 *
 * Called by the OpenClaw Gateway plugin loader.
 *
 * Architecture: before_tool_call hook is the primary enforcement point.
 * Every tool call in the agent loop passes through the hook, which evaluates
 * authority via @sanna-ai/core in-process. No sidecar, no HTTP, no Python.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import type { KeyObject } from "node:crypto";
import type { PluginAPI } from "./types.js";
import { resolveConfig } from "./config.js";
import { readHooksEnabled } from "./http.js";
import { loadConstitution, loadPrivateKey, ReceiptStore } from "@sanna-ai/core";
import type { Constitution } from "@sanna-ai/core";
import { registerHooks } from "./hooks.js";
import { registerGatewayMethods } from "./gateway.js";
import { registerCli } from "./cli.js";

// import.meta.url is undefined when OpenClaw loads the plugin via jiti,
// so fall back to __dirname (injected by CJS/jiti) or process.cwd().
const PLUGIN_ROOT = resolve(
  import.meta.url
    ? dirname(fileURLToPath(import.meta.url))
    : typeof __dirname !== "undefined"
      ? __dirname
      : process.cwd(),
  ".."
);

/**
 * Resolve constitution path. Priority:
 * 1. config.constitutionPath (explicit)
 * 2. constitutions/ directory in plugin root (auto-discover)
 */
function resolveConstitutionPath(configPath: string): string | null {
  // Explicit path
  if (configPath) {
    if (existsSync(configPath)) return configPath;
    return null;
  }

  // Auto-discover from plugin's constitutions/ directory
  const constitutionsDir = resolve(PLUGIN_ROOT, "constitutions");
  if (!existsSync(constitutionsDir)) return null;

  // Priority: default.yaml > constitution.yaml > developer.yaml > first yaml
  for (const name of [
    "default.yaml",
    "default.yml",
    "constitution.yaml",
    "constitution.yml",
    "developer.yaml",
    "developer.yml",
  ]) {
    const candidate = resolve(constitutionsDir, name);
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: first .yaml/.yml file alphabetically
  try {
    const files = readdirSync(constitutionsDir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort();
    if (files.length > 0) return resolve(constitutionsDir, files[0]);
  } catch {
    // ignore
  }

  return null;
}

export default function register(api: PluginAPI): void {
  const config = resolveConfig(api);

  // hooks.internal.enabled must be true for before_tool_call to fire.
  const hooksEnabled = readHooksEnabled();
  if (!hooksEnabled) {
    const msg =
      "[sanna] hooks.internal.enabled is not set in ~/.openclaw/openclaw.json. " +
      "Governance hooks will not fire. Set hooks.internal.enabled = true to enable enforcement.";
    if (config.enforcementMode === "enforce") {
      api.logger.error(msg);
      throw new Error(msg);
    }
    api.logger.warn(msg);
  }

  // Load constitution
  const constitutionPath = resolveConstitutionPath(
    config.constitutionPath ?? ""
  );
  let constitution: Constitution;
  if (!constitutionPath) {
    const msg = "[sanna] No constitution found. Governance cannot enforce.";
    if (config.enforcementMode === "enforce") {
      api.logger.error(msg);
      throw new Error(msg);
    }
    api.logger.warn(msg);
    // Can't register hooks without a constitution
    api.logger.info(
      `[sanna] Plugin loaded in ${config.enforcementMode} mode (no constitution).`
    );
    return;
  }

  try {
    constitution = loadConstitution(constitutionPath);
    api.logger.info(
      `[sanna] Constitution loaded: ${constitution.identity.agent_name} from ${constitutionPath}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fullMsg = `[sanna] Failed to load constitution from ${constitutionPath}: ${msg}`;
    if (config.enforcementMode === "enforce") {
      api.logger.error(fullMsg);
      throw new Error(fullMsg);
    }
    api.logger.warn(fullMsg);
    return;
  }

  // Open receipt store
  const storePath =
    config.receiptStorePath ||
    resolve(homedir(), ".sanna", "receipts", "openclaw.db");
  const store = new ReceiptStore(storePath);

  // Load private key (optional)
  let privateKey: KeyObject | null = null;
  if (config.privateKeyPath && existsSync(config.privateKeyPath)) {
    try {
      privateKey = loadPrivateKey(config.privateKeyPath);
      api.logger.info("[sanna] Signing key loaded.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.logger.warn(`[sanna] Failed to load signing key: ${msg}`);
    }
  }

  api.logger.info(
    `[sanna] Governance plugin loaded. Mode: ${config.enforcementMode}`
  );

  registerHooks(api, config, { constitution, store, privateKey });
  registerGatewayMethods(api, config, { constitution, store });
  registerCli(api, config, { constitution, store, constitutionPath });
}
