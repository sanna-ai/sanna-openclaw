/**
 * Wrapper tool registration and enforcement flow.
 *
 * Registers governance-wrapped versions of core tools (sanna_exec, sanna_write, etc.)
 * that evaluate actions against the constitution before executing them.
 */

import type {
  OpenClawPluginAPI,
  SidecarConfig,
  ToolResult,
  ToolCallContext,
} from "../types.js";
import { SidecarClient } from "../client.js";
import { handleEscalation } from "./escalation.js";

/**
 * Build the mapping from wrapper tool names to governed core tool names.
 * Core tools: exec, write, edit, apply_patch, browser_navigate, browser_click
 * Wrapper tools: sanna_exec, sanna_write, sanna_edit, etc.
 */
function buildWrapperMap(governedTools: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tool of governedTools) {
    map[`sanna_${tool}`] = tool;
  }
  return map;
}

/** Register all wrapper tools with the OpenClaw API */
export function registerWrapperTools(
  api: OpenClawPluginAPI,
  client: SidecarClient,
  config: SidecarConfig
): void {
  const wrapperMap = buildWrapperMap(config.governedTools);

  for (const [wrapperName, coreTool] of Object.entries(wrapperMap)) {
    api.registerTool({
      name: wrapperName,
      description: `Governance-enforced wrapper for ${coreTool}. Evaluates the action against the loaded Sanna constitution before execution.`,
      schema: {
        type: "object",
        properties: {
          args: {
            type: "object",
            description: `Arguments to pass to the underlying ${coreTool} tool`,
          },
        },
        required: ["args"],
      },
      handler: createEnforcementHandler(api, client, coreTool),
    });
  }
}

/** Create an enforcement handler for a specific core tool */
function createEnforcementHandler(
  api: OpenClawPluginAPI,
  client: SidecarClient,
  coreTool: string
): (args: Record<string, unknown>) => Promise<ToolResult> {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const innerArgs = (args.args ?? args) as Record<string, unknown>;

    const context: ToolCallContext = {
      session_id: api.getSessionId(),
      agent_id: api.getAgentId(),
      conversation_turn: api.getConversationTurn(),
      timestamp: new Date().toISOString(),
    };

    api.log.debug(`Enforcing ${coreTool} against constitution`);

    let response;
    try {
      response = await client.enforce({ tool: coreTool, args: innerArgs, context });
    } catch (err) {
      // Sidecar unreachable = HALT. Never fail open.
      api.log.error(`Constitution enforcement failed: ${err}`);
      return {
        content: `HALT: Governance sidecar unreachable. Tool execution blocked for safety. Error: ${err}`,
        isError: true,
      };
    }

    switch (response.verdict) {
      case "allow":
        api.log.info(
          `${coreTool} allowed (receipt: ${response.receipt?.receipt_id ?? "none"})`
        );
        return {
          content: JSON.stringify({
            _sanna_passthrough: true,
            tool: coreTool,
            args: innerArgs,
            receipt_id: response.receipt?.receipt_id ?? null,
          }),
        };

      case "deny":
        api.log.warn(`${coreTool} DENIED: ${response.reason}`);
        return {
          content: `Action denied by governance constitution.\nReason: ${response.reason}\nFailed checks: ${response.failed_checks.map((c) => c.id).join(", ")}`,
          isError: true,
        };

      case "halt":
        api.log.error(`${coreTool} HALTED: ${response.reason}`);
        return {
          content: `HALT: ${response.reason}`,
          isError: true,
        };

      case "escalate":
        api.log.warn(`${coreTool} requires escalation`);
        return handleEscalation(api, coreTool, innerArgs, response);

      default:
        return {
          content: `HALT: Unknown verdict "${response.verdict}" from constitution enforcement`,
          isError: true,
        };
    }
  };
}
