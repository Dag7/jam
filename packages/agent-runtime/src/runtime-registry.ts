import type { IAgentRuntime, SerializedRuntimeMetadata } from '@jam/core';

export class RuntimeRegistry {
  private runtimes = new Map<string, IAgentRuntime>();

  register(runtime: IAgentRuntime): void {
    this.runtimes.set(runtime.runtimeId, runtime);
  }

  get(runtimeId: string): IAgentRuntime | undefined {
    return this.runtimes.get(runtimeId);
  }

  list(): IAgentRuntime[] {
    return Array.from(this.runtimes.values());
  }

  has(runtimeId: string): boolean {
    return this.runtimes.has(runtimeId);
  }

  /** Serializable metadata for all runtimes (safe for IPC transport) */
  listMetadata(): SerializedRuntimeMetadata[] {
    return this.list().map((r) => ({
      id: r.metadata.id,
      displayName: r.metadata.displayName,
      cliCommand: r.metadata.cliCommand,
      installHint: r.metadata.installHint,
      models: r.metadata.models,
      supportsFullAccess: r.metadata.supportsFullAccess,
      nodeVersionRequired: r.metadata.nodeVersionRequired,
      authHint: r.metadata.getAuthHint(),
      authType: r.metadata.authType,
      authEnvVar: r.metadata.authEnvVar,
      authCommand: r.metadata.authCommand,
    }));
  }

  /** All CLI commands registered (for setup status detection) */
  getCliCommands(): string[] {
    return this.list().map((r) => r.metadata.cliCommand);
  }
}
