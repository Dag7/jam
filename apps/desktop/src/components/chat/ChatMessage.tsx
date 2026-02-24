import React, { useState } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import type { ChatMessage } from '@/store/chatSlice';

interface ChatMessageProps {
  message: ChatMessage;
  /** Called when user clicks "View output" — opens the thread drawer for this agent */
  onViewOutput?: (agentId: string) => void;
  /** Whether this agent's thread drawer is currently open */
  isThreadOpen?: boolean;
  onDelete?: (id: string) => void;
}

const plugins = { code };

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const DeleteButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
    title="Delete message"
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  </button>
);

export const ChatMessageView: React.FC<ChatMessageProps> = ({ message, onViewOutput, isThreadOpen, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const handleDelete = onDelete ? () => onDelete(message.id) : undefined;

  // System task notification — compact with expandable output
  if (message.role === 'system' && message.taskResult) {
    const { title, success, summary } = message.taskResult;
    return (
      <div className="group flex items-start gap-2 mb-3 px-2">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5"
          style={{ backgroundColor: '#8b5cf620', color: '#8b5cf6' }}
        >
          J
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${success ? 'text-zinc-400' : 'text-red-400'}`}>
              {success ? 'Completed' : 'Failed'}: {title}
            </span>
            <span className="text-[10px] text-zinc-600">{formatTime(message.timestamp)}</span>
            {handleDelete && <DeleteButton onClick={handleDelete} />}
          </div>
          {summary && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {expanded ? 'Hide output' : 'View output'}
            </button>
          )}
          {expanded && summary && (
            <div className="mt-1.5 bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-3 py-2 text-xs text-zinc-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {summary}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="group flex justify-center items-center gap-1 mb-4">
        <span className="text-xs text-zinc-500 bg-zinc-800/50 px-3 py-1 rounded-full">
          {message.content}
        </span>
        {handleDelete && <DeleteButton onClick={handleDelete} />}
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="group flex justify-end items-start gap-1 mb-4">
        {handleDelete && <DeleteButton onClick={handleDelete} />}
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
        : message.agentRuntime === 'codex'
          ? 'Codex CLI'
          : message.agentRuntime === 'cursor'
            ? 'Cursor'
            : message.agentRuntime;

  const runtimeBadgeClass =
    message.agentRuntime === 'claude-code'
      ? 'bg-orange-900/40 text-orange-400'
      : message.agentRuntime === 'cursor'
        ? 'bg-blue-900/40 text-blue-400'
        : message.agentRuntime === 'codex'
          ? 'bg-green-900/40 text-green-400'
          : 'bg-zinc-800 text-zinc-400';

  return (
    <div className="group flex mb-4 gap-3">
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
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${runtimeBadgeClass}`}>
              {runtimeLabel}
            </span>
          )}
          <span className="text-[10px] text-zinc-600 ml-auto">{formatTime(message.timestamp)}</span>
          {handleDelete && <DeleteButton onClick={handleDelete} />}
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

        {/* View output button — shown on agent messages when there's an agentId */}
        {message.agentId && onViewOutput && (
          <button
            onClick={() => onViewOutput(message.agentId!)}
            className={`
              mt-1.5 flex items-center gap-1.5 text-[11px] transition-colors
              ${isThreadOpen
                ? 'text-blue-400'
                : 'text-zinc-500 hover:text-zinc-300'
              }
            `}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            {isThreadOpen ? 'Viewing output' : 'View output'}
          </button>
        )}
      </div>
    </div>
  );
};
