/**
 * /sanna receipts — browse audit receipts with optional filters.
 *
 * Supports: --tool <name>, --verdict <allow|halt|escalate>, --limit <n>
 * Handles sidecar-down gracefully via client safe defaults.
 */

import type { PluginAPI, ReceiptSummary } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerReceiptsCommand(
  api: PluginAPI,
  client: SidecarClient
): void {
  api.registerCommand({
    name: "sanna receipts",
    handler: async (args: string) => {
      const filters = parseReceiptFilters(args);
      const summaries = await client.receipts(filters);
      return formatReceiptList(summaries);
    },
  });
}

/** Parse "--tool exec --verdict halt --limit 20" into filter object */
export function parseReceiptFilters(args: string): {
  tool?: string;
  verdict?: string;
  limit?: number;
} {
  const filters: { tool?: string; verdict?: string; limit?: number } = {};
  const tokens = args.trim().split(/\s+/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (token === "--tool" && next) {
      filters.tool = next;
      i++;
    } else if (token === "--verdict" && next) {
      filters.verdict = next;
      i++;
    } else if (token === "--limit" && next) {
      const n = parseInt(next, 10);
      if (!isNaN(n) && n > 0) filters.limit = n;
      i++;
    }
  }

  return filters;
}

/** Format receipt summaries into a markdown table */
export function formatReceiptList(summaries: ReceiptSummary[]): string {
  if (summaries.length === 0) {
    return "No receipts found.";
  }

  const rows = summaries.map(
    (r) =>
      `| ${r.id.length > 12 ? r.id.slice(0, 12) + "..." : r.id} | ${r.tool} | ${r.verdict} | ${r.timestamp} |`
  );

  return [
    `## Receipts (${summaries.length})`,
    "",
    "| ID | Tool | Verdict | Timestamp |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
