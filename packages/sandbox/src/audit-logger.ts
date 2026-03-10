import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createLogger } from '@jam/core';

const log = createLogger('AuditLogger');

/**
 * Append-only JSONL audit logger for sandbox operations.
 *
 * Logs all bridge requests, container lifecycle events, and security-relevant
 * operations to a persistent file for forensic review.
 */
export class AuditLogger {
  private ready: Promise<void>;

  constructor(private readonly logPath: string) {
    this.ready = mkdir(dirname(logPath), { recursive: true }).then(() => {}).catch(() => {});
  }

  /** Log an operation with structured metadata */
  async logOperation(entry: AuditEntry): Promise<void> {
    if (!this.logPath) return;

    try {
      await this.ready;
      const line = JSON.stringify({
        ...entry,
        timestamp: new Date().toISOString(),
      }) + '\n';
      await appendFile(this.logPath, line, 'utf-8');
    } catch (err) {
      log.warn(`Audit log write failed: ${String(err)}`);
    }
  }

  /** Log a bridge request */
  async logBridgeRequest(operation: string, params: unknown, result: 'allowed' | 'denied' | 'error', agentId?: string): Promise<void> {
    await this.logOperation({
      category: 'bridge',
      operation,
      params: params as Record<string, unknown>,
      result,
      agentId,
    });
  }

  /** Log a container lifecycle event */
  async logContainerEvent(event: 'create' | 'start' | 'stop' | 'remove', containerId: string, agentId?: string): Promise<void> {
    await this.logOperation({
      category: 'container',
      operation: event,
      params: { containerId },
      result: 'allowed',
      agentId,
    });
  }
}

export interface AuditEntry {
  category: 'bridge' | 'container' | 'security';
  operation: string;
  params?: Record<string, unknown>;
  result: 'allowed' | 'denied' | 'error';
  agentId?: string;
  timestamp?: string;
}
