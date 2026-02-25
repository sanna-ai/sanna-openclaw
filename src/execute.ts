/**
 * Direct tool execution — runs tools in-process instead of forwarding via HTTP.
 *
 * Core agent tools only exist inside the agent loop; there is no Gateway HTTP
 * endpoint that exposes them. The wrapper tool's execute callback IS the
 * execution context, so we handle it directly here.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ToolResult } from "./types.js";
import { readWorkspaceRoot } from "./http.js";

const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 512_000;

/** Resolve a file path against the workspace root. */
function resolvePath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  return resolve(readWorkspaceRoot(), filePath);
}

/** Format a text ToolResult. */
function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Format an error ToolResult. */
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }] };
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function execTool(args: Record<string, unknown>): ToolResult {
  const command = args.command as string | undefined;
  if (!command) return errorResult("exec requires a 'command' argument");

  const timeout = typeof args.timeout === "number"
    ? args.timeout * 1000
    : EXEC_TIMEOUT_MS;

  try {
    const stdout = execSync(command, {
      encoding: "utf-8",
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      cwd: readWorkspaceRoot(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return textResult(stdout);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
    if (output) {
      return textResult(
        `Command exited with code ${e.status ?? "unknown"}:\n${output}`
      );
    }
    return errorResult(e.message ?? String(err));
  }
}

function writeTool(args: Record<string, unknown>): ToolResult {
  const filePath = args.path as string | undefined;
  const content = args.content as string | undefined;
  if (!filePath) return errorResult("write requires a 'path' argument");
  if (content === undefined) return errorResult("write requires a 'content' argument");

  const resolved = resolvePath(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf-8");
  return textResult(`Wrote ${Buffer.byteLength(content)} bytes to ${resolved}`);
}

function editTool(args: Record<string, unknown>): ToolResult {
  const filePath = args.path as string | undefined;
  if (!filePath) return errorResult("edit requires a 'path' argument");

  const resolved = resolvePath(filePath);
  const oldText = args.old_text as string | undefined;
  const newText = args.new_text as string | undefined;

  if (oldText === undefined || newText === undefined) {
    return errorResult("edit requires 'old_text' and 'new_text' arguments");
  }

  let content: string;
  try {
    content = readFileSync(resolved, "utf-8");
  } catch {
    return errorResult(`File not found: ${resolved}`);
  }

  if (!content.includes(oldText)) {
    return errorResult(`old_text not found in ${resolved}`);
  }

  const updated = content.replace(oldText, newText);
  writeFileSync(resolved, updated, "utf-8");
  return textResult(`Edited ${resolved}`);
}

function applyPatchTool(args: Record<string, unknown>): ToolResult {
  const filePath = args.path as string | undefined;
  const patch = args.patch as string | undefined;
  if (!filePath) return errorResult("apply_patch requires a 'path' argument");
  if (!patch) return errorResult("apply_patch requires a 'patch' argument");

  // apply_patch is essentially an edit: the patch content replaces the file
  // For simple unified diffs this is a best-effort handler
  const resolved = resolvePath(filePath);
  try {
    writeFileSync(resolved, patch, "utf-8");
    return textResult(`Patch applied to ${resolved}`);
  } catch (err: unknown) {
    return errorResult(`Failed to apply patch: ${(err as Error).message}`);
  }
}

function readTool(args: Record<string, unknown>): ToolResult {
  const filePath = args.path as string | undefined;
  if (!filePath) return errorResult("read requires a 'path' argument");

  const resolved = resolvePath(filePath);
  try {
    const content = readFileSync(resolved, "utf-8");
    return textResult(content);
  } catch {
    return errorResult(`File not found: ${resolved}`);
  }
}

function processTool(args: Record<string, unknown>): ToolResult {
  // process tool is similar to exec — runs a command
  const command = args.command as string | undefined;
  if (command) return execTool(args);
  return errorResult("process requires a 'command' argument");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const HANDLERS: Record<string, (args: Record<string, unknown>) => ToolResult> = {
  exec: execTool,
  bash: execTool,
  write: writeTool,
  edit: editTool,
  apply_patch: applyPatchTool,
  read: readTool,
  process: processTool,
};

/**
 * Execute a tool directly in-process.
 * Returns a ToolResult with the output or an error message.
 */
export function directExecute(
  tool: string,
  args: Record<string, unknown>,
): ToolResult {
  const handler = HANDLERS[tool];
  if (handler) {
    return handler(args);
  }

  return errorResult(
    `Direct execution not yet supported for tool "${tool}". ` +
    "This tool requires the OpenClaw agent runtime."
  );
}
