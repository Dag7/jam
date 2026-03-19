import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

/** Maximum scrollback entries kept in memory per agent */
const MAX_SCROLLBACK = 500;

/** Maximum pending data entries per agent — prevents unbounded memory growth when terminal tab is not mounted */
const MAX_PENDING_DATA = 1_000;

/** Maximum execute output string length per segment (~500KB) — prevents unbounded memory growth */
const MAX_EXECUTE_OUTPUT = 500_000;

/** Maximum number of execution segments kept per agent */
const MAX_SEGMENTS = 20;

/** Batching interval for terminal data (ms) — coalesces rapid IPC events into a single Zustand update */
const TERMINAL_BATCH_MS = 32;

/** Batching interval for execute output (ms) — longer than terminal since markdown re-parsing is heavier */
const EXECUTE_OUTPUT_BATCH_MS = 50;

export interface TerminalBuffer {
  /** Data waiting to be written to a mounted xterm.js instance */
  pendingData: string[];
  /** Scrollback history — kept even after pendingData is flushed.
   *  Used to populate the ThreadDrawer when it mounts after output has passed. */
  scrollback: string[];
}

/** A single execution run — groups command + streamed output */
export interface ExecutionSegment {
  id: string;
  command: string;
  timestamp: number;
  content: string;
  status: 'running' | 'done' | 'error';
}

export interface TerminalSlice {
  terminalBuffers: Record<string, TerminalBuffer>;
  /** Segmented execute output per agent — each segment is one execution run */
  executeSegments: Record<string, ExecutionSegment[]>;

  appendTerminalData: (agentId: string, data: string) => void;
  flushTerminalData: (agentId: string) => void;
  clearTerminal: (agentId: string) => void;
  appendExecuteOutput: (agentId: string, data: string, clear?: boolean, command?: string) => void;
  /** Mark the latest segment as done or error */
  completeExecuteSegment: (agentId: string, status: 'done' | 'error') => void;
  clearExecuteSegments: (agentId: string) => void;
  removeTerminalBuffer: (agentId: string) => void;
  /** Cancel pending batch timers and clear queues. Intended for tests and HMR cleanup. */
  _cleanupBatchers: () => void;
}

export const createTerminalSlice: StateCreator<
  AppStore,
  [],
  [],
  TerminalSlice
