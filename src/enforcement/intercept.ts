/**
 * before_tool_call safety net hook.
 *
 * Defense-in-depth: if a governed core tool is somehow called directly
 * (bypassing the deny-list and wrapper tools), this hook catches it
 * and throws to block execution.
 */

import type { PluginAPI } from "../types.js";
import { TOOL_MAP } from "../types.js";

/**
 * Register the before_tool_call intercept hook.
 *
 * The hook throws on any direct call to a governed core tool,
 * directing the caller to use the sanna_ wrapper instead.
 * Wrapper tools (sanna_ prefix) and ungoverned tools pass through.
 */
export function registerIntercept(
  api: PluginAPI,
  governedTools: string[]
): void {
  api.on(
    "before_tool_call",
    async (...hookArgs: unknown[]) => {
      const event = hookArgs[0] as { tool: string; args: Record<string, unknown> };

      // Skip wrapper tools
      if (event.tool.startsWith("sanna_")) return;

      // Skip non-governed tools
      if (!governedTools.includes(event.tool)) return;

      // A governed core tool is being called directly — block it
      const wrapperName = TOOL_MAP[event.tool] || `sanna_${event.tool}`;
      throw new Error(
        `GOVERNANCE BLOCK: Tool '${event.tool}' is governed by Sanna. ` +
          `Use '${wrapperName}' instead.`
      );
    }
  );
}
