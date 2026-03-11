import { ipcMain, shell } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createLogger } from '@jam/core';

const log = createLogger('AuthHandlers');

export interface AuthHandlerDeps {
  getSandboxTier: () => string;
}

export function registerAuthHandlers(deps: AuthHandlerDeps): void {
  /**
   * OAuth login for a given runtime (e.g. 'claude-code').
   *
   * Runs `claude auth login` on the HOST. On macOS, Claude Code stores tokens
   * in the system Keychain. After a successful login we sync the Keychain
   * credentials to `~/.claude/.credentials.json` so Docker containers
   * (which can't access Keychain) pick them up via the bind mount.
   */
  ipcMain.handle('auth:login', async (_e, runtime: string) => {
    if (runtime !== 'claude-code') {
      return { success: false, error: `OAuth not yet supported for "${runtime}"` };
    }

    const command = 'claude';
    const args = ['auth', 'login'];

    log.info(`Starting OAuth login: ${command} ${args.join(' ')}`);

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
          if (url.includes('anthropic') || url.includes('claude') || url.includes('oauth')) {
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

    // On macOS: sync Keychain → .credentials.json so Docker containers can read them.
    // Claude Code stores tokens in macOS Keychain ("Claude Code-credentials"),
    // but containers only have access to the bind-mounted ~/.claude directory.
    if (process.platform === 'darwin' && deps.getSandboxTier() === 'docker') {
      try {
        const keychainData = execFileSync('security', [
          'find-generic-password', '-s', 'Claude Code-credentials', '-w',
        ], { encoding: 'utf-8', timeout: 5000 }).trim();

        if (keychainData) {
          const credPath = join(homedir(), '.claude', '.credentials.json');
          await writeFile(credPath, keychainData, { mode: 0o600 });
          log.info('Synced credentials from Keychain → .credentials.json for container access');
        }
      } catch (err) {
        log.warn(`Failed to sync Keychain to .credentials.json: ${String(err)}`);
        // Not fatal — login still succeeded on host
      }
    }

    return { success: true };
  });

  /** Check authentication status by reading the credentials file. */
  ipcMain.handle('auth:status', async (_e, runtime: string) => {
    if (runtime !== 'claude-code') {
      return { authenticated: false };
    }

    try {
      const credPath = join(homedir(), '.claude', '.credentials.json');
      const content = await readFile(credPath, 'utf-8');
      const creds = JSON.parse(content);

      if (creds.claudeAiOauth?.accessToken) {
        const expiresAt = creds.claudeAiOauth.expiresAt;
        const expired = expiresAt ? Date.now() > expiresAt : false;
        return { authenticated: true, expired };
      }
      return { authenticated: false };
    } catch {
      return { authenticated: false };
    }
  });

  /**
   * Force-sync Keychain credentials to .credentials.json (macOS only).
   * Useful when the user has already authenticated on the host but the
   * credentials file is stale or missing.
   */
  ipcMain.handle('auth:syncCredentials', async () => {
    if (process.platform !== 'darwin') {
      return { success: true, message: 'No sync needed on this platform' };
    }

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
  });
}
