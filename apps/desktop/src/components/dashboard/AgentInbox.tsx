import { useState, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';

const mdPlugins = { code };

type InboxTask = {
  id: string; title: string; description: string; status: string; priority: string;
  source: string; createdBy: string; assignedTo?: string;
  completedAt?: string; result?: string; error?: string; tags: string[];
};

interface AgentInboxProps {
  tasks: InboxTask[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
}

export function AgentInbox({ tasks, agentId, agents }: AgentInboxProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const inboxTasks = tasks.filter(
    t => t.source === 'agent' && (t.assignedTo === agentId || (t.createdBy === agentId && t.assignedTo !== agentId)),
  );

  const selectedTask = selectedTaskId ? inboxTasks.find(t => t.id === selectedTaskId) : null;

  if (selectedTask) {
    return (
      <InboxConversation
        task={selectedTask}
        allTasks={inboxTasks}
        agentId={agentId}
        agents={agents}
        onBack={() => setSelectedTaskId(null)}
      />
    );
  }

  const received = inboxTasks
    .filter(t => t.assignedTo === agentId)
    .sort((a, b) => (b.completedAt ?? b.id).localeCompare(a.completedAt ?? a.id));

  const sent = inboxTasks
    .filter(t => t.createdBy === agentId && t.assignedTo !== agentId)
    .sort((a, b) => (b.completedAt ?? b.id).localeCompare(a.completedAt ?? a.id));

  if (inboxTasks.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No inbox messages.</p>;
  }

  return (
    <div className="space-y-5">
      {received.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Received ({received.length})
          </h4>
          <div className="space-y-2">
            {received.map(t => (
              <InboxItem key={t.id} task={t} direction="received" agents={agents} onClick={() => setSelectedTaskId(t.id)} />
            ))}
          </div>
        </div>
      )}
      {sent.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Sent ({sent.length})
          </h4>
          <div className="space-y-2">
            {sent.map(t => (
              <InboxItem key={t.id} task={t} direction="sent" agents={agents} onClick={() => setSelectedTaskId(t.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InboxItem({ task, direction, agents, onClick }: {
  task: InboxTask;
  direction: 'received' | 'sent';
  agents: Record<string, { name: string; color: string }>;
  onClick: () => void;
}) {
  const counterpartId = direction === 'received' ? task.createdBy : task.assignedTo;
  const counterpart = counterpartId ? (agents[counterpartId] ?? agents[counterpartId.toLowerCase()] ?? null) : null;
  const isReply = task.tags.includes('task-result');

  const statusClass = task.status === 'completed' ? 'bg-green-900/50 text-green-400'
    : task.status === 'failed' ? 'bg-red-900/50 text-red-400'
    : task.status === 'running' ? 'bg-blue-900/50 text-blue-400'
    : 'bg-zinc-700 text-zinc-400';

  return (
    <div
      className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 cursor-pointer hover:border-zinc-500 hover:bg-zinc-750 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <span className={`text-sm font-mono shrink-0 mt-0.5 ${direction === 'received' ? 'text-amber-400' : 'text-blue-400'}`}>
          {direction === 'received' ? '\u2190' : '\u2192'}
        </span>
        {counterpart && (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5"
            style={{ backgroundColor: counterpart.color }}
          >
            {counterpart.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white font-medium truncate">{task.title}</span>
            {isReply && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-400 font-medium shrink-0">
                Reply
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${statusClass}`}>
              {task.status}
            </span>
          </div>
          {task.description && (
            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{task.description}</p>
          )}
          {task.result && task.status === 'completed' && !isReply && (
            <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2 italic">{task.result}</p>
          )}
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
            {counterpart && <span>{counterpart.name}</span>}
            {task.completedAt && <span>{new Date(task.completedAt).toLocaleString()}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function InboxConversation({ task, allTasks, agentId, agents, onBack }: {
  task: InboxTask;
  allTasks: InboxTask[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
  onBack: () => void;
}) {
  const messages = useMemo(() => {
    const msgs: Array<{
      id: string;
      senderId: string;
      content: string;
      timestamp: string;
      status?: string;
      isReply?: boolean;
    }> = [];

    const isReply = task.tags.includes('task-result');

    if (isReply) {
      const originalTitle = task.title.replace(/^\[(Completed|Failed)\]\s*/, '');
      const original = allTasks.find(
        t => !t.tags.includes('task-result') &&
          t.title === originalTitle &&
          t.assignedTo === task.createdBy,
      );

      if (original) {
        msgs.push({
          id: original.id,
          senderId: original.createdBy,
          content: `**${original.title}**\n\n${original.description}`,
          timestamp: original.completedAt ?? original.id,
        });
      }

      msgs.push({
        id: task.id,
        senderId: task.createdBy,
        content: task.description || task.title,
        timestamp: task.completedAt ?? task.id,
        status: task.title.startsWith('[Failed]') ? 'failed' : 'completed',
        isReply: true,
      });
    } else {
      msgs.push({
        id: task.id,
        senderId: task.createdBy,
        content: `**${task.title}**\n\n${task.description}`,
        timestamp: task.completedAt ?? task.id,
      });

      if (task.result && task.assignedTo) {
        msgs.push({
          id: `${task.id}-result`,
          senderId: task.assignedTo,
          content: task.result,
          timestamp: task.completedAt ?? task.id,
          status: task.status,
          isReply: true,
        });
      } else if (task.error && task.assignedTo) {
        msgs.push({
          id: `${task.id}-error`,
          senderId: task.assignedTo,
          content: task.error,
          timestamp: task.completedAt ?? task.id,
          status: 'failed',
          isReply: true,
        });
      }

      const reply = allTasks.find(
        t => t.tags.includes('task-result') &&
          t.createdBy === task.assignedTo &&
          (t.title.includes(task.title) || t.title.replace(/^\[(Completed|Failed)\]\s*/, '') === task.title),
      );

      if (reply && !task.result && !task.error) {
        msgs.push({
          id: reply.id,
          senderId: reply.createdBy,
          content: reply.description || reply.title,
          timestamp: reply.completedAt ?? reply.id,
          status: reply.title.startsWith('[Failed]') ? 'failed' : 'completed',
          isReply: true,
        });
      }
    }

    return msgs;
  }, [task, allTasks]);

  const resolveAgent = (id: string | undefined) => {
    if (!id) return null;
    return agents[id] ?? agents[id.toLowerCase()] ?? null;
  };

  const counterpartId = task.createdBy === agentId ? task.assignedTo : task.createdBy;
  const counterpart = resolveAgent(counterpartId);
  const self = agents[agentId];

  return (
    <div className="flex flex-col h-full -m-4">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700">
        <button
          onClick={onBack}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        {counterpart && (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ backgroundColor: counterpart.color }}
          >
            {counterpart.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-white">
            {counterpart?.name ?? 'Unknown Agent'}
          </span>
          <span className="text-xs text-zinc-500 ml-2">
            {task.tags.includes('task-result') ? task.title.replace(/^\[(Completed|Failed)\]\s*/, '') : task.title}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const sender = resolveAgent(msg.senderId);
          const isSelf = msg.senderId === agentId;
          return (
            <div key={msg.id} className="flex gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
                style={{ backgroundColor: sender?.color ?? (isSelf ? self?.color : '#6b7280') ?? '#6b7280' }}
              >
                {(sender?.name ?? (isSelf ? self?.name : '?') ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: sender?.color ?? '#9ca3af' }}
                  >
                    {sender?.name ?? 'Unknown'}
                  </span>
                  {msg.isReply && msg.status && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      msg.status === 'completed' ? 'bg-green-900/50 text-green-400'
                      : msg.status === 'failed' ? 'bg-red-900/50 text-red-400'
                      : 'bg-zinc-700 text-zinc-400'
                    }`}>
                      {msg.status}
                    </span>
                  )}
                  {msg.timestamp && msg.timestamp.includes('T') && (
                    <span className="text-[10px] text-zinc-500">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 mt-1">
                  <Streamdown mode="static" plugins={mdPlugins}>
                    {msg.content}
                  </Streamdown>
                </div>
              </div>
            </div>
          );
        })}

        {messages.length === 0 && (
          <p className="text-sm text-zinc-500 italic text-center py-8">No messages in this interaction.</p>
        )}

        {!task.tags.includes('task-result') && (task.status === 'running' || task.status === 'pending' || task.status === 'assigned') && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.3s]" />
            </div>
            <span>
              {task.status === 'running' ? 'Working on it...' : 'Waiting to start...'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
