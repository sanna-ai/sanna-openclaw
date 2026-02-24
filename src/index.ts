/**
 * sanna-openclaw plugin entry point.
 *
 * Called by the OpenClaw Gateway to register the governance plugin.
 */

import type { OpenClawPluginAPI, SidecarConfig } from "./types.js";
import { DEFAULT_SIDECAR_CONFIG } from "./types.js";
import { SidecarManager } from "./sidecar.js";
import { registerWrapperTools } from "./enforcement/gate.js";
import { applyDenyList } from "./enforcement/policy.js";
import { registerInterceptHook } from "./enforcement/intercept.js";
import { registerCheckTool } from "./tools/check.js";
import { registerStatusTool } from "./tools/status.js";
import { registerReceiptTool } from "./tools/receipt.js";
import { registerAuditHook } from "./hooks/audit.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerReceiptsCommand } from "./commands/receipts.js";
import { registerVerifyCommand } from "./commands/verify.js";
import { registerConstitutionCommand } from "./commands/constitution.js";
import { registerExportCommand } from "./commands/export.js";
import { registerSetupCommand } from "./commands/setup.js";

export { SidecarManager } from "./sidecar.js";
export { SidecarClient } from "./client.js";
export type {
  OpenClawPluginAPI,
  SidecarConfig,
  EnforceRequest,
  EnforceResponse,
  AuditRequest,
  AuditResponse,
  Receipt,
  Verdict,
} from "./types.js";

/**
 * Register the Sanna governance plugin with the OpenClaw Gateway.
 *
 * This is the main entry point called by the Gateway plugin loader.
 */
export async function register(
  api: OpenClawPluginAPI,
  config: Partial<SidecarConfig> = {}
): Promise<void> {
  const fullConfig: SidecarConfig = { ...DEFAULT_SIDECAR_CONFIG, ...config };

  api.log.info("Initializing Sanna governance plugin...");

  // 1. Create the sidecar manager
  const sidecar = new SidecarManager(fullConfig, api.log);
  const client = sidecar.getClient();

  // 2. Register sidecar as a managed service (lifecycle: start/stop)
  api.registerService({
    name: "sanna-sidecar",
    start: () => sidecar.start(),
    stop: () => sidecar.stop(),
  });

  // 3. Register governance wrapper tools
  registerWrapperTools(api, client, fullConfig);

  // 4. Block direct access to governed tools
  applyDenyList(api, fullConfig);

  // 5. Register the safety net hook
  registerInterceptHook(api, fullConfig);

  // 6. Register utility tools
  registerCheckTool(api, client);
  registerStatusTool(api, client, sidecar);
  registerReceiptTool(api, client);

  // 7. Register audit hook
  registerAuditHook(api, client, fullConfig);

  // 8. Register slash commands
  registerDashboardCommand(api, client, sidecar);
  registerReceiptsCommand(api, client);
  registerVerifyCommand(api, client);
  registerConstitutionCommand(api, client);
  registerExportCommand(api, client);

  // 9. Register CLI commands
  registerSetupCommand(api, client);

  api.log.info("Sanna governance plugin initialized successfully");
}
