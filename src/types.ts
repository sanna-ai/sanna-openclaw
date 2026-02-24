/**
 * Shared types for the sanna-openclaw plugin.
 */

/** Sidecar configuration */
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
  governedTools: ["exec", "write", "edit", "apply_patch", "browser_navigate", "browser_click"],
  startupTimeoutMs: 10_000,
  healthIntervalMs: 30_000,
};

/** Enforcement verdict from the sidecar */
export type Verdict = "allow" | "deny" | "halt" | "escalate";

/** Request to POST /enforce */
export interface EnforceRequest {
  tool: string;
  args: Record<string, unknown>;
  context: ToolCallContext;
}

/** Response from POST /enforce */
export interface EnforceResponse {
  verdict: Verdict;
  reason: string;
  boundary_type: string | null;
  failed_checks: FailedCheck[];
  receipt: Receipt | null;
}

/** A constitution check that failed during enforcement */
export interface FailedCheck {
  id: string;
  section: string;
  description: string;
  effect: string;
}

/** Request to POST /audit */
export interface AuditRequest {
  tool: string;
  args: Record<string, unknown>;
  result: string | null;
  error: string | null;
  context: ToolCallContext;
}

/** Response from POST /audit */
export interface AuditResponse {
  receipt_id: string;
}

/** Context provided to the sidecar for evaluation */
export interface ToolCallContext {
  session_id: string;
  agent_id: string;
  conversation_turn: number;
  timestamp: string;
}

/** A signed receipt */
export interface Receipt {
  receipt_id: string;
  tool: string;
  args_hash: string;
  verdict: string;
  timestamp: string;
  signature: string;
  public_key: string;
}

/** Sidecar health check response */
export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  version: string;
}

/** Sidecar status response */
export interface StatusResponse {
  constitution: Record<string, unknown>;
  enforcement_stats: Record<string, unknown>;
}

/**
 * OpenClaw plugin API surface.
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
