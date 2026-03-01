const DEFAULT_TIMEOUT_MS = 5_000;

export interface BrainClientConfig {
  baseUrl: string;
  timeout?: number;
}

export interface BrainSearchResult {
  score: number;
  source: string;
  content: string;
}

interface IngestResponse {
  result?: string;
  trace_id?: string;
}

interface SearchResponse {
  traces: Array<{
    score: number;
    source: string;
    trace: {
      content: { Text?: string };
    };
  }>;
}

export class BrainClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: BrainClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  async health(): Promise<boolean> {
    try {
      const resp = await this.fetch('GET', '/api/v1/health');
      const body = (await resp.json()) as { status?: string };
      return body.status === 'ok';
    } catch {
      return false;
    }
  }

  async ingest(
    namespace: string,
    content: string,
    source: string,
    sessionId?: string,
  ): Promise<string | null> {
    try {
      const payload: Record<string, string> = { namespace, content, source };
      if (sessionId) {
        payload.session_id = sessionId;
      }

      const resp = await this.fetch('POST', '/api/v1/ingest', payload);
      const body = (await resp.json()) as IngestResponse;
      return body.trace_id ?? null;
    } catch {
      return null;
    }
  }

  async search(
    namespace: string,
    query: string,
    limit = 5,
  ): Promise<BrainSearchResult[]> {
    try {
      const resp = await this.fetch('POST', '/api/v1/memories/search', {
        namespace,
        mode: 'pattern',
        query,
        limit,
      });
      const body = (await resp.json()) as SearchResponse;

      return body.traces.map((t) => ({
        score: t.score,
        source: t.source,
        content: t.trace.content.Text ?? '',
      }));
    } catch {
      return [];
    }
  }

  async consolidate(namespace: string): Promise<void> {
    try {
      await this.fetch(
        'POST',
        `/api/v1/consolidate?namespace=${encodeURIComponent(namespace)}`,
        {},
      );
    } catch {
      // Best-effort — consolidation failures are non-critical
    }
  }

  private async fetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const options: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      };

      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }

      const resp = await fetch(`${this.baseUrl}${path}`, options);

      if (!resp.ok) {
        throw new Error(`Brain API ${method} ${path}: ${resp.status}`);
      }

      return resp;
    } finally {
      clearTimeout(timer);
    }
  }
}
