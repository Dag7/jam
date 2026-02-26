import type { AgentId } from '@jam/core';

export interface TaskStep {
  timestamp: number;
  type: 'tool-use' | 'thinking' | 'text';
  summary: string;
}

export interface TaskInfo {
  taskId: string;
  command: string;
  startedAt: number;
  steps: TaskStep[];
  status: 'running' | 'completed' | 'failed';
}

const MAX_STEPS = 50;
let taskSeq = 0;

export class TaskTracker {
  private tasks = new Map<AgentId, TaskInfo>();

  startTask(agentId: AgentId, command: string): string {
    const taskId = `${agentId}-${Date.now()}-${++taskSeq}`;
    this.tasks.set(agentId, {
      taskId,
      command,
      startedAt: Date.now(),
      steps: [],
      status: 'running',
    });
    return taskId;
  }

  addStep(agentId: AgentId, step: Omit<TaskStep, 'timestamp'>): void {
    const task = this.tasks.get(agentId);
    if (!task || task.status !== 'running') return;

    task.steps.push({ ...step, timestamp: Date.now() });
    if (task.steps.length > MAX_STEPS) {
      task.steps.shift();
    }
  }

  completeTask(agentId: AgentId, status: 'completed' | 'failed'): void {
    const task = this.tasks.get(agentId);
    if (task) {
      task.status = status;
    }
  }

  getStatus(agentId: AgentId): TaskInfo | null {
    return this.tasks.get(agentId) ?? null;
  }

  formatStatusSummary(agentId: AgentId, agentName: string): string {
    const task = this.tasks.get(agentId);
    if (!task) return `${agentName} is idle.`;

    if (task.status !== 'running') {
      return `${agentName} finished ${task.status === 'completed' ? 'successfully' : 'with an error'}.`;
    }

    const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins} minute${mins > 1 ? 's' : ''}` : `${secs} seconds`;

    const commandPreview = task.command.length > 60
      ? task.command.slice(0, 60) + '...'
      : task.command;

    const lastStep = task.steps[task.steps.length - 1];
    if (!lastStep) {
      if (elapsed < 10) {
        return `${agentName} has been working for ${timeStr} on "${commandPreview}". Starting up.`;
      }
      if (elapsed < 30) {
        return `${agentName} has been working for ${timeStr} on "${commandPreview}". Loading context and tools.`;
      }
      return `${agentName} has been working for ${timeStr} on "${commandPreview}". Working — check the terminal for live output.`;
    }

    const lastAction = lastStep.summary.length > 80
      ? lastStep.summary.slice(0, 80) + '...'
      : lastStep.summary;

    return `${agentName} has been working for ${timeStr} on "${commandPreview}". Last action: ${lastAction}.`;
  }
}
