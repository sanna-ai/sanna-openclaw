/**
 * TypeScript interfaces for the sanna-openclaw plugin.
 */

// ---------------------------------------------------------------------------
// Plugin configuration (matches openclaw.plugin.json configSchema)
// ---------------------------------------------------------------------------

export interface SannaConfig {
  constitutionPath?: string;
  privateKeyPath?: string;
  publicKeyPath?: string;
  receiptStorePath?: string;
  governedTools?: string[];
  enforcementMode?: "enforce" | "audit" | "passthrough";
  otelExport?: boolean;
  otelServiceName?: string;
  llmChecks?: boolean;
  llmChecksModel?: string;
  customEvaluatorsPath?: string;
  sinkType?: "local_sqlite" | "null" | "composite";
  contentMode?: "full" | "redacted" | "hash_only";
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
  on(
    hookName: string,
    handler: (...args: unknown[]) => unknown,
    opts?: { name?: string; description?: string; priority?: number }
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

// ---------------------------------------------------------------------------
// OpenClaw tool result format
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
}
