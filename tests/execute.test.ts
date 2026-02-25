import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock readWorkspaceRoot to use a temp directory
let testWorkspace: string;

vi.mock("../src/http.js", () => ({
  readWorkspaceRoot: () => testWorkspace,
}));

import { directExecute } from "../src/execute.js";

beforeEach(() => {
  testWorkspace = join(tmpdir(), `sanna-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testWorkspace, { recursive: true });
});

// ---------------------------------------------------------------------------
// exec / bash
// ---------------------------------------------------------------------------

describe("exec tool", () => {
  it("executes a command and returns stdout", () => {
    const result = directExecute("exec", { command: "echo hello" });
    expect(result.content[0].text).toContain("hello");
  });

  it("returns error when command is missing", () => {
    const result = directExecute("exec", {});
    expect(result.content[0].text).toContain("Error");
    expect(result.content[0].text).toContain("command");
  });

  it("returns output on non-zero exit", () => {
    const result = directExecute("exec", { command: "echo fail-output && exit 1" });
    expect(result.content[0].text).toContain("exited with code");
    expect(result.content[0].text).toContain("fail-output");
  });

  it("bash tool works the same as exec", () => {
    const result = directExecute("bash", { command: "echo bash-test" });
    expect(result.content[0].text).toContain("bash-test");
  });
});

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

describe("write tool", () => {
  it("writes a file and reports byte count", () => {
    const filePath = join(testWorkspace, "test-write.txt");
    const result = directExecute("write", { path: filePath, content: "hello world" });
    expect(result.content[0].text).toContain("Wrote");
    expect(result.content[0].text).toContain("11 bytes");
    expect(readFileSync(filePath, "utf-8")).toBe("hello world");
  });

  it("creates parent directories", () => {
    const filePath = join(testWorkspace, "sub", "dir", "file.txt");
    const result = directExecute("write", { path: filePath, content: "nested" });
    expect(result.content[0].text).toContain("Wrote");
    expect(readFileSync(filePath, "utf-8")).toBe("nested");
  });

  it("resolves relative paths against workspace root", () => {
    const result = directExecute("write", { path: "relative.txt", content: "rel" });
    expect(result.content[0].text).toContain("Wrote");
    expect(readFileSync(join(testWorkspace, "relative.txt"), "utf-8")).toBe("rel");
  });

  it("returns error when path is missing", () => {
    const result = directExecute("write", { content: "hello" });
    expect(result.content[0].text).toContain("Error");
  });

  it("returns error when content is missing", () => {
    const result = directExecute("write", { path: "/tmp/x.txt" });
    expect(result.content[0].text).toContain("Error");
  });
});

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

describe("edit tool", () => {
  it("replaces old_text with new_text", () => {
    const filePath = join(testWorkspace, "edit-test.txt");
    writeFileSync(filePath, "hello world", "utf-8");

    const result = directExecute("edit", {
      path: filePath,
      old_text: "world",
      new_text: "universe",
    });
    expect(result.content[0].text).toContain("Edited");
    expect(readFileSync(filePath, "utf-8")).toBe("hello universe");
  });

  it("returns error when old_text not found", () => {
    const filePath = join(testWorkspace, "edit-miss.txt");
    writeFileSync(filePath, "hello world", "utf-8");

    const result = directExecute("edit", {
      path: filePath,
      old_text: "xyz",
      new_text: "abc",
    });
    expect(result.content[0].text).toContain("not found");
  });

  it("returns error when file does not exist", () => {
    const result = directExecute("edit", {
      path: join(testWorkspace, "nonexistent.txt"),
      old_text: "a",
      new_text: "b",
    });
    expect(result.content[0].text).toContain("File not found");
  });

  it("returns error when old_text/new_text missing", () => {
    const filePath = join(testWorkspace, "edit-no-args.txt");
    writeFileSync(filePath, "content", "utf-8");

    const result = directExecute("edit", { path: filePath });
    expect(result.content[0].text).toContain("Error");
  });
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

describe("read tool", () => {
  it("reads file contents", () => {
    const filePath = join(testWorkspace, "read-test.txt");
    writeFileSync(filePath, "file contents here", "utf-8");

    const result = directExecute("read", { path: filePath });
    expect(result.content[0].text).toBe("file contents here");
  });

  it("returns error for nonexistent file", () => {
    const result = directExecute("read", { path: join(testWorkspace, "nope.txt") });
    expect(result.content[0].text).toContain("File not found");
  });
});

// ---------------------------------------------------------------------------
// unsupported tools
// ---------------------------------------------------------------------------

describe("unsupported tools", () => {
  it("returns error for browser tool", () => {
    const result = directExecute("browser", { action: "navigate", url: "https://example.com" });
    expect(result.content[0].text).toContain("not yet supported");
    expect(result.content[0].text).toContain("browser");
  });

  it("returns error for message tool", () => {
    const result = directExecute("message", { action: "send", to: "user" });
    expect(result.content[0].text).toContain("not yet supported");
  });
});
