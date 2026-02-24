/**
 * Python sidecar process lifecycle management.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { SidecarConfig, Logger } from "./types.js";
import { SidecarClient } from "./client.js";

export class SidecarManager {
  private process: ChildProcess | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private client: SidecarClient;

  constructor(
    private config: SidecarConfig,
    private log: Logger
  ) {
    this.client = new SidecarClient(config);
  }

  getClient(): SidecarClient {
    return this.client;
  }

  /** Start the sidecar process and wait for it to become healthy */
  async start(): Promise<void> {
    if (this.process) {
      this.log.warn("Sidecar already running, skipping start");
      return;
    }

    const sidecarDir = resolve(process.cwd(), "sidecar");
    const args = [
      "-m",
      "sidecar",
      "--host",
      this.config.host,
      "--port",
      String(this.config.port),
      "--constitution",
      this.config.constitutionPath,
    ];

    if (this.config.signingKeyPath) {
      args.push("--key", this.config.signingKeyPath);
    }
    if (this.config.receiptStorePath) {
      args.push("--receipt-store", this.config.receiptStorePath);
    }

    this.log.info(`Starting sidecar on ${this.config.host}:${this.config.port}`);

    this.process = spawn(this.config.pythonPath, args, {
      cwd: sidecarDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.log.debug(`[sidecar stdout] ${data.toString().trimEnd()}`);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.log.warn(`[sidecar stderr] ${data.toString().trimEnd()}`);
    });

    this.process.on("exit", (code) => {
      this.log.warn(`Sidecar exited with code ${code}`);
      this.process = null;
    });

    await this.waitForHealth();
    this.startHealthMonitor();
  }

  /** Wait for the sidecar to respond to health checks */
  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.config.startupTimeoutMs;
    const interval = 200;

    while (Date.now() < deadline) {
      try {
        const health = await this.client.health();
        if (health.status === "ok") {
          this.log.info(`Sidecar healthy (sanna v${health.version})`);
          return;
        }
      } catch {
        // Not ready yet
      }
      await sleep(interval);
    }

    throw new Error(
      `Sidecar failed to become healthy within ${this.config.startupTimeoutMs}ms`
    );
  }

  /** Periodically check sidecar health and restart if needed */
  private startHealthMonitor(): void {
    this.healthTimer = setInterval(async () => {
      try {
        const health = await this.client.health();
        if (health.status === "error") {
          this.log.error("Sidecar reports error status, attempting restart");
          await this.restart();
        }
      } catch {
        this.log.error("Sidecar health check failed, attempting restart");
        await this.restart();
      }
    }, this.config.healthIntervalMs);
  }

  /** Restart the sidecar process */
  async restart(): Promise<void> {
    this.log.info("Restarting sidecar...");
    await this.stop();
    await this.start();
  }

  /** Stop the sidecar process */
  async stop(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    if (!this.process) return;

    this.log.info("Stopping sidecar...");
    this.process.kill("SIGTERM");

    // Wait up to 5s for graceful shutdown
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        this.process?.on("exit", () => resolve(true));
      }),
      sleep(5000).then(() => false),
    ]);

    if (!exited && this.process) {
      this.log.warn("Sidecar did not exit gracefully, sending SIGKILL");
      this.process.kill("SIGKILL");
    }

    this.process = null;
  }

  /** Check if the sidecar process is running */
  isRunning(): boolean {
    return this.process !== null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
