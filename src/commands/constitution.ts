/**
 * /sanna constitution — display the active constitution.
 *
 * Shows constitution name, version, hash, and boundary summary.
 * Handles sidecar-down gracefully via client safe defaults.
 */

import type { PluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerConstitutionCommand(
  api: PluginAPI,
  client: SidecarClient
): void {
  api.registerCommand({
    name: "sanna constitution",
    handler: async () => {
      const status = await client.status();
      return formatConstitutionView(status.constitution);
    },
  });
}

/** Format constitution info into a readable view */
export function formatConstitutionView(
  constitution: {
    name: string;
    version: string;
    hash: string;
    boundaries: { can_execute: number; must_escalate: number; cannot_execute: number };
  } | null
): string {
  if (!constitution) {
    return "No constitution loaded.";
  }

  const b = constitution.boundaries;
  return [
    `## Constitution: ${constitution.name}`,
    "",
    `**Version:** ${constitution.version}`,
    `**Hash:** ${constitution.hash}`,
    "",
    "### Boundaries",
    "",
    `| Type | Count |`,
    `|---|---|`,
    `| can_execute | ${b.can_execute} |`,
    `| must_escalate | ${b.must_escalate} |`,
    `| cannot_execute | ${b.cannot_execute} |`,
  ].join("\n");
}
