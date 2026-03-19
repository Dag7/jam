import type { ExecutionProgress, ExecutionResult, TokenUsage } from '@jam/core';
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

    // Tool use — show tool name and input clearly
    if (event.type === 'tool_use' || event.tool_name) {
      const toolName = event.tool_name ?? event.name ?? 'tool';
      const input = event.input?.command ?? event.input?.file_path ?? '';
      const preview = input ? ` \`${String(input).slice(0, 120)}\`` : '';
      onOutput(`\n**${toolName}**${preview}\n`);
      return;
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const name = event.content_block.name ?? 'tool';
      onOutput(`\n**${name}** `);
      return;
    }

    // Tool result — show output in a fenced code block
    if (event.type === 'tool_result' || event.content_type === 'tool_result') {
      const output = event.output ?? event.content ?? '';
      if (output) onOutput(`\n\`\`\`\n${String(output).slice(0, 800)}\n\`\`\`\n`);
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

/** Check if JSONL stdout contains an explicit `result` event.
 *  Used to distinguish genuine agent output from raw text fallback. */
export function hasResultEvent(stdout: string): boolean {
  for (const line of stdout.trim().split('\n')) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'result') return true;
    } catch { /* skip */ }
  }
  return false;
}

/** Extract the result from JSONL stdout (search backward for 'result' event).
 *  Also aggregates token usage from all events that report it. */
export function parseJsonlResult(stdout: string): ExecutionResult {
  const lines = stdout.trim().split('\n');
  const usage = extractTokenUsage(lines);

  // Look for the result event (last one wins)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'result') {
        return {
          success: true,
          text: obj.result ?? '',
          sessionId: obj.session_id,
          usage,
        };
      }
    } catch { /* skip non-JSON lines */ }
  }

  // Fallback: try as single JSON
  try {
    const data = JSON.parse(stdout);
    // System init message is not result text — skip it
    if (data.type === 'system' && data.subtype === 'init') {
      return { success: true, text: '', sessionId: data.session_id, usage };
    }
    return {
      success: true,
      text: data.result ?? data.text ?? data.content ?? stdout,
      sessionId: data.session_id,
      usage,
    };
  } catch {
    // Last resort: return raw stdout stripped of ANSI
    return { success: true, text: stripAnsiSimple(stdout).trim(), usage };
  }
}

/** Aggregate token usage from JSONL stream events.
 *  Supports multiple event shapes:
 *  - Claude Code: `result` event with `total_cost_usd`, or message events with `usage`
 *  - Generic: any event with `usage.input_tokens` / `usage.output_tokens` */
function extractTokenUsage(lines: string[]): TokenUsage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      // Claude Code result event includes total usage
      if (obj.type === 'result' && obj.total_input_tokens != null) {
        return {
          inputTokens: obj.total_input_tokens,
          outputTokens: obj.total_output_tokens ?? 0,
        };
      }

      // Claude Code result event — usage nested under result
      if (obj.type === 'result' && obj.usage) {
        return {
          inputTokens: obj.usage.input_tokens ?? 0,
          outputTokens: obj.usage.output_tokens ?? 0,
        };
      }

      // Message-level usage (Anthropic API shape: message_start, message_stop)
      if (obj.usage?.input_tokens != null || obj.usage?.output_tokens != null) {
        inputTokens += obj.usage.input_tokens ?? 0;
        outputTokens += obj.usage.output_tokens ?? 0;
        found = true;
        continue;
      }

      // Nested under message (e.g. message_start event)
      if (obj.message?.usage?.input_tokens != null) {
        inputTokens += obj.message.usage.input_tokens ?? 0;
        outputTokens += obj.message.usage.output_tokens ?? 0;
        found = true;
      }
    } catch { /* skip non-JSON */ }
  }

  return found ? { inputTokens, outputTokens } : undefined;
}
