/**
 * Tool registration — wrapper tools that replace governed core tools.
 *
 * Each governed tool gets a sanna_* wrapper that enforces the constitution
 * before forwarding execution to the gateway via /tools/invoke.
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import { enforceAndForward } from "./enforce.js";

/** Composite tools that use an "action" parameter to select behavior. */
const COMPOSITE_TOOLS = new Set([
  "browser",
  "message",
  "nodes",
  "cron",
  "gateway",
]);

/** Register sanna_* wrapper tools for all governed tools. */
export function registerTools(api: PluginAPI, config: SannaConfig): void {
  const tools = config.governedTools ?? [];

  for (const toolName of tools) {
    const isComposite = COMPOSITE_TOOLS.has(toolName);

    const description = isComposite
      ? `Governed version of ${toolName}. Accepts the same parameters including "action". Enforces Sanna constitution before execution.`
      : `Governed version of ${toolName}. Enforces Sanna constitution before execution. Use this instead of ${toolName}.`;

    api.registerTool(
      {
        name: `sanna_${toolName}`,
        description,
        parameters: { type: "object", additionalProperties: true },
        execute: async (_id, params) => {
          const action =
            isComposite && typeof params.action === "string"
              ? params.action
              : undefined;
          return enforceAndForward(config, toolName, params, action);
        },
      },
      { optional: false }
    );

    api.logger.info(`[sanna] Registered governed tool: sanna_${toolName}`);
  }
}
