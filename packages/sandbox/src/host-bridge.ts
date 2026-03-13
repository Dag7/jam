import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import type { IHostBridge } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('HostBridge');

const MAX_BODY_SIZE = 1_024 * 1_024; // 1MB

/** Injected host capabilities — keeps this package free of Electron imports (DIP) */
export interface HostBridgeDeps {
  openExternal: (url: string) => Promise<void>;
  readClipboard: () => string;
  writeClipboard: (text: string) => void;
  openPath: (path: string) => Promise<string>;
  showNotification: (title: string, body: string) => void;
  /** Write a structured message to another agent's inbox (inter-agent communication) */
  writeInbox?: (targetAgent: string, senderAgentId: string, entry: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  /** List known agent names (for inbox-write target validation) */
  listAgentNames?: () => string[];
}

interface BridgeRequest {
  operation: string;
  params: Record<string, unknown>;
}

interface BridgeResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Context passed to bridge operations — identifies the calling agent */
interface BridgeContext {
  agentId?: string;
}

interface BridgeOperation {
  validate: (params: Record<string, unknown>) => string | null;
  execute: (params: Record<string, unknown>, context: BridgeContext) => Promise<BridgeResponse>;
}

/**
 * Host Bridge — lightweight HTTP server that exposes whitelisted host operations
 * to containerized agents. Agents reach it via `host.docker.internal`.
 *
 * Operations use a registry map (OCP-compliant). Adding a new host operation
 * means adding one entry to the operations map.
 */
export class HostBridge implements IHostBridge {
  private server: Server | null = null;
  private token = '';
  private readonly operations: Map<string, BridgeOperation>;

  constructor(
    private readonly port: number,
    private readonly deps: HostBridgeDeps,
  ) {
    this.operations = this.buildOperations();
  }

  get isListening(): boolean {
    return this.server?.listening ?? false;
  }

  async start(token: string): Promise<{ url: string; port: number }> {
    if (this.server) {
      throw new Error('Host bridge already running');
    }

    this.token = token;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        log.error(`Host bridge server error: ${String(err)}`);
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        const url = `http://127.0.0.1:${this.port}/bridge`;
        log.info(`Host bridge listening on port ${this.port}`);
        resolve({ url, port: this.port });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        log.info('Host bridge stopped');
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers for container requests
    res.setHeader('Content-Type', 'application/json');

    // Only accept POST to /bridge
    if (req.method !== 'POST' || req.url !== '/bridge') {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
      return;
    }

    // Validate auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${this.token}`) {
      res.writeHead(401);
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }

    // Parse body with size limit
    let body = '';
    let tooLarge = false;

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        tooLarge = true;
        res.writeHead(413);
        res.end(JSON.stringify({ success: false, error: 'Request body too large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      if (tooLarge) return;

      try {
        const request: BridgeRequest = JSON.parse(body);
        const operation = this.operations.get(request.operation);

        if (!operation) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: `Unknown operation: ${request.operation}` }));
          return;
        }

        const params = request.params ?? {};
        const validationError = operation.validate(params);
        if (validationError) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: validationError }));
          return;
        }

        const agentId = req.headers['x-jam-agent-id'] as string | undefined;
        log.info(`Executing operation: ${request.operation}${agentId ? ` (agent: ${agentId.slice(0, 8)})` : ''}`);
        const result = await operation.execute(params, { agentId });
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) {
        log.error(`Bridge request error: ${String(err)}`);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: 'Internal error' }));
      }
    });
  }

  /** Build the whitelisted operations registry */
  private buildOperations(): Map<string, BridgeOperation> {
    return new Map<string, BridgeOperation>([
      ['open-url', {
        validate: (params) => {
          const url = params.url;
          if (!url || typeof url !== 'string') return 'Missing "url" parameter';
          if (!/^https?:\/\//i.test(url)) return 'URL must start with http:// or https://';
          return null;
        },
        execute: async (params) => {
          await this.deps.openExternal(params.url as string);
          return { success: true };
        },
      }],

      ['clipboard-read', {
        validate: () => null,
        execute: async () => {
          const text = this.deps.readClipboard();
          return { success: true, data: { text } };
        },
      }],

      ['clipboard-write', {
        validate: (params) => {
          if (typeof params.text !== 'string') return 'Missing "text" parameter';
          return null;
        },
        execute: async (params) => {
          this.deps.writeClipboard(params.text as string);
          return { success: true };
        },
      }],

      ['applescript', {
        validate: (params) => {
          const script = params.script;
          if (!script || typeof script !== 'string') return 'Missing "script" parameter';
          // Block dangerous operations — no arbitrary shell execution or keystroke simulation
          if (/do shell script/i.test(script)) {
            return 'Blocked: "do shell script" is not allowed for security reasons';
          }
          if (/system events.*keystroke/i.test(script)) {
            return 'Blocked: keystroke simulation is not allowed for security reasons';
          }
          return null;
        },
        execute: async (params) => {
          if (process.platform !== 'darwin') {
            return { success: false, error: 'AppleScript is only available on macOS' };
          }
          try {
            const output = execFileSync('osascript', ['-e', params.script as string], {
              encoding: 'utf-8',
              timeout: 10_000,
            }).trim();
            return { success: true, data: { output } };
          } catch (err) {
            return { success: false, error: String(err) };
          }
        },
      }],

      ['notification', {
        validate: (params) => {
          if (typeof params.title !== 'string') return 'Missing "title" parameter';
          return null;
        },
        execute: async (params) => {
          this.deps.showNotification(
            params.title as string,
            (params.body as string) ?? '',
          );
          return { success: true };
        },
      }],

      ['file-open', {
        validate: (params) => {
          if (typeof params.path !== 'string') return 'Missing "path" parameter';
          return null;
        },
        execute: async (params) => {
          const result = await this.deps.openPath(params.path as string);
          return result ? { success: false, error: result } : { success: true };
        },
      }],

      // Inter-agent communication: write a structured message to another agent's inbox
      ['inbox-write', {
        validate: (params) => {
          if (typeof params.targetAgent !== 'string' || !params.targetAgent) {
            return 'Missing "targetAgent" parameter (agent name)';
          }
          if (typeof params.title !== 'string' || !params.title) {
            return 'Missing "title" parameter';
          }
          if (typeof params.description !== 'string' || !params.description) {
            return 'Missing "description" parameter';
          }
          // Validate target exists (prevents path traversal — host resolves the path)
          const known = this.deps.listAgentNames?.() ?? [];
          if (!known.some(n => n.toLowerCase() === (params.targetAgent as string).toLowerCase())) {
            return `Unknown agent "${params.targetAgent}". Known agents: ${known.join(', ')}`;
          }
          return null;
        },
        execute: async (params, context) => {
          if (!this.deps.writeInbox) {
            return { success: false, error: 'inbox-write not configured' };
          }
          if (!context.agentId) {
            return { success: false, error: 'Missing X-Jam-Agent-Id header — cannot identify sender' };
          }
          const entry = {
            title: params.title as string,
            description: params.description as string,
            from: context.agentId,
            priority: (params.priority as string) ?? 'normal',
            tags: (params.tags as string[]) ?? [],
          };
          return this.deps.writeInbox(params.targetAgent as string, context.agentId, entry);
        },
      }],
    ]);
  }
}
