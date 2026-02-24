/**
 * Shared types for the sanna-openclaw plugin.
 */

// ---------------------------------------------------------------------------
// Sidecar communication types
// ---------------------------------------------------------------------------

export interface EnforceRequest {
  tool: string;
  args: Record<string, unknown>;
  context?: Record<string, unknown>;
  reason?: string;
}

export interface Receipt {
  id: string;
  action: string;
  verdict: string;
  reason: string;
  constitution_hash: string;
  boundary_type?: string;
  signature?: string;
  timestamp: string;
}

export interface EnforceResponse {
  verdict: "allow" | "halt" | "escalate";
  reason: string;
  boundary_type?: string;
  failed_checks: string[];
  receipt?: Receipt;
}

export interface AuditRequest {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  context?: Record<string, unknown>;
}

export interface AuditResponse {
  receipt_id: string | null;
  status: string;
}

export interface StatusResponse {
  constitution: {
    name: string;
    version: string;
    hash: string;
    boundaries: {
      can_execute: number;
      must_escalate: number;
      cannot_execute: number;
    };
  } | null;
  enforcement_stats: {
    total: number;
    allowed: number;
    halted: number;
    escalated: number;
  };
  sidecar_version: string;
}

export interface ReceiptSummary {
  id: string;
  tool: string;
  verdict: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Tool mapping: core name → sanna wrapper name
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Minimal OpenClaw plugin API interface for type-checking.
 *
 * We don't have OpenClaw as a real dependency — this interface defines
 * the contract that the real API satisfies at runtime.
 */
export interface PluginAPI {
  registerTool(tool: ToolDefinition): void;
  on(event: string, handler: (...args: unknown[]) => Promise<void>): void;
  registerCommand(command: { name: string; handler: (args: string) => Promise<string> }): void;
  registerCli(cli: { name: string; handler: (args: string[]) => Promise<void> }): void;
  registerService(service: { name: string; start: () => Promise<void>; stop: () => Promise<void> }): void;
  getConfig(): PluginConfig;
}

/** Core tool name → sanna wrapper name */
export const TOOL_MAP: Record<string, string> = {
  exec: "sanna_exec",
  write: "sanna_write",
  edit: "sanna_edit",
  apply_patch: "sanna_patch",
  browser_navigate: "sanna_browse",
  browser_click: "sanna_click",
  browser_type: "sanna_type",
  message: "sanna_message",
  cron: "sanna_cron",
};

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

export interface PluginConfig {
  constitutionPath?: string;
  signingKeyPath?: string;
  publicKeyPath?: string;
  receiptStorePath?: string;
  sidecarPort: number;
  sidecarHost: string;
  pythonPath?: string;
  governedTools: string[];
}

/** Internal resolved sidecar configuration */
export interface SidecarConfig {
  host: string;
  port: number;
  pythonPath: string;
  constitutionPath: string;
  signingKeyPath: string;
  publicKeyPath: string;
  receiptStorePath: string;
  governedTools: string[];
  startupTimeoutMs: number;
  healthIntervalMs: number;
}

/** Default sidecar config */
export const DEFAULT_SIDECAR_CONFIG: SidecarConfig = {
  host: "127.0.0.1",
  port: 18791,
  pythonPath: "python3",
  constitutionPath: "./constitutions",
  signingKeyPath: "",
  publicKeyPath: "",
  receiptStorePath: "",
  governedTools: [
    "exec",
    "write",
    "edit",
    "apply_patch",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "message",
    "cron",
  ],
  startupTimeoutMs: 10_000,
  healthIntervalMs: 30_000,
};

// ---------------------------------------------------------------------------
// OpenClaw plugin API surface
// ---------------------------------------------------------------------------

/**
 * OpenClaw plugin API.
 *
 * Reference:
 *   api.registerTool({ name, description, schema, handler })
 *   api.on('before_tool_call', handler)
 *   api.on('tool_result_persist', handler)
 *   api.registerCommand({ name, handler })
 *   api.registerCli({ name, handler })
 *   api.registerService({ name, start, stop })
 *   Tool names CANNOT shadow core tools (exec, write, edit, etc.)
 *   Gateway tool policy can deny specific tool names
 */
export interface OpenClawPluginAPI {
  registerTool(def: ToolRegistration): void;
  on(event: string, handler: HookHandler): void;
  registerCommand(def: CommandRegistration): void;
  registerCli(def: CliRegistration): void;
  registerService(def: ServiceRegistration): void;
  denyTools(toolNames: string[]): void;
  getSessionId(): string;
  getAgentId(): string;
  getConversationTurn(): number;
  log: Logger;
}

export interface ToolRegistration {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type HookHandler = (event: HookEvent) => Promise<HookResult>;

export interface HookEvent {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
}

export interface HookResult {
  allow: boolean;
  reason?: string;
}

export interface CommandRegistration {
  name: string;
  handler: (args: string[]) => Promise<string>;
}

export interface CliRegistration {
  name: string;
  handler: (args: string[]) => Promise<void>;
}

export interface ServiceRegistration {
  name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}
