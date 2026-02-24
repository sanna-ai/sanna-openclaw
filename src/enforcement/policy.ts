/**
 * Deny-list and allow-list generation for Gateway tool policy.
 *
 * Generates the lists of core tool names to block and sanna_ wrapper
 * names to allow, based on the governed tools configuration.
 */

import { TOOL_MAP } from "../types.js";

/**
 * Generate the deny-list of core tool names that should be blocked.
 *
 * Only includes tools that have entries in TOOL_MAP — unknown tools
 * are silently excluded since they have no corresponding wrapper.
 */
export function generateDenyList(governedTools: string[]): string[] {
  return governedTools.filter((tool) => tool in TOOL_MAP);
}

/**
 * Generate the allow-list of sanna_ wrapper tool names.
 *
 * Returns the corresponding wrapper names from TOOL_MAP for all
 * governed tools that have entries in the map.
 */
export function generateAllowList(governedTools: string[]): string[] {
  return governedTools
    .filter((tool) => tool in TOOL_MAP)
    .map((tool) => TOOL_MAP[tool]);
}
