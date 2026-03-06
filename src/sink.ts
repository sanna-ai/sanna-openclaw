/**
 * ReceiptSink abstraction — persistence layer for governance receipts.
 *
 * Decouples hook enforcement from the concrete persistence backend.
 * Default: LocalSQLiteSink wrapping @sanna-ai/core's ReceiptStore.
 */

import { ReceiptStore } from "@sanna-ai/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailurePolicy = "fail_closed" | "fail_open";

export interface SinkResult {
  success: boolean;
  error?: string;
}

/**
 * Interface for receipt persistence backends.
 * Implementations must handle their own error semantics.
 */
export interface ReceiptSink {
  save(receipt: Record<string, unknown>): SinkResult;
  query(filters: Record<string, unknown>): unknown[];
  count(filters?: Record<string, unknown>): number;
  close(): void;
}

// ---------------------------------------------------------------------------
// LocalSQLiteSink — wraps @sanna-ai/core ReceiptStore
// ---------------------------------------------------------------------------

export class LocalSQLiteSink implements ReceiptSink {
  private store: ReceiptStore;

  constructor(dbPath: string) {
    this.store = new ReceiptStore(dbPath);
  }

  save(receipt: Record<string, unknown>): SinkResult {
    try {
      this.store.save(receipt);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  query(filters: Record<string, unknown>): unknown[] {
    return this.store.query(filters);
  }

  count(filters?: Record<string, unknown>): number {
    return this.store.count(filters);
  }

  close(): void {
    this.store.close();
  }
}

// ---------------------------------------------------------------------------
// NullSink — discards all receipts (for testing / passthrough)
// ---------------------------------------------------------------------------

export class NullSink implements ReceiptSink {
  save(_receipt: Record<string, unknown>): SinkResult {
    return { success: true };
  }

  query(_filters: Record<string, unknown>): unknown[] {
    return [];
  }

  count(_filters?: Record<string, unknown>): number {
    return 0;
  }

  close(): void {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// CompositeSink — fans out to multiple sinks
// ---------------------------------------------------------------------------

export class CompositeSink implements ReceiptSink {
  private sinks: ReceiptSink[];
  private failurePolicy: FailurePolicy;

  constructor(sinks: ReceiptSink[], failurePolicy: FailurePolicy = "fail_closed") {
    this.sinks = sinks;
    this.failurePolicy = failurePolicy;
  }

  save(receipt: Record<string, unknown>): SinkResult {
    const errors: string[] = [];
    for (const sink of this.sinks) {
      const result = sink.save(receipt);
      if (!result.success && result.error) {
        errors.push(result.error);
      }
    }
    if (errors.length > 0 && this.failurePolicy === "fail_closed") {
      return { success: false, error: errors.join("; ") };
    }
    return { success: true };
  }

  query(filters: Record<string, unknown>): unknown[] {
    // Query from the first sink that returns results
    for (const sink of this.sinks) {
      try {
        const results = sink.query(filters);
        if (results.length > 0) return results;
      } catch {
        continue;
      }
    }
    return [];
  }

  count(filters?: Record<string, unknown>): number {
    // Count from the first sink that succeeds
    for (const sink of this.sinks) {
      try {
        return sink.count(filters);
      } catch {
        continue;
      }
    }
    return 0;
  }

  close(): void {
    for (const sink of this.sinks) {
      try {
        sink.close();
      } catch {
        // best effort
      }
    }
  }
}