> = (set) => {
  // Batching state — scoped to this closure instead of module-level,
  // so each store instance (tests, HMR) gets its own independent state.
  const terminalBatchQueue = new Map<string, string[]>();
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const executeOutputQueue = new Map<string, { chunks: string[]; clear: boolean; command?: string }>();
  let executeOutputTimer: ReturnType<typeof setTimeout> | null = null;

  function flushBatch(): void {
    batchTimer = null;
    if (terminalBatchQueue.size === 0) return;

    const batch = new Map(terminalBatchQueue);
    terminalBatchQueue.clear();

    set((state) => {
      const updated = { ...state.terminalBuffers };
      for (const [agentId, chunks] of batch) {
        const existing = updated[agentId] ?? { pendingData: [], scrollback: [] };
        const scrollback = existing.scrollback.concat(chunks).slice(-MAX_SCROLLBACK);
        let pendingData = existing.pendingData.concat(chunks);
        // Cap pending data to prevent unbounded memory growth when terminal is not mounted
        if (pendingData.length > MAX_PENDING_DATA) {
          pendingData = pendingData.slice(-MAX_PENDING_DATA);
        }
        updated[agentId] = {
          pendingData,
          scrollback,
        };
      }
      return { terminalBuffers: updated };
    });
  }

  function flushExecuteOutputBatch(): void {
    executeOutputTimer = null;
    if (executeOutputQueue.size === 0) return;

    const batch = new Map(executeOutputQueue);
    executeOutputQueue.clear();

    set((state) => {
      const updated = { ...state.executeSegments };
      for (const [agentId, { chunks, clear, command }] of batch) {
        let segments = [...(updated[agentId] ?? [])];

        if (clear) {
          // Mark previous segment as done if it was running
          if (segments.length > 0) {
            const last = segments[segments.length - 1];
            if (last.status === 'running') {
              segments[segments.length - 1] = { ...last, status: 'done' };
            }
          }
          // Push new segment
          segments.push({
            id: crypto.randomUUID(),
            command: command ?? '',
            timestamp: Date.now(),
            content: chunks.join(''),
            status: 'running',
          });
          // Cap total segments
          if (segments.length > MAX_SEGMENTS) {
            segments = segments.slice(-MAX_SEGMENTS);
          }
        } else {
          // Append to latest segment
          if (segments.length === 0) {
            segments.push({
              id: crypto.randomUUID(),
              command: '',
              timestamp: Date.now(),
              content: chunks.join(''),
              status: 'running',
            });
          } else {
            const last = segments[segments.length - 1];
            let content = last.content + chunks.join('');
            if (content.length > MAX_EXECUTE_OUTPUT) {
              content = content.slice(-MAX_EXECUTE_OUTPUT);
            }
            segments[segments.length - 1] = { ...last, content };
          }
        }

        updated[agentId] = segments;
      }
      return { executeSegments: updated };
    });
  }

  return {
    terminalBuffers: {},
    executeSegments: {},

    appendTerminalData: (agentId, data) => {
      const queue = terminalBatchQueue.get(agentId);
      if (queue) {
        queue.push(data);
      } else {
        terminalBatchQueue.set(agentId, [data]);
      }
      if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, TERMINAL_BATCH_MS);
      }
    },

    flushTerminalData: (agentId) =>
      set((state) => {
        const existing = state.terminalBuffers[agentId];
        if (!existing) return state;
        return {
          terminalBuffers: {
            ...state.terminalBuffers,
            [agentId]: { pendingData: [], scrollback: existing.scrollback },
          },
        };
      }),

    clearTerminal: (agentId) =>
      set((state) => ({
        terminalBuffers: {
          ...state.terminalBuffers,
          [agentId]: { pendingData: [], scrollback: [] },
        },
      })),

    appendExecuteOutput: (agentId, data, clear, command) => {
      const existing = executeOutputQueue.get(agentId);
      if (existing) {
        if (clear) {
          existing.chunks.length = 0;
          existing.clear = true;
          if (command) existing.command = command;
        }
        existing.chunks.push(data);
      } else {
        executeOutputQueue.set(agentId, { chunks: [data], clear: !!clear, command });
      }
      if (!executeOutputTimer) {
        executeOutputTimer = setTimeout(flushExecuteOutputBatch, EXECUTE_OUTPUT_BATCH_MS);
      }
    },

    completeExecuteSegment: (agentId, status) =>
      set((state) => {
        const segments = state.executeSegments[agentId];
        if (!segments || segments.length === 0) return state;
        const last = segments[segments.length - 1];
        if (last.status !== 'running') return state;
        const updated = [...segments];
        updated[updated.length - 1] = { ...last, status };
        return { executeSegments: { ...state.executeSegments, [agentId]: updated } };
      }),

    clearExecuteSegments: (agentId) =>
      set((state) => {
        const { [agentId]: _, ...rest } = state.executeSegments;
        return { executeSegments: rest };
      }),

    removeTerminalBuffer: (agentId) =>
      set((state) => {
        const { [agentId]: _buf, ...terminalBuffers } = state.terminalBuffers;
        const { [agentId]: _exec, ...executeSegments } = state.executeSegments;
        terminalBatchQueue.delete(agentId);
        executeOutputQueue.delete(agentId);
        return { terminalBuffers, executeSegments };
      }),

    _cleanupBatchers: () => {
      if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
      if (executeOutputTimer) { clearTimeout(executeOutputTimer); executeOutputTimer = null; }
      terminalBatchQueue.clear();
      executeOutputQueue.clear();
    },
  };
};
