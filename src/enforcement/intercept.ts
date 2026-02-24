/**
 * before_tool_call safety net hook.
 *
 * This is a structural safety net independent of the wrapper tools.
 * If a tool call somehow bypasses the wrappers (e.g., the agent directly
 * names a governed tool), this hook catches it and blocks execution.
 */

import type { OpenClawPluginAPI, SidecarConfig, HookEvent, HookResult } from "../types.js";
import { getDeniedTools } from "./policy.js";

/** Register the before_tool_call intercept hook */
export function registerInterceptHook(
  api: OpenClawPluginAPI,
  config: SidecarConfig
): void {
  const denied = getDeniedTools(config);

  api.on("before_tool_call", async (event: HookEvent): Promise<HookResult> => {
    if (denied.includes(event.tool)) {
      api.log.warn(
        `Safety net: blocked direct call to governed tool "${event.tool}". ` +
          `Use the sanna_${event.tool} wrapper instead.`
      );
      return {
        allow: false,
        reason: `Direct access to "${event.tool}" is blocked by Sanna governance. Use sanna_${event.tool} instead.`,
      };
    }

    return { allow: true };
  });
}
