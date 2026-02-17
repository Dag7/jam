/**
 * Shared utilities for agent-runtime package.
 * Centralizes ANSI stripping and env filtering to eliminate duplication.
 */

/** Comprehensive ANSI/terminal escape code stripping.
 *  Handles CSI, OSC, DEC private modes, simple escapes, and carriage returns. */
export function stripAnsi(input: string): string {
  return input.replace(
    // eslint-disable-next-line no-control-regex
    /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[?]?[0-9;]*[a-zA-Z~]|\x1b[()][AB012]|\x1b[a-zA-Z]|\r/g,
    '',
  );
}

/** Simple ANSI stripping — CSI sequences only (colors, cursor, etc.).
 *  Use when you only need basic cleanup. */
export function stripAnsiSimple(input: string): string {
  return input.replace(
    // eslint-disable-next-line no-control-regex
    /\x1b\[[0-9;]*[a-zA-Z]/g,
    '',
  );
}

/** Env vars that must be filtered from child processes to prevent
 *  nested-session detection or spawn failures. */
const FILTERED_ENV_KEYS = new Set([
  'CLAUDECODE',
  'CLAUDE_PARENT_CLI',
]);

/** Build a clean copy of process.env with filtered keys removed
 *  and optional extra vars merged in. */
export function buildCleanEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !FILTERED_ENV_KEYS.has(k)) env[k] = v;
  }
  if (extra) Object.assign(env, extra);
  return env;
}
