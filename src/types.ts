/**
 * TypeScript interfaces for the sanna-openclaw plugin.
 */

// ---------------------------------------------------------------------------
// Plugin configuration (matches openclaw.plugin.json configSchema)
// ---------------------------------------------------------------------------

export interface SannaConfig {
  constitutionPath?: string;
  gatewayPort?: number;
  gatewayToken?: string;
  sidecarPort?: number;
  governedTools?: string[];
  enforcementMode?: "enforce" | "audit" | "passthrough";
}

// ---------------------------------------------------------------------------
// Sidecar communication
// ---------------------------------------------------------------------------

/** POST /enforce request body */
export interface EnforceRequest {
  tool: string;
  args: Record<string, unknown>;
  action?: string;
  session?: string;
  timestamp: string;
}

/** POST /enforce response body */
export interface EnforceResponse {
  decision: "allow" | "deny" | "escalate";
  receipt_hash?: string;
  receipt?: Record<string, unknown>;
  reason?: string;
  constitution_id?: string;
}

// ---------------------------------------------------------------------------
// Gateway forwarding
// ---------------------------------------------------------------------------

/** POST /tools/invoke request body */
export interface ToolInvokeRequest {
  tool: string;
  args: Record<string, unknown>;
  action?: string;
  sessionKey?: string;
}

// ---------------------------------------------------------------------------
// OpenClaw tool result format
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// OpenClaw Plugin API (only what we use)
// ---------------------------------------------------------------------------

export interface PluginAPI {
  registerTool(
    def: ToolDefinition,
    opts?: { optional?: boolean }
  ): void;
  registerService(svc: {
    id: string;
    start: () => void | Promise<void>;
    stop: () => void | Promise<void>;
  }): void;
  registerHook(
    event: string,
    handler: (...args: unknown[]) => unknown,
    opts?: { name?: string; description?: string }
  ): void;
  registerGatewayMethod(
    name: string,
    handler: (ctx: {
      respond: (ok: boolean, payload: unknown) => void;
    }) => void
  ): void;
  registerCli(
    fn: (ctx: { program: unknown }) => void,
    opts?: { commands: string[] }
  ): void;
  config: Record<string, unknown>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    id: string,
    params: Record<string, unknown>
  ) => Promise<ToolResult>;
}
