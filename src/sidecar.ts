/**
 * Python sidecar process lifecycle management.
 *
 * Spawns, monitors, and restarts the Python sidecar process.
 * Includes Python version detection, exponential backoff health checks,
 * and crash recovery with restart limits.
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { PluginConfig, Logger } from "./types.js";
import { SidecarClient } from "./client.js";

const MAX_RESTARTS = 5;
const HEALTH_RETRIES = 10;
const HEALTH_BASE_DELAY_MS = 100;
const HEALTH_MAX_DELAY_MS = 2000;
const CRASH_BASE_DELAY_MS = 1000;
const CRASH_MAX_DELAY_MS = 30_000;
const STOP_TIMEOUT_MS = 5000;
const HEALTH_MONITOR_INTERVAL_MS = 30_000;

export class SidecarManager {
  private process: ChildProcess | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private crashTimer: ReturnType<typeof setTimeout> | null = null;
  private client: SidecarClient;
  private restartCount = 0;
  private maxRestarts = MAX_RESTARTS;
  private sidecarDir: string;
  private pythonPath: string | null = null;
  private stopping = false;

  constructor(
    private config: PluginConfig,
    private log: Logger
  ) {
    this.client = new SidecarClient(config.sidecarHost, config.sidecarPort);
    this.sidecarDir = resolve(process.cwd(), "sidecar");
  }

  getClient(): SidecarClient {
    return this.client;
  }

  /**
   * Detect a suitable Python interpreter (>=3.10).
   *
   * Tries python3 first, then python. If config.pythonPath is set,
   * tries only that path. Throws if no suitable Python is found.
   */
  async detectPython(): Promise<string> {
    const candidates = this.config.pythonPath
      ? [this.config.pythonPath]
      : ["python3", "python"];

    for (const candidate of candidates) {
      try {
        const version = await execCommand(candidate, ["--version"]);
        const match = version.match(/Python\s+(\d+)\.(\d+)/);
        if (match) {
          const major = parseInt(match[1], 10);
          const minor = parseInt(match[2], 10);
          if (major > 3 || (major === 3 && minor >= 10)) {
            this.log.info(`Using Python: ${candidate} (${version.trim()})`);
            return candidate;
          }
          this.log.warn(
            `${candidate} is Python ${major}.${minor} (need >=3.10)`
          );
        }
      } catch {
        // candidate not found, try next
      }
    }

    throw new Error(
      "Python >=3.10 not found. Install Python 3.10+ and ensure python3 or python is on PATH."
    );
  }

  /** Start the sidecar process and wait for it to become healthy */
  async start(): Promise<void> {
    if (this.process) {
      this.log.warn("Sidecar already running, skipping start");
      return;
    }

    this.stopping = false;
    this.pythonPath = await this.detectPython();

    const args = [
      "-m",
      "sidecar",
      "--host",
      this.config.sidecarHost,
      "--port",
      String(this.config.sidecarPort),
    ];

    if (this.config.constitutionPath) {
      args.push("--constitution", this.config.constitutionPath);
    }
    if (this.config.signingKeyPath) {
      args.push("--key", this.config.signingKeyPath);
    }
    if (this.config.receiptStorePath) {
      args.push("--receipt-store", this.config.receiptStorePath);
    }

    this.log.info(
      `Starting sidecar on ${this.config.sidecarHost}:${this.config.sidecarPort}`
    );

    this.process = spawn(this.pythonPath, args, {
      cwd: this.sidecarDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONPATH: this.sidecarDir },
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
      if (!this.stopping) {
        this.handleCrash(code ?? 1);
      }
    });

    await this.waitForHealth();
    this.startHealthMonitor();
  }

  /** Wait for health with exponential backoff (100ms base, 2s cap, 10 retries) */
  private async waitForHealth(): Promise<void> {
    let delay = HEALTH_BASE_DELAY_MS;

    for (let attempt = 0; attempt < HEALTH_RETRIES; attempt++) {
      const healthy = await this.client.health();
      if (healthy) {
        this.log.info("Sidecar healthy");
        return;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, HEALTH_MAX_DELAY_MS);
    }

    throw new Error(
      `Sidecar failed to become healthy after ${HEALTH_RETRIES} attempts`
    );
  }

  /** Handle crash with exponential backoff restart (1s base, 30s cap) */
  private handleCrash(code: number): void {
    this.restartCount++;
    this.log.error(
      `Sidecar crashed (code ${code}), restart ${this.restartCount}/${this.maxRestarts}`
    );

    if (this.restartCount > this.maxRestarts) {
      this.log.error(
        `Max restarts (${this.maxRestarts}) exceeded. Sidecar will not be restarted.`
      );
      return;
    }

    const delay = Math.min(
      CRASH_BASE_DELAY_MS * Math.pow(2, this.restartCount - 1),
      CRASH_MAX_DELAY_MS
    );
    this.log.info(`Scheduling restart in ${delay}ms`);

    this.crashTimer = setTimeout(() => {
      this.crashTimer = null;
      this.start().catch((err) => {
        this.log.error(`Failed to restart sidecar: ${(err as Error).message}`);
      });
    }, delay);
  }

  /** Periodically check sidecar health */
  private startHealthMonitor(): void {
    this.healthTimer = setInterval(async () => {
      const healthy = await this.client.health();
      if (!healthy) {
        this.log.error("Sidecar health check failed");
      }
    }, HEALTH_MONITOR_INTERVAL_MS);
  }

  /** Stop the sidecar process */
  async stop(): Promise<void> {
    this.stopping = true;

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    if (this.crashTimer) {
      clearTimeout(this.crashTimer);
      this.crashTimer = null;
    }

    if (!this.process) return;

    this.log.info("Stopping sidecar...");
    this.process.kill("SIGTERM");

    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        this.process?.on("exit", () => resolve(true));
      }),
      sleep(STOP_TIMEOUT_MS).then(() => false),
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

  /** Check if the sidecar is healthy (last health check passed) */
  isHealthy(): boolean {
    return this.client.isHealthy();
  }

  /** Get the current restart count */
  getRestartCount(): number {
    return this.restartCount;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout || stderr);
    });
  });
}
