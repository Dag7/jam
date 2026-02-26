export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
  agentId?: string;
}

export type LogTransport = (entry: LogEntry) => void;

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalTransports: LogTransport[] = [];
let globalMinLevel: LogLevel = 'debug';

/** Add a transport that receives all log entries */
export function addLogTransport(transport: LogTransport): () => void {
  globalTransports.push(transport);
  return () => {
    globalTransports = globalTransports.filter((t) => t !== transport);
  };
}

/** Set the minimum log level (entries below this are dropped) */
export function setLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

/** Console transport — the default, writes to stdout/stderr */
export function consoleTransport(entry: LogEntry): void {
  const prefix = `[${entry.scope}]`;
  const msg = entry.data !== undefined
    ? `${prefix} ${entry.message} ${JSON.stringify(entry.data)}`
    : `${prefix} ${entry.message}`;

  switch (entry.level) {
    case 'debug':
      // Use process.stdout directly to avoid re-entrant monkey-patching
      if (typeof process !== 'undefined' && process.stdout) {
        process.stdout.write(`${msg}\n`);
      }
      break;
    case 'info':
      if (typeof process !== 'undefined' && process.stdout) {
        process.stdout.write(`${msg}\n`);
      }
      break;
    case 'warn':
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`WARN ${msg}\n`);
      }
      break;
    case 'error':
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`ERROR ${msg}\n`);
      }
      break;
  }
}

/** Pattern matching API keys and tokens (OpenAI sk-, Anthropic sk-ant-, generic long hex/base64) */
const SECRET_PATTERN = /\b(sk-(?:ant-)?[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]{20,}/g;

/** Redact API keys and tokens from log messages */
function redactSecrets(message: string): string {
  return message.replace(SECRET_PATTERN, '$1****');
}

function emit(entry: LogEntry): void {
  if (LOG_LEVELS[entry.level] < LOG_LEVELS[globalMinLevel]) return;

  // Fast path: only redact if message might contain secrets (rare)
  const message = SECRET_PATTERN.test(entry.message)
    ? (SECRET_PATTERN.lastIndex = 0, redactSecrets(entry.message))
    : entry.message;

  // Only deep-sanitize data if it contains strings (secrets hide in strings)
  let sanitizedData = entry.data;
  if (sanitizedData !== undefined && typeof sanitizedData === 'object' && sanitizedData !== null) {
    try {
      const raw = JSON.stringify(sanitizedData);
      if (SECRET_PATTERN.test(raw)) {
        SECRET_PATTERN.lastIndex = 0;
        sanitizedData = JSON.parse(raw.replace(SECRET_PATTERN, '$1****'));
      }
    } catch { /* non-serializable data — pass through */ }
  } else if (typeof sanitizedData === 'string' && SECRET_PATTERN.test(sanitizedData)) {
    SECRET_PATTERN.lastIndex = 0;
    sanitizedData = redactSecrets(sanitizedData);
  }

  const sanitized = message !== entry.message || sanitizedData !== entry.data
    ? { ...entry, message, data: sanitizedData }
    : entry;

  for (const transport of globalTransports) {
    try {
      transport(sanitized);
    } catch {
      // Don't let transport errors break the caller
    }
  }
}

/**
 * Create a scoped logger. Each package/module creates one:
 *   const log = createLogger('AgentManager');
 *   log.info('Agent started', { agentId });
 */
export function createLogger(scope: string) {
  function log(level: LogLevel, message: string, data?: unknown, agentId?: string): void {
    emit({
      timestamp: new Date().toISOString(),
      level,
      scope,
      message,
      data,
      agentId,
    });
  }

  return {
    debug: (message: string, data?: unknown, agentId?: string) => log('debug', message, data, agentId),
    info: (message: string, data?: unknown, agentId?: string) => log('info', message, data, agentId),
    warn: (message: string, data?: unknown, agentId?: string) => log('warn', message, data, agentId),
    error: (message: string, data?: unknown, agentId?: string) => log('error', message, data, agentId),
  };
}

// Register console transport by default
addLogTransport(consoleTransport);
