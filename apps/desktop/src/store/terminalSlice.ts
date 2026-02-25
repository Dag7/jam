import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

/** Maximum scrollback entries kept in memory per agent */
const MAX_SCROLLBACK = 500;

/** Batching interval for terminal data (ms) — coalesces rapid IPC events into a single Zustand update */
const TERMINAL_BATCH_MS = 32;

/** Batching interval for execute output (ms) — longer than terminal since markdown re-parsing is heavier */
const EXECUTE_OUTPUT_BATCH_MS = 64;

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

/**
 * Batching state for terminal data — accumulated outside Zustand to avoid
 * triggering a store update on every IPC event. Flushed into the store
 * on a timer (~30fps).
 */
const terminalBatchQueue = new Map<string, string[]>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let storeSetFn: ((fn: (state: AppStore) => Partial<AppStore>) => void) | null = null;

/**
 * Batching state for executeOutput — same pattern as terminal data.
 * Coalesces rapid IPC chunks into a single Zustand update at ~15fps.
 */
const executeOutputQueue = new Map<string, { chunks: string[]; clear: boolean }>();
let executeOutputTimer: ReturnType<typeof setTimeout> | null = null;

function flushBatch(): void {
  batchTimer = null;
  if (!storeSetFn || terminalBatchQueue.size === 0) return;

  // Snapshot and clear the queue
  const batch = new Map(terminalBatchQueue);
  terminalBatchQueue.clear();

  storeSetFn((state) => {
    const updated = { ...state.terminalBuffers };
    for (const [agentId, chunks] of batch) {
      const existing = updated[agentId] ?? { pendingData: [], scrollback: [] };
      const scrollback = existing.scrollback.concat(chunks);
      // Cap scrollback
      if (scrollback.length > MAX_SCROLLBACK) {
        scrollback.splice(0, scrollback.length - MAX_SCROLLBACK);
      }
      updated[agentId] = {
        pendingData: existing.pendingData.concat(chunks),
        scrollback,
      };
    }
    return { terminalBuffers: updated };
  });
}

function flushExecuteOutputBatch(): void {
  executeOutputTimer = null;
  if (!storeSetFn || executeOutputQueue.size === 0) return;

  const batch = new Map(executeOutputQueue);
  executeOutputQueue.clear();

  storeSetFn((state) => {
    const updated = { ...state.executeOutput };
    for (const [agentId, { chunks, clear }] of batch) {
      const prev = clear ? '' : (updated[agentId] ?? '');
      updated[agentId] = prev + chunks.join('');
    }
    return { executeOutput: updated };
  });
}

export const createTerminalSlice: StateCreator<
  AppStore,
  [],
  [],
  TerminalSlice
> = (set) => {
  // Capture set function for the batching flush
  storeSetFn = set;

  return {
    terminalBuffers: {},
    executeOutput: {},

    appendTerminalData: (agentId, data) => {
      // Accumulate outside Zustand — no store update per call
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
