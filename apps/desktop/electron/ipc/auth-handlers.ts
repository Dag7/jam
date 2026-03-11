import { ipcMain, shell } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createLogger } from '@jam/core';
import type { RuntimeRegistry } from '@jam/agent-runtime';
import type { AppStore } from '../storage/store';

const log = createLogger('AuthHandlers');

export interface AuthHandlerDeps {
  runtimeRegistry: RuntimeRegistry;
  appStore: AppStore;
  getSandboxTier: () => string;
}

/** Per-runtime auth status check. Returns { authenticated, expired? } */
async function checkRuntimeAuth(runtimeId: string, home: string): Promise<{ authenticated: boolean; expired?: boolean }> {
  switch (runtimeId) {
    case 'claude-code': {
      // Check .credentials.json for OAuth tokens
      try {
        const credPath = join(home, '.claude', '.credentials.json');
        const content = await readFile(credPath, 'utf-8');
        const creds = JSON.parse(content);
        if (creds.claudeAiOauth?.accessToken) {
          const expired = creds.claudeAiOauth.expiresAt ? Date.now() > creds.claudeAiOauth.expiresAt : false;
          return { authenticated: true, expired };
        }
      } catch { /* no file or invalid */ }
      // Also check Keychain on macOS (host may be authenticated even if file is stale)
      if (process.platform === 'darwin') {
        try {
          execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials'], {
            stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000,
          });
          return { authenticated: true, expired: false };
        } catch { /* not in keychain */ }
      }
      return { authenticated: false };
    }
    case 'cursor': {
      if (process.env.CURSOR_API_KEY) return { authenticated: true };
      if (existsSync(join(home, '.cursor', 'cli-config.json'))) return { authenticated: true };
      return { authenticated: false };
    }
    case 'opencode': {
      if (existsSync(join(home, '.opencode', 'config.json'))) return { authenticated: true };
      return { authenticated: false };
    }
    case 'codex': {
      if (process.env.OPENAI_API_KEY) return { authenticated: true };
      if (existsSync(join(home, '.codex', 'config.toml'))) return { authenticated: true };
      return { authenticated: false };
    }
    default:
      return { authenticated: false };
  }
}

export function registerAuthHandlers(deps: AuthHandlerDeps): void {
  const { runtimeRegistry, appStore } = deps;

  /**
   * Run interactive login for any runtime that supports it.
   * Uses the runtime's cliCommand + authCommand (e.g. `claude auth login`).
   * Captures auth URLs from output and opens them in the system browser.
   * On macOS with Docker mode, syncs Keychain → file for container access.
   */
  ipcMain.handle('auth:login', async (_e, runtimeId: string) => {
    const runtime = runtimeRegistry.get(runtimeId);
    if (!runtime) return { success: false, error: `Unknown runtime: ${runtimeId}` };

    const { authCommand, cliCommand } = runtime.metadata;
    if (!authCommand || authCommand.length === 0) {
      return { success: false, error: `${runtime.metadata.displayName} does not support interactive login` };
    }

    const command = cliCommand;
    const args = authCommand;

    log.info(`Starting auth login: ${command} ${args.join(' ')} (runtime: ${runtimeId})`);

    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let output = '';
      let urlOpened = false;

      const tryOpenUrl = (text: string) => {
        if (urlOpened) return;
        const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
        if (!urls) return;
        for (const url of urls) {
          // Open any URL that looks like an auth/login redirect
          if (url.includes('oauth') || url.includes('auth') || url.includes('login')
              || url.includes('anthropic') || url.includes('cursor') || url.includes('openai')) {
            shell.openExternal(url);
            urlOpened = true;
            log.info(`Opened auth URL in browser: ${url.slice(0, 80)}...`);
            break;
          }
        }
      };

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        log.info(`auth stdout: ${text.trim()}`);
        tryOpenUrl(text);
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        log.info(`auth stderr: ${text.trim()}`);
        tryOpenUrl(text);
      });

      proc.on('close', (code) => {
        resolve(code === 0
          ? { success: true }
          : { success: false, error: `Exit code ${code}: ${output.slice(-300)}` });
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      // 5-minute timeout
      const timeout = setTimeout(() => {
        try { proc.kill(); } catch { /* ignore */ }
        resolve({ success: false, error: 'Timed out after 5 minutes' });
      }, 5 * 60_000);

      proc.on('close', () => clearTimeout(timeout));
    });

    if (!result.success) return result;

    // On macOS + Docker: sync Keychain → .credentials.json for container access
    if (runtimeId === 'claude-code' && process.platform === 'darwin' && deps.getSandboxTier() === 'docker') {
      await syncClaudeKeychain();
    }

    return { success: true };
  });

  /**
   * Set an API key for a runtime. Stores in encrypted AppStore and makes
   * it available as an env var (via the runtime's authEnvVar) at spawn time.
   */
  ipcMain.handle('auth:setApiKey', async (_e, runtimeId: string, apiKey: string) => {
    const runtime = runtimeRegistry.get(runtimeId);
    if (!runtime) return { success: false, error: `Unknown runtime: ${runtimeId}` };

    const envVar = runtime.metadata.authEnvVar;
    if (!envVar) return { success: false, error: `${runtime.metadata.displayName} does not accept API keys` };

    // Store as a secret so it gets redacted from agent output
    appStore.setSecret(`runtime-${runtimeId}`, `${runtime.metadata.displayName} API Key`, 'api-key', apiKey);
    log.info(`API key set for ${runtimeId} (env: ${envVar})`);
    return { success: true, envVar };
  });

  /** Remove a stored API key for a runtime */
  ipcMain.handle('auth:removeApiKey', async (_e, runtimeId: string) => {
    appStore.deleteSecret(`runtime-${runtimeId}`);
    log.info(`API key removed for ${runtimeId}`);
    return { success: true };
  });

  /** Check auth status for all runtimes at once */
  ipcMain.handle('auth:statusAll', async () => {
    const home = homedir();
    const runtimes = runtimeRegistry.listMetadata();
    const results: Array<{
      runtimeId: string;
      displayName: string;
      authType: string;
      authEnvVar?: string;
      hasAuthCommand: boolean;
      authenticated: boolean;
      expired?: boolean;
      hasApiKey: boolean;
    }> = [];

    for (const meta of runtimes) {
      const status = await checkRuntimeAuth(meta.id, home);
      const hasApiKey = appStore.getApiKey(`secret:runtime-${meta.id}`) !== null;
      results.push({
        runtimeId: meta.id,
        displayName: meta.displayName,
        authType: meta.authType,
        authEnvVar: meta.authEnvVar,
        hasAuthCommand: !!meta.authCommand && meta.authCommand.length > 0,
        authenticated: status.authenticated || hasApiKey,
        expired: status.expired,
        hasApiKey,
      });
    }

    return results;
  });

  /** Force-sync Keychain → .credentials.json (macOS + Claude Code only) */
  ipcMain.handle('auth:syncCredentials', async () => {
    if (process.platform !== 'darwin') {
      return { success: true, message: 'No sync needed on this platform' };
    }
    return syncClaudeKeychain();
  });
}

async function syncClaudeKeychain(): Promise<{ success: boolean; error?: string }> {
  try {
    const keychainData = execFileSync('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-w',
    ], { encoding: 'utf-8', timeout: 5000 }).trim();

    if (!keychainData) {
      return { success: false, error: 'No credentials found in Keychain' };
    }

    const credPath = join(homedir(), '.claude', '.credentials.json');
    await writeFile(credPath, keychainData, { mode: 0o600 });
    log.info('Synced credentials from Keychain → .credentials.json');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
