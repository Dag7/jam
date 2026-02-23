import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionProgress } from '@jam/core';
import { JsonlOutputStrategy, ThrottledOutputStrategy } from '../runtimes/output-strategy.js';
import type { OutputCallbacks } from '../runtimes/output-strategy.js';

describe('JsonlOutputStrategy', () => {
  let parseStreamEvent: ReturnType<typeof vi.fn<(line: string, onProgress: (event: ExecutionProgress) => void) => void>>;
  let emitTerminalLine: ReturnType<typeof vi.fn<(line: string, onOutput: (data: string) => void) => void>>;
  let strategy: JsonlOutputStrategy;
  let callbacks: OutputCallbacks;

  beforeEach(() => {
    parseStreamEvent = vi.fn<(line: string, onProgress: (event: ExecutionProgress) => void) => void>();
    emitTerminalLine = vi.fn<(line: string, onOutput: (data: string) => void) => void>();
    strategy = new JsonlOutputStrategy(parseStreamEvent, emitTerminalLine);
    callbacks = {
      onProgress: vi.fn(),
      onOutput: vi.fn(),
    };
  });

  it('splits input by newlines and processes complete lines', () => {
    strategy.processChunk('line1\nline2\n', callbacks);
    expect(parseStreamEvent).toHaveBeenCalledTimes(2);
    expect(parseStreamEvent).toHaveBeenCalledWith('line1', callbacks.onProgress);
    expect(parseStreamEvent).toHaveBeenCalledWith('line2', callbacks.onProgress);
  });

  it('buffers incomplete lines until next chunk', () => {
    strategy.processChunk('partial', callbacks);
    expect(parseStreamEvent).not.toHaveBeenCalled();

    strategy.processChunk(' data\n', callbacks);
    expect(parseStreamEvent).toHaveBeenCalledTimes(1);
    expect(parseStreamEvent).toHaveBeenCalledWith('partial data', callbacks.onProgress);
  });

  it('completes buffered lines across chunks', () => {
    strategy.processChunk('first-', callbacks);
    strategy.processChunk('half\nsecond\n', callbacks);
    expect(parseStreamEvent).toHaveBeenCalledWith('first-half', callbacks.onProgress);
    expect(parseStreamEvent).toHaveBeenCalledWith('second', callbacks.onProgress);
  });

  it('skips empty lines', () => {
    strategy.processChunk('line1\n\n\nline2\n', callbacks);
    expect(parseStreamEvent).toHaveBeenCalledTimes(2);
  });

  it('calls both onProgress and onOutput for each line', () => {
    strategy.processChunk('data\n', callbacks);
    expect(parseStreamEvent).toHaveBeenCalledWith('data', callbacks.onProgress);
    expect(emitTerminalLine).toHaveBeenCalledWith('data', callbacks.onOutput);
  });

  it('does nothing when both callbacks are absent', () => {
    strategy.processChunk('data\n', {});
    expect(parseStreamEvent).not.toHaveBeenCalled();
    expect(emitTerminalLine).not.toHaveBeenCalled();
  });

  it('flushes remaining buffer content', () => {
    strategy.processChunk('incomplete', callbacks);
    strategy.flush(callbacks);
    expect(parseStreamEvent).toHaveBeenCalledWith('incomplete', callbacks.onProgress);
    expect(emitTerminalLine).toHaveBeenCalledWith('incomplete', callbacks.onOutput);
  });

  it('flush does nothing when buffer is empty', () => {
    strategy.flush(callbacks);
    expect(parseStreamEvent).not.toHaveBeenCalled();
  });

  it('flush does nothing when buffer is whitespace-only', () => {
    strategy.processChunk('data\n   ', callbacks);
    parseStreamEvent.mockClear();
    emitTerminalLine.mockClear();
    strategy.flush(callbacks);
    expect(parseStreamEvent).not.toHaveBeenCalled();
  });
});

describe('ThrottledOutputStrategy', () => {
  let classifyChunk: ReturnType<typeof vi.fn<(cleaned: string) => 'tool-use' | 'thinking' | 'text'>>;
  let strategy: ThrottledOutputStrategy;
  let callbacks: OutputCallbacks;

  beforeEach(() => {
    vi.useFakeTimers();
    classifyChunk = vi.fn<(cleaned: string) => 'tool-use' | 'thinking' | 'text'>().mockReturnValue('text');
    strategy = new ThrottledOutputStrategy(classifyChunk);
    callbacks = {
      onProgress: vi.fn(),
      onOutput: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('always calls onOutput with ANSI-stripped chunk', () => {
    strategy.processChunk('\x1b[31mred text\x1b[0m', callbacks);
    expect(callbacks.onOutput).toHaveBeenCalledWith('red text');
  });

  it('emits initial thinking progress on first chunk', () => {
    strategy.processChunk('first chunk', callbacks);
    expect(callbacks.onProgress).toHaveBeenCalledWith({
      type: 'thinking',
      summary: 'Processing request...',
    });
  });

  it('throttles progress to 5-second intervals', () => {
    strategy.processChunk('chunk1', callbacks);
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1); // initial

    // Before 5 seconds — should not emit
    vi.advanceTimersByTime(3000);
    strategy.processChunk('chunk2', callbacks);
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1);

    // After 5 seconds — should emit
    vi.advanceTimersByTime(3000);
    strategy.processChunk('chunk3', callbacks);
    expect(callbacks.onProgress).toHaveBeenCalledTimes(2);
  });

  it('uses classifyChunk for throttled progress type', () => {
    classifyChunk.mockReturnValue('tool-use');
    strategy.processChunk('first', callbacks);

    vi.advanceTimersByTime(6000);
    strategy.processChunk('Using Bash', callbacks);
    expect(classifyChunk).toHaveBeenCalledWith('Using Bash');
    expect(callbacks.onProgress).toHaveBeenLastCalledWith({
      type: 'tool-use',
      summary: 'Using Bash',
    });
  });

  it('skips throttled progress when cleaned text is empty', () => {
    strategy.processChunk('first', callbacks);
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6000);
    // Pure ANSI chunk that strips to empty
    strategy.processChunk('\x1b[31m\x1b[0m', callbacks);
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1);
  });

  it('truncates progress summary to 80 chars', () => {
    strategy.processChunk('first', callbacks);

    vi.advanceTimersByTime(6000);
    const longText = 'x'.repeat(120);
    strategy.processChunk(longText, callbacks);
    const lastCall = (callbacks.onProgress as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(lastCall[0].summary).toHaveLength(80);
  });

  it('does nothing when no callbacks are present', () => {
    strategy.processChunk('data', {});
    // No error thrown
  });

  it('does nothing when only onOutput is present', () => {
    strategy.processChunk('data', { onOutput: vi.fn() });
    expect(classifyChunk).not.toHaveBeenCalled();
  });

  it('flush is a no-op', () => {
    strategy.processChunk('data', callbacks);
    const progressCallCount = (callbacks.onProgress as ReturnType<typeof vi.fn>).mock.calls.length;
    strategy.flush(callbacks);
    expect((callbacks.onProgress as ReturnType<typeof vi.fn>).mock.calls.length).toBe(progressCallCount);
  });
});
