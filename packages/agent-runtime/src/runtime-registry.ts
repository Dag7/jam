import type { IAgentRuntime } from '@jam/core';

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
}
