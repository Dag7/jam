import type { IModelResolver, TeamOperation, IEventBus } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('TeamExecutor');

export interface ITeamExecutor {
  execute(operation: TeamOperation, prompt: string, cwd?: string): Promise<string>;
}

interface QueueItem {
  operation: TeamOperation;
  prompt: string;
  cwd?: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/**
 * Serialized queue that executes team AI operations via the dedicated team runtime.
 * Sequential execution prevents overwhelming a single runtime — 10 agents' periodic
 * operations (reflection every few hours) are easily handled one at a time.
 *
 * Delegates actual LLM invocation to `executeOnRuntime`, keeping this class
 * decoupled from the Electron layer (Dependency Inversion).
 */
export class TeamExecutor implements ITeamExecutor {
  private readonly queue: QueueItem[] = [];
  private processing = false;

  constructor(
    private readonly modelResolver: IModelResolver,
    private readonly executeOnRuntime: (
      runtimeId: string,
      model: string,
      prompt: string,
      cwd?: string,
    ) => Promise<string>,
    private readonly _eventBus?: IEventBus,
  ) {}

  async execute(operation: TeamOperation, prompt: string, cwd?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ operation, prompt, cwd, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const { runtime, model } = this.modelResolver.resolve(item.operation);

      try {
        log.info(`Executing ${item.operation} with ${runtime}/${model}`);
        const result = await this.executeOnRuntime(runtime, model, item.prompt, item.cwd);
        item.resolve(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`${item.operation} failed: ${message}`);
        item.reject(error instanceof Error ? error : new Error(message));
      }
    }

    this.processing = false;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}
