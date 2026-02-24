/**
 * sanna-openclaw plugin entry point.
 *
 * Called by the OpenClaw Gateway to register the governance plugin.
 */

import type { PluginAPI, PluginConfig, Logger } from "./types.js";
import { DEFAULT_SIDECAR_CONFIG } from "./types.js";
import { SidecarManager } from "./sidecar.js";
import { SidecarClient } from "./client.js";
import { registerEnforcementGate } from "./enforcement/gate.js";
import { registerIntercept } from "./enforcement/intercept.js";
import { registerAuditHook } from "./hooks/audit.js";
import { registerCheckTool } from "./tools/check.js";
import { registerStatusTool } from "./tools/status.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerReceiptsCommand } from "./commands/receipts.js";
import { registerConstitutionCommand } from "./commands/constitution.js";

export { SidecarManager } from "./sidecar.js";
export { SidecarClient } from "./client.js";
export { TOOL_MAP } from "./types.js";
export { registerEnforcementGate, enforceAndForward, forwardToGateway } from "./enforcement/gate.js";
export { generateDenyList, generateAllowList } from "./enforcement/policy.js";
export { registerIntercept } from "./enforcement/intercept.js";
export { registerAuditHook } from "./hooks/audit.js";
export { registerCheckTool } from "./tools/check.js";
export { registerStatusTool } from "./tools/status.js";
export { registerDashboardCommand, formatDashboard } from "./commands/dashboard.js";
export { registerReceiptsCommand, parseReceiptFilters, formatReceiptList } from "./commands/receipts.js";
export { registerConstitutionCommand, formatConstitutionView } from "./commands/constitution.js";
export type {
  PluginConfig,
  PluginAPI,
  ToolDefinition,
  EnforceRequest,
  EnforceResponse,
  AuditRequest,
  AuditResponse,
  Receipt,
  ReceiptSummary,
  StatusResponse,
} from "./types.js";

/** Console-based logger for the sidecar manager */
const consoleLogger: Logger = {
  info: (msg) => console.log(`[sanna] ${msg}`),
  warn: (msg) => console.warn(`[sanna] ${msg}`),
  error: (msg) => console.error(`[sanna] ${msg}`),
  debug: (msg) => console.debug(`[sanna] ${msg}`),
};

/**
 * Register the Sanna governance plugin with the OpenClaw Gateway.
 *
 * This is the main entry point called by the Gateway plugin loader.
 */
export function register(api: PluginAPI): void {
  // 1. Read config with defaults
  const raw = api.getConfig() as PluginConfig;
  const config: PluginConfig = {
    ...raw,
    sidecarPort: raw.sidecarPort ?? DEFAULT_SIDECAR_CONFIG.port,
    sidecarHost: raw.sidecarHost ?? DEFAULT_SIDECAR_CONFIG.host,
    governedTools: raw.governedTools ?? DEFAULT_SIDECAR_CONFIG.governedTools,
  };

  // 2. Create the sidecar manager
  const manager = new SidecarManager(config, consoleLogger);

  // 3. Register as a managed service (lifecycle: start/stop)
  api.registerService({
    name: "sanna-sidecar",
    start: () => manager.start(),
    stop: () => manager.stop(),
  });

  // 4. Create HTTP client for sidecar communication
  const client = new SidecarClient(config.sidecarHost, config.sidecarPort);

  // 5. Register enforcement gate (wrapper tools)
  registerEnforcementGate(api, client, config.governedTools);

  // 6. Register safety net intercept hook
  registerIntercept(api, config.governedTools);

  // 7. Register audit hook
  registerAuditHook(api, client);

  // 8. Register utility tools
  registerCheckTool(api, client);
  registerStatusTool(api, client);

  // 9. Register slash commands
  registerDashboardCommand(api, client);
  registerReceiptsCommand(api, client);
  registerConstitutionCommand(api, client);
}
