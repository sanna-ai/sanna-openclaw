/**
 * Tool registration — utility tools only.
 *
 * The sanna_* wrapper architecture has been replaced by before_tool_call
 * hook-based enforcement. Native tools execute normally in the agent loop;
 * the hook evaluates governance before each call.
 *
 * This module is retained for potential utility tools (e.g. sanna_verify)
 * and for the KNOWN_SCHEMAS export used in tests.
 */

import type { SannaConfig, PluginAPI } from "./types.js";

/** Composite tools that use an "action" parameter to select behavior. */
export const COMPOSITE_TOOLS = new Set([
  "browser",
  "message",
  "nodes",
  "cron",
  "gateway",
]);

/**
 * Best-effort parameter hints for known tools. All schemas keep
 * additionalProperties: true so extra params always pass through.
 */
export const KNOWN_SCHEMAS: Record<string, Record<string, unknown>> = {
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

/** No-op — wrapper tools are no longer registered. Hooks handle enforcement. */
export function registerTools(_api: PluginAPI, _config: SannaConfig): void {
  // Intentionally empty. Hook-based enforcement replaces wrapper tools.
}
