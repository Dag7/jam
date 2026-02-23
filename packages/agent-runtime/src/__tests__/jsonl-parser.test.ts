import { describe, it, expect, vi } from 'vitest';
import { parseJsonlStreamEvent, emitJsonlTerminalLine, parseJsonlResult } from '../runtimes/jsonl-parser.js';

describe('parseJsonlStreamEvent', () => {
  it('emits tool-use for tool_use type', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'tool_use', tool_name: 'Bash', input: { command: 'ls -la' } }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'tool-use',
      summary: 'Using Bash: ls -la',
    });
  });

  it('emits tool-use for event with tool_name but no type', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ tool_name: 'Read', input: { file_path: '/foo/bar.ts' } }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'tool-use',
      summary: 'Using Read: /foo/bar.ts',
    });
  });

  it('emits tool-use without input detail when no command/file_path', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'tool_use', name: 'Search' }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'tool-use',
      summary: 'Using Search',
    });
  });

  it('truncates long input to 60 chars', () => {
    const onProgress = vi.fn();
    const longCmd = 'x'.repeat(100);
    parseJsonlStreamEvent(JSON.stringify({ type: 'tool_use', tool_name: 'Bash', input: { command: longCmd } }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'tool-use',
      summary: `Using Bash: ${'x'.repeat(60)}`,
    });
  });

  it('emits tool-use for content_block_start with tool_use type', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'Edit' } }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'tool-use',
      summary: 'Using Edit',
    });
  });

  it('emits thinking for thinking type', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'thinking' }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'thinking',
      summary: 'Thinking...',
    });
  });

  it('emits thinking for content_block_start with thinking type', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'content_block_start', content_block: { type: 'thinking' } }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'thinking',
      summary: 'Thinking...',
    });
  });

  it('emits thinking for message_start', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'message_start' }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'thinking',
      summary: 'Processing request...',
    });
  });

  it('emits text for content_block_start with text type', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'content_block_start', content_block: { type: 'text' } }), onProgress);
    expect(onProgress).toHaveBeenCalledWith({
      type: 'text',
      summary: 'Composing response...',
    });
  });

  it('ignores non-JSON lines', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent('not valid json', onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('ignores unrecognized event types', () => {
    const onProgress = vi.fn();
    parseJsonlStreamEvent(JSON.stringify({ type: 'message_stop' }), onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe('emitJsonlTerminalLine', () => {
  it('emits tool_use as inline code block', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'tool_use', tool_name: 'Bash', input: { command: 'ls' } }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('\n`Bash` ls\n');
  });

  it('emits tool_use without input', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'tool_use', name: 'Search' }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('\n`Search` \n');
  });

  it('emits content_block_start tool_use', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'Edit' } }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('\n`Edit` ');
  });

  it('emits tool_result as code block', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'tool_result', output: 'file.ts' }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('\n```\nfile.ts\n```\n');
  });

  it('skips tool_result with no output', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'tool_result', output: '' }), onOutput);
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('emits content_block_delta text', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'content_block_delta', delta: { text: 'hello world' } }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('hello world');
  });

  it('emits content_block_delta thinking', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'content_block_delta', delta: { thinking: 'reasoning...' } }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('reasoning...');
  });

  it('emits thinking indicator', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'thinking' }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('\n*thinking...*\n');
  });

  it('emits assistant message text blocks', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello!' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } },
        ],
      },
    }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('Hello!');
    expect(onOutput).toHaveBeenCalledWith('\n`Read` /a.ts\n');
  });

  it('emits result event', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({ type: 'result', result: 'Done!' }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('\nDone!\n');
  });

  it('unwraps stream_event wrapper', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine(JSON.stringify({
      type: 'stream_event',
      event: { type: 'thinking' },
    }), onOutput);
    expect(onOutput).toHaveBeenCalledWith('\n*thinking...*\n');
  });

  it('emits raw non-JSON lines as-is', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine('plain text output', onOutput);
    expect(onOutput).toHaveBeenCalledWith('plain text output\n');
  });

  it('skips empty non-JSON lines', () => {
    const onOutput = vi.fn();
    emitJsonlTerminalLine('   ', onOutput);
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('truncates long tool input to 200 chars', () => {
    const onOutput = vi.fn();
    const longCmd = 'a'.repeat(300);
    emitJsonlTerminalLine(JSON.stringify({ type: 'tool_use', tool_name: 'Bash', input: { command: longCmd } }), onOutput);
    const call = onOutput.mock.calls[0][0] as string;
    // The command portion should be truncated to 200
    expect(call).toContain('a'.repeat(200));
    expect(call).not.toContain('a'.repeat(201));
  });

  it('truncates long tool_result output to 500 chars', () => {
    const onOutput = vi.fn();
    const longOutput = 'b'.repeat(600);
    emitJsonlTerminalLine(JSON.stringify({ type: 'tool_result', output: longOutput }), onOutput);
    const call = onOutput.mock.calls[0][0] as string;
    expect(call).toContain('b'.repeat(500));
    expect(call).not.toContain('b'.repeat(501));
  });
});

describe('parseJsonlResult', () => {
  it('extracts result from JSONL result event', () => {
    const stdout = [
      JSON.stringify({ type: 'message_start' }),
      JSON.stringify({ type: 'thinking' }),
      JSON.stringify({ type: 'result', result: 'Final answer', session_id: 'sess-123' }),
    ].join('\n');
    const result = parseJsonlResult(stdout);
    expect(result).toEqual({
      success: true,
      text: 'Final answer',
      sessionId: 'sess-123',
    });
  });

  it('uses last result event when multiple exist', () => {
    const stdout = [
      JSON.stringify({ type: 'result', result: 'first' }),
      JSON.stringify({ type: 'result', result: 'second', session_id: 'abc' }),
    ].join('\n');
    const result = parseJsonlResult(stdout);
    expect(result.text).toBe('second');
    expect(result.sessionId).toBe('abc');
  });

  it('falls back to single JSON parsing', () => {
    const stdout = JSON.stringify({ text: 'hello', session_id: 'sid' });
    const result = parseJsonlResult(stdout);
    expect(result).toEqual({
      success: true,
      text: 'hello',
      sessionId: 'sid',
    });
  });

  it('falls back to raw stdout when nothing parses', () => {
    const result = parseJsonlResult('just raw text');
    expect(result).toEqual({
      success: true,
      text: 'just raw text',
    });
  });

  it('strips ANSI from raw fallback', () => {
    const result = parseJsonlResult('\x1b[31mcolored text\x1b[0m');
    expect(result.text).toBe('colored text');
  });

  it('returns empty text for result event with no result field', () => {
    const stdout = JSON.stringify({ type: 'result' });
    const result = parseJsonlResult(stdout);
    expect(result.text).toBe('');
  });
});
