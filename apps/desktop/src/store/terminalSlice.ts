import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

/** Maximum scrollback entries kept in memory per agent */
const MAX_SCROLLBACK = 500;

/** Maximum pending data entries per agent — prevents unbounded memory growth when terminal tab is not mounted */
const MAX_PENDING_DATA = 1_000;

/** Maximum execute output string length per agent (~500KB) — prevents unbounded memory growth */
const MAX_EXECUTE_OUTPUT = 500_000;

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

export interface TerminalSlice {
  terminalBuffers: Record<string, TerminalBuffer>;
  /** Execute output per agent — markdown text for streamdown rendering in ThreadDrawer */
  executeOutput: Record<string, string>;

  appendTerminalData: (agentId: string, data: string) => void;
  flushTerminalData: (agentId: string) => void;
  clearTerminal: (agentId: string) => void;
  appendExecuteOutput: (agentId: string, data: string, clear?: boolean) => void;
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

  const executeOutputQueue = new Map<string, { chunks: string[]; clear: boolean }>();
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
        const scrollback = existing.scrollback.concat(chunks);
        if (scrollback.length > MAX_SCROLLBACK) {
          scrollback.splice(0, scrollback.length - MAX_SCROLLBACK);
        }
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
      const updated = { ...state.executeOutput };
      for (const [agentId, { chunks, clear }] of batch) {
        const prev = clear ? '' : (updated[agentId] ?? '');
        let combined = prev + chunks.join('');
        if (combined.length > MAX_EXECUTE_OUTPUT) {
          combined = combined.slice(-MAX_EXECUTE_OUTPUT);
        }
        updated[agentId] = combined;
      }
      return { executeOutput: updated };
    });
  }

  return {
    terminalBuffers: {},
    executeOutput: {},

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

    appendExecuteOutput: (agentId, data, clear) => {
      const existing = executeOutputQueue.get(agentId);
      if (existing) {
        if (clear) {
          existing.chunks.length = 0;
          existing.clear = true;
        }
        existing.chunks.push(data);
      } else {
        executeOutputQueue.set(agentId, { chunks: [data], clear: !!clear });
      }
      if (!executeOutputTimer) {
        executeOutputTimer = setTimeout(flushExecuteOutputBatch, EXECUTE_OUTPUT_BATCH_MS);
      }
    },
  };
};
