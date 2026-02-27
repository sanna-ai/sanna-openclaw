#!/usr/bin/env node
/**
 * Postinstall: copy constitutions from the installed package to the extension
 * root so updated templates take effect without manual copying.
 *
 * When npm installs sanna into an OpenClaw extension directory, the package
 * lands at <extension-root>/node_modules/sanna/. The extension root is two
 * directories up. We copy constitutions/ there so the plugin can find them
 * via auto-discovery.
 */

import { cpSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "..", "constitutions");
const dest = resolve(__dirname, "..", "..", "..", "constitutions");

if (!existsSync(src)) {
  // Not running from an installed package — skip (e.g. during development)
  process.exit(0);
}

try {
  cpSync(src, dest, { recursive: true, force: true });
} catch {
  // Best effort — don't fail the install if copy fails (e.g. permissions)
}
