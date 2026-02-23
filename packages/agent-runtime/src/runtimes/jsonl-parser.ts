import type { ExecutionProgress, ExecutionResult } from '@jam/core';
import { stripAnsiSimple } from '../utils.js';

/**
 * Shared JSONL parsing utilities for stream-json runtimes (Claude Code, Cursor).
 * Single source of truth — eliminates duplication between runtimes.
 */

/** Parse a single JSONL stream event and emit structured progress */
export function parseJsonlStreamEvent(
  line: string,
  onProgress: (event: ExecutionProgress) => void,
): void {
  try {
    const event = JSON.parse(line);

    // Tool use events
    if (event.type === 'tool_use' || event.tool_name) {
      const toolName = event.tool_name ?? event.name ?? 'a tool';
      const input = event.input?.command ?? event.input?.file_path ?? '';
      const summary = input
        ? `Using ${toolName}: ${String(input).slice(0, 60)}`
        : `Using ${toolName}`;
      onProgress({ type: 'tool-use', summary });
      return;
    }

    // Content block with tool_use type
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const name = event.content_block.name ?? 'a tool';
      onProgress({ type: 'tool-use', summary: `Using ${name}` });
      return;
    }

    // Thinking events
    if (event.type === 'thinking' || (event.type === 'content_block_start' && event.content_block?.type === 'thinking')) {
      onProgress({ type: 'thinking', summary: 'Thinking...' });
      return;
    }

    // Message start
    if (event.type === 'message_start') {
      onProgress({ type: 'thinking', summary: 'Processing request...' });
      return;
    }

    // Text content block
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      onProgress({ type: 'text', summary: 'Composing response...' });
      return;
    }
  } catch {
    // Not JSON or unrecognized format — ignore
  }
}

/** Convert a JSONL event into markdown-friendly text for streamdown rendering */
export function emitJsonlTerminalLine(
  line: string,
  onOutput: (data: string) => void,
): void {
  try {
    const raw = JSON.parse(line);
    // Unwrap stream_event wrapper if present
    const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;

    // Tool use — show as inline code block
    if (event.type === 'tool_use' || event.tool_name) {
      const toolName = event.tool_name ?? event.name ?? 'tool';
      const input = event.input?.command ?? event.input?.file_path ?? '';
      onOutput(`\n\`${toolName}\` ${input ? String(input).slice(0, 200) : ''}\n`);
      return;
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const name = event.content_block.name ?? 'tool';
      onOutput(`\n\`${name}\` `);
      return;
    }

    // Tool result — show as code block
    if (event.type === 'tool_result' || event.content_type === 'tool_result') {
      const output = event.output ?? event.content ?? '';
      if (output) onOutput(`\n\`\`\`\n${String(output).slice(0, 500)}\n\`\`\`\n`);
      return;
    }

    // Text content delta — stream text as it arrives
    if (event.type === 'content_block_delta') {
      const text = event.delta?.text ?? event.delta?.thinking;
      if (text) {
        onOutput(text);
        return;
      }
    }

    // Thinking indicator
    if (event.type === 'thinking' || (event.type === 'content_block_start' && event.content_block?.type === 'thinking')) {
      onOutput('\n*thinking...*\n');
      return;
    }

    // Assistant message — contains the full response
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          onOutput(block.text);
        } else if (block.type === 'tool_use') {
          const input = block.input?.command ?? block.input?.file_path ?? '';
          onOutput(`\n\`${block.name}\` ${input ? String(input).slice(0, 200) : ''}\n`);
        }
      }
      return;
    }

    // Result event — show final result text
    if (event.type === 'result' && event.result) {
      onOutput(`\n${event.result}\n`);
      return;
    }

    // system, message_start, message_stop, content_block_stop — skip silently
  } catch {
    // Not JSON — emit raw line as-is
    const trimmed = line.trim();
    if (trimmed) onOutput(trimmed + '\n');
  }
}

/** Extract the result from JSONL stdout (search backward for 'result' event) */
export function parseJsonlResult(stdout: string): ExecutionResult {
  const lines = stdout.trim().split('\n');

  // Look for the result event (last one wins)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'result') {
        return {
          success: true,
          text: obj.result ?? '',
          sessionId: obj.session_id,
        };
      }
    } catch { /* skip non-JSON lines */ }
  }

  // Fallback: try as single JSON
  try {
    const data = JSON.parse(stdout);
    return {
      success: true,
      text: data.result ?? data.text ?? data.content ?? stdout,
      sessionId: data.session_id,
    };
  } catch {
    // Last resort: return raw stdout stripped of ANSI
    return { success: true, text: stripAnsiSimple(stdout).trim() };
  }
}
