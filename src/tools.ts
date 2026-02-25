/**
 * Tool registration — wrapper tools that replace governed core tools.
 *
 * Each governed tool gets a sanna_* wrapper that enforces the constitution
 * before forwarding execution to the gateway via /tools/invoke.
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import { enforceAndForward } from "./enforce.js";

/** Composite tools that use an "action" parameter to select behavior. */
const COMPOSITE_TOOLS = new Set([
  "browser",
  "message",
  "nodes",
  "cron",
  "gateway",
]);

/**
 * Best-effort parameter hints for known tools. All schemas keep
 * additionalProperties: true so extra params always pass through.
 * These may drift from OpenClaw's actual schemas over time.
 */
const KNOWN_SCHEMAS: Record<string, Record<string, unknown>> = {
  exec: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      background: { type: "boolean", description: "Run in background" },
      timeout: { type: "number", description: "Timeout in seconds" },
    },
    required: ["command"],
    additionalProperties: true,
  },
  write: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "File content" },
    },
    required: ["path", "content"],
    additionalProperties: true,
  },
  edit: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to edit" },
      old_text: { type: "string", description: "Text to find" },
      new_text: { type: "string", description: "Replacement text" },
    },
    required: ["path"],
    additionalProperties: true,
  },
  browser: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Browser action (navigate, click, type, etc.)",
      },
      url: { type: "string", description: "URL for navigate action" },
      selector: {
        type: "string",
        description: "CSS selector for click/type actions",
      },
      text: { type: "string", description: "Text for type action" },
    },
    required: ["action"],
    additionalProperties: true,
  },
  message: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Message action (send, reply, etc.)",
      },
      to: { type: "string", description: "Recipient" },
      text: { type: "string", description: "Message content" },
    },
    required: ["action"],
    additionalProperties: true,
  },
};

/** Generic fallback schema for tools without known parameter hints. */
const GENERIC_SCHEMA: Record<string, unknown> = { type: "object", additionalProperties: true };

/** Register sanna_* wrapper tools for all governed tools. */
export function registerTools(api: PluginAPI, config: SannaConfig): void {
  const tools = config.governedTools ?? [];

  for (const toolName of tools) {
    const isComposite = COMPOSITE_TOOLS.has(toolName);

    const description = isComposite
      ? `Governed version of ${toolName}. Accepts the same parameters including "action". Enforces Sanna constitution before execution.`
      : `Governed version of ${toolName}. Enforces Sanna constitution before execution. Use this instead of ${toolName}.`;

    const parameters = KNOWN_SCHEMAS[toolName] ?? GENERIC_SCHEMA;

    api.registerTool(
      {
        name: `sanna_${toolName}`,
        description,
        parameters,
        execute: async (_id, params) => {
          const action =
            isComposite && typeof params.action === "string"
              ? params.action
              : undefined;

          // Wire session context: use explicit sessionKey if present, else _id
          const sessionKey =
            typeof params.sessionKey === "string"
              ? params.sessionKey
              : undefined;

          return enforceAndForward(config, toolName, params, action, {
            session: sessionKey || _id,
          });
        },
      },
      { optional: false }
    );

    api.logger.info(`[sanna] Registered governed tool: sanna_${toolName}`);
  }
}

/** Exported for testing. */
export { KNOWN_SCHEMAS };
