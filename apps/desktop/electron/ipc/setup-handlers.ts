import { ipcMain } from 'electron';
import { execFileSync } from 'node:child_process';
import type { RuntimeRegistry } from '@jam/agent-runtime';
import type { AppStore } from '../storage/store';
import { ensureClaudePermissionAccepted } from './agent-handlers';

/** Narrow dependency interface — only what setup handlers need */
export interface SetupHandlerDeps {
  runtimeRegistry: RuntimeRegistry;
  appStore: AppStore;
  initVoice: () => void;
}

export function registerSetupHandlers(deps: SetupHandlerDeps): void {
  const { runtimeRegistry, appStore, initVoice } = deps;

  ipcMain.handle('setup:detectRuntimes', () => {
    const homedir = process.env.HOME || '';

    let nodeVersion = '';
    let nodeMajor = 0;
    try {
      nodeVersion = execFileSync('node', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim().replace(/^v/, '');
      nodeMajor = parseInt(nodeVersion.split('.')[0], 10) || 0;
    } catch {
      // node not in PATH
    }

    const runtimes: Array<{
      id: string;
      name: string;
      available: boolean;
      authenticated: boolean;
      version: string;
      nodeVersion: string;
      error: string;
      authHint: string;
    }> = [];

    for (const rt of runtimeRegistry.list()) {
      const { metadata } = rt;
      let available = false;
      let authenticated = false;
      let version = '';
      let error = '';
      let authHint = '';

      try {
        const verOutput = execFileSync(metadata.cliCommand, ['--version'], {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        available = true;
        const firstLine = verOutput.split('\n')[0].trim();
        if (firstLine && !firstLine.startsWith('/')) {
          version = firstLine;
        }
      } catch {
        try {
          execFileSync('which', [metadata.cliCommand], {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          available = true;
        } catch {
          // Binary not in PATH
        }
      }

      if (available) {
        if (metadata.nodeVersionRequired && nodeMajor > 0 && nodeMajor < metadata.nodeVersionRequired) {
          error = `Requires Node.js ${metadata.nodeVersionRequired}+, but found v${nodeVersion}. Install Node 22+: nvm install 22`;
        }
        authenticated = metadata.detectAuth(homedir);
        authHint = metadata.getAuthHint();
      } else {
        authHint = metadata.installHint;
      }

      runtimes.push({ id: metadata.id, name: metadata.displayName, available, authenticated, version, nodeVersion, error, authHint });
    }
    return runtimes;
  });

  ipcMain.handle('setup:testRuntime', async (_, runtimeId: string) => {
    const rt = runtimeRegistry.get(runtimeId);
    const cmd = rt?.metadata.cliCommand ?? runtimeId;
    try {
      const output = execFileSync(cmd, ['-p', 'say hello', '--max-turns', '1', '--output-format', 'json'], {
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { success: true, output: output.slice(0, 500) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? '';
      return { success: false, output: stderr.slice(0, 500) || message.slice(0, 500) };
    }
  });

  ipcMain.handle('setup:openTerminal', (_, command: string) => {
    try {
      if (process.platform === 'darwin') {
        execFileSync('osascript', [
          '-e', `tell application "Terminal" to do script "${command}"`,
          '-e', 'tell application "Terminal" to activate',
        ], { timeout: 5000 });
      } else if (process.platform === 'linux') {
        execFileSync('x-terminal-emulator', ['-e', command], { timeout: 5000 });
      } else {
        execFileSync('cmd', ['/k', command], { timeout: 5000 });
      }
      return { success: true };
    } catch {
      return { success: false, error: 'Could not open terminal' };
    }
  });

  ipcMain.handle('setup:getOnboardingStatus', () => {
    return appStore.isOnboardingComplete();
  });

  ipcMain.handle('setup:resetOnboarding', () => {
    appStore.setOnboardingComplete(false);
    return { success: true };
  });

  ipcMain.handle('setup:getSetupStatus', () => {
    const hasAgents = appStore.getProfiles().length > 0;
    const hasOpenai = appStore.getApiKey('openai') !== null;
    const hasElevenlabs = appStore.getApiKey('elevenlabs') !== null;
    const hasVoiceKeys = hasOpenai || hasElevenlabs;

    let hasRuntime = false;
    for (const cmd of runtimeRegistry.getCliCommands()) {
      try {
        execFileSync('which', [cmd], { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] });
        hasRuntime = true;
        break;
      } catch {
        // not found
      }
    }

    const missing: string[] = [];
    if (!hasRuntime) missing.push('runtime');
    if (!hasVoiceKeys) missing.push('voice-keys');
    if (!hasAgents) missing.push('agent');

    return { hasRuntime, hasVoiceKeys, hasAgents, missing };
  });

  ipcMain.handle('setup:completeOnboarding', () => {
    appStore.setOnboardingComplete(true);
    initVoice();
    ensureClaudePermissionAccepted();
    return { success: true };
  });
}
