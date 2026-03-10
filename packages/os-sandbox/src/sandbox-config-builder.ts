import { homedir } from 'node:os';
import type { OsSandboxConfig } from './types.js';

/**
 * Resolves '~' paths to absolute paths using the current user's home directory.
 */
function expandHome(p: string): string {
  if (p.startsWith('~/')) return `${homedir()}${p.slice(1)}`;
  if (p === '~') return homedir();
  return p;
}

/**
 * Sandbox configuration for the OS-level sandbox runtime.
 * This mirrors the shape expected by @anthropic-ai/sandbox-runtime.
 */
export interface SandboxRuntimeConfig {
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
  };
  filesystem: {
    denyRead: string[];
    allowWrite: string[];
    denyWrite: string[];
  };
}

/**
 * Builds SandboxRuntimeConfig from OsSandboxConfig.
 *
 * Each agent gets filesystem write restricted to its own workspace directory
 * plus any globally configured extra write paths.
 */
export class SandboxConfigBuilder {
  constructor(private readonly config: OsSandboxConfig) {}

  /** Build the global (non-agent-specific) config */
  buildGlobalConfig(): SandboxRuntimeConfig {
    return {
      network: {
        allowedDomains: this.config.allowedDomains,
        deniedDomains: [],
      },
      filesystem: {
        denyRead: this.config.denyRead.map(expandHome),
        allowWrite: this.config.extraAllowWrite.map(expandHome),
        denyWrite: this.config.denyWrite,
      },
    };
  }

  /** Build a per-agent config with workspace-specific write permissions */
  buildAgentConfig(agentWorkspace: string): SandboxRuntimeConfig {
    return {
      network: {
        allowedDomains: this.config.allowedDomains,
        deniedDomains: [],
      },
      filesystem: {
        denyRead: this.config.denyRead.map(expandHome),
        allowWrite: [
          agentWorkspace,
          ...this.config.extraAllowWrite.map(expandHome),
        ],
        denyWrite: this.config.denyWrite,
      },
    };
  }
}
