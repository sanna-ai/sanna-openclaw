/**
 * /sanna — main governance dashboard command.
 *
 * Shows constitution info, enforcement stats, and sidecar health.
 * Handles sidecar-down gracefully via client safe defaults.
 */

import type { PluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerDashboardCommand(
  api: PluginAPI,
  client: SidecarClient
): void {
  api.registerCommand({
    name: "sanna",
    handler: async () => {
      const status = await client.status();
      return formatDashboard(status);
    },
  });
}

/** Format status into a markdown dashboard */
export function formatDashboard(status: {
  constitution: {
    name: string;
    version: string;
    hash: string;
    boundaries: { can_execute: number; must_escalate: number; cannot_execute: number };
  } | null;
  enforcement_stats: { total: number; allowed: number; halted: number; escalated: number };
  sidecar_version: string;
}): string {
  const lines: string[] = ["## Sanna Governance Dashboard", ""];

  if (status.constitution) {
    const c = status.constitution;
    lines.push(
      `**Constitution:** ${c.name} v${c.version}`,
      `**Hash:** ${c.hash}`,
      `**Boundaries:** ${c.boundaries.can_execute} allow, ${c.boundaries.must_escalate} escalate, ${c.boundaries.cannot_execute} deny`,
      ""
    );
  } else {
    lines.push("**Constitution:** not loaded", "");
  }

  const s = status.enforcement_stats;
  lines.push(
    `**Enforcement:** ${s.total} total — ${s.allowed} allowed, ${s.halted} halted, ${s.escalated} escalated`,
    `**Sidecar:** ${status.sidecar_version}`,
  );

  return lines.join("\n");
}
