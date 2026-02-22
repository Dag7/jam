import React from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import type { ChatMessage } from '@/store/chatSlice';

interface ChatMessageProps {
  message: ChatMessage;
}

const plugins = { code };

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const ChatMessageView: React.FC<ChatMessageProps> = ({ message }) => {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center mb-4">
        <span className="text-xs text-zinc-500 bg-zinc-800/50 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] bg-blue-600/20 border border-blue-500/30 rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="text-sm text-zinc-200 whitespace-pre-wrap">{message.content}</p>
          <div className="flex items-center justify-end gap-2 mt-1.5">
            <span className="text-[10px] text-zinc-500">
              {message.source === 'voice' ? 'Voice' : 'Text'}
            </span>
            <span className="text-[10px] text-zinc-600">{formatTime(message.timestamp)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Agent message
  const isLoading = message.status === 'sending';
  const isError = message.status === 'error';

  const runtimeLabel =
    message.agentRuntime === 'claude-code'
      ? 'Claude Code'
      : message.agentRuntime === 'opencode'
        ? 'OpenCode'
        : message.agentRuntime;

  return (
    <div className="flex mb-4 gap-3">
      {/* Agent avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-1"
        style={{
          backgroundColor: `${message.agentColor ?? '#6b7280'}25`,
          color: message.agentColor ?? '#6b7280',
        }}
      >
        {(message.agentName ?? '?').charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        {/* Agent header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-zinc-200">
            {message.agentName ?? 'Agent'}
          </span>
          {runtimeLabel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
              {runtimeLabel}
            </span>
          )}
          <span className="text-[10px] text-zinc-600 ml-auto">{formatTime(message.timestamp)}</span>
        </div>

        {/* Message body */}
        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:0ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:150ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-xs text-zinc-500">Thinking...</span>
            </div>
          ) : isError ? (
            <p className="text-sm text-red-400">{message.error ?? message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <Streamdown
                mode="static"
                plugins={plugins}
              >
                {message.content}
              </Streamdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
