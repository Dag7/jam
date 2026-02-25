import { useState, useEffect, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { SoulView } from '@/components/dashboard/SoulView';

const mdPlugins = { code };

interface ServiceEntry {
  port: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
  command?: string;
  cwd?: string;
}

interface AgentDetailViewProps {
  agent: { id: string; name: string; color: string };
  soul: {
    persona: string;
    role: string;
    traits: Record<string, number>;
    goals: string[];
    strengths: string[];
    weaknesses: string[];
    learnings: string[];
    version: number;
    lastReflection?: string;
  } | null;
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    totalTokensIn: number;
    totalTokensOut: number;
    averageResponseMs: number;
    streaks: { current: number; best: number };
  } | null;
  tasks: Array<{
    id: string; title: string; description: string; status: string; priority: string;
    source: string; createdBy: string; assignedTo?: string;
    startedAt?: string; completedAt?: string; result?: string; error?: string; tags: string[];
  }>;
  services: ServiceEntry[];

  relationships: Array<{
    targetAgentId: string;
    trustScore: number;
    interactionCount: number;
    delegationCount: number;
    delegationSuccessRate: number;
    lastInteraction: string;
    notes: string[];
  }>;
  activity: Array<{
    id: string;
    type: 'delegation_sent' | 'delegation_received' | 'task_completed' | 'task_failed' | 'broadcast';
    title: string;
    detail?: string;
    counterpart?: string;
    timestamp: string;
  }>;
  agents: Record<string, { name: string; color: string }>;
  onTriggerReflection: () => void;
  onCancelTask: (taskId: string) => void;
  onStopService: (port: number) => void;
  onRestartService: (serviceName: string) => void;
  onOpenService: (port: number) => void;
  isReflecting?: boolean;
}

const tabs = ['Soul', 'Stats', 'Tasks', 'Inbox', 'Activity', 'Services', 'Relationships'] as const;
type Tab = (typeof tabs)[number];

export function AgentDetailView({
  agent,
  soul,
  stats,
  tasks,
  activity,
  services,
  relationships,
  agents,
  onTriggerReflection,
  onCancelTask,
  onStopService,
  onRestartService,
  onOpenService,
  isReflecting = false,
}: AgentDetailViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Soul');

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-zinc-700">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white"
          style={{ backgroundColor: agent.color }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-white">{agent.name}</h2>
          {soul?.role && (
            <span className="text-xs text-zinc-400">{soul.role}</span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-700">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab}
            {tab === 'Inbox' && (() => {
              const count = tasks.filter(
                t => t.source === 'agent' && (t.assignedTo === agent.id || (t.createdBy === agent.id && t.assignedTo !== agent.id)),
              ).length;
              return count > 0 ? (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-purple-900/50 text-purple-400">
                  {count}
                </span>
              ) : null;
            })()}
            {tab === 'Activity' && activity.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-blue-900/50 text-blue-400">
                {activity.length}
              </span>
            )}
            {tab === 'Services' && services.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-green-900/50 text-green-400">
                {services.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'Soul' && (
          <div>
            {soul ? (
              <SoulView soul={soul} />
            ) : (
              <p className="text-sm text-zinc-500 italic">No soul data available.</p>
            )}
            <button
              onClick={onTriggerReflection}
              disabled={isReflecting}
              className={`mt-4 px-4 py-2 text-sm rounded-lg border transition-colors inline-flex items-center gap-2 ${
                isReflecting
                  ? 'bg-violet-900/30 border-violet-700/50 text-violet-300 cursor-wait'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              {isReflecting && (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {isReflecting ? 'Reflecting...' : 'Trigger Reflection'}
            </button>
          </div>
        )}

        {activeTab === 'Stats' && (
          <div>
            {stats ? (
              <div className="grid grid-cols-2 gap-4">
                <StatBlock label="Tasks Completed" value={stats.tasksCompleted} />
                <StatBlock label="Tasks Failed" value={stats.tasksFailed} color="text-red-400" />
                <StatBlock label="Tokens In" value={stats.totalTokensIn.toLocaleString()} />
                <StatBlock label="Tokens Out" value={stats.totalTokensOut.toLocaleString()} />
                <StatBlock
                  label="Avg Response"
                  value={
                    stats.averageResponseMs < 1000
                      ? `${Math.round(stats.averageResponseMs)}ms`
                      : `${(stats.averageResponseMs / 1000).toFixed(1)}s`
                  }
                />
                <StatBlock label="Current Streak" value={stats.streaks.current} color="text-amber-400" />
                <StatBlock label="Best Streak" value={stats.streaks.best} color="text-amber-400" />
              </div>
            ) : (
              <p className="text-sm text-zinc-500 italic">No stats available.</p>
            )}
          </div>
        )}

        {activeTab === 'Tasks' && (
          <TaskList tasks={tasks} onCancelTask={onCancelTask} />
        )}

        {activeTab === 'Inbox' && (
          <InboxList tasks={tasks} agentId={agent.id} agents={agents} />
        )}

        {activeTab === 'Activity' && (
          <div className="space-y-2">
            {activity.length === 0 && (
              <p className="text-sm text-zinc-500 italic">No activity yet.</p>
            )}
            {activity.map((item) => {
              const counterpartAgent = item.counterpart ? agents[item.counterpart] : null;
              const icon = item.type === 'delegation_sent' ? '→'
                : item.type === 'delegation_received' ? '←'
                : item.type === 'task_completed' ? '✓'
                : item.type === 'task_failed' ? '✗'
                : '◈';
              const color = item.type === 'task_completed' || item.type === 'broadcast' ? 'text-green-400'
                : item.type === 'task_failed' ? 'text-red-400'
                : item.type === 'delegation_sent' ? 'text-blue-400'
                : 'text-amber-400';
              return (
                <div
                  key={item.id}
                  className="bg-zinc-800 rounded-lg p-3 border border-zinc-700"
                >
                  <div className="flex items-start gap-2">
                    <span className={`text-sm font-mono shrink-0 mt-0.5 ${color}`}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium truncate">{item.title}</span>
                      </div>
                      {item.detail && (
                        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{item.detail}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                        {counterpartAgent && (
                          <span className="flex items-center gap-1">
                            <span
                              className="w-3 h-3 rounded-full inline-block"
                              style={{ backgroundColor: counterpartAgent.color }}
                            />
                            {counterpartAgent.name}
                          </span>
                        )}
                        <span>{new Date(item.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'Services' && (
          <div className="space-y-2">
            {services.length === 0 && (
              <p className="text-sm text-zinc-500 italic">No services found.</p>
            )}
            {services.map((svc) => {
              const isAlive = svc.alive !== false;
              const canRestart = !isAlive && !!svc.command;
              return (
                <div
                  key={`${svc.name}-${svc.port}`}
                  className={`bg-zinc-800 rounded-lg p-3 border ${
                    isAlive ? 'border-zinc-700' : 'border-zinc-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isAlive ? 'bg-green-400' : 'bg-red-400/60'
                        }`}
                      />
                      <span className={`text-sm font-medium truncate ${
                        isAlive ? 'text-white' : 'text-zinc-400'
                      }`}>{svc.name}</span>
                      {svc.port && (
                        <span className="text-xs text-zinc-500 shrink-0">:{svc.port}</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        isAlive
                          ? 'bg-green-900/40 text-green-400'
                          : 'bg-red-900/30 text-red-400/80'
                      }`}>
                        {isAlive ? 'running' : 'stopped'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Open in browser — only when alive and has port */}
                      {isAlive && svc.port && (
                        <button
                          onClick={() => onOpenService(svc.port!)}
                          className="p-1.5 text-zinc-500 hover:text-blue-400 transition-colors rounded hover:bg-zinc-700"
                          title={`Open http://localhost:${svc.port}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </button>
                      )}
                      {/* Start/Restart — only when stopped and has command */}
                      {canRestart && (
                        <button
                          onClick={() => onRestartService(svc.name)}
                          className="p-1.5 text-zinc-500 hover:text-green-400 transition-colors rounded hover:bg-zinc-700"
                          title="Start service"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        </button>
                      )}
                      {/* Stop — only when alive */}
                      {isAlive && svc.port && (
                        <button
                          onClick={() => onStopService(svc.port!)}
                          className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors rounded hover:bg-zinc-700"
                          title="Stop service"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                    <span>:{svc.port}</span>
                    {svc.logFile && <span>{svc.logFile}</span>}
                    <span>{new Date(svc.startedAt).toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'Relationships' && (
          <RelationshipList
            relationships={relationships}
            tasks={tasks}
            agentId={agent.id}
            agents={agents}
          />
        )}
      </div>
    </div>
  );
}

function formatElapsed(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function TaskList({ tasks, onCancelTask }: {
  tasks: Array<{ id: string; title: string; status: string; priority: string; startedAt?: string }>;
  onCancelTask: (taskId: string) => void;
}) {
  const hasRunning = tasks.some(t => t.status === 'running');
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  if (tasks.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No tasks assigned.</p>;
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const isRunning = task.status === 'running';
        return (
          <div
            key={task.id}
            className={`bg-zinc-800 rounded-lg p-3 border ${isRunning ? 'border-blue-700/50' : 'border-zinc-700'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-white font-medium">{task.title}</span>
              <div className="flex items-center gap-2">
                {isRunning && task.startedAt && (
                  <span className="text-xs text-blue-400 flex items-center gap-1">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {formatElapsed(task.startedAt)}
                  </span>
                )}
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    task.status === 'completed'
                      ? 'bg-green-900/50 text-green-400'
                      : task.status === 'failed'
                        ? 'bg-red-900/50 text-red-400'
                        : task.status === 'running'
                          ? 'bg-blue-900/50 text-blue-400'
                          : 'bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {task.status}
                </span>
                {isRunning && (
                  <button
                    onClick={() => onCancelTask(task.id)}
                    className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Stop task"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1">
              <span
                className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  task.priority === 'critical'
                    ? 'bg-red-900/50 text-red-400'
                    : task.priority === 'high'
                      ? 'bg-orange-900/50 text-orange-400'
                      : task.priority === 'normal'
                        ? 'bg-blue-900/50 text-blue-400'
                        : 'bg-zinc-700 text-zinc-400'
                }`}
              >
                {task.priority}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatBlock({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-zinc-400 mt-1">{label}</div>
    </div>
  );
}

type InboxTask = {
  id: string; title: string; description: string; status: string; priority: string;
  source: string; createdBy: string; assignedTo?: string;
  completedAt?: string; result?: string; error?: string; tags: string[];
};

type RelationshipData = {
  targetAgentId: string; trustScore: number; interactionCount: number;
  delegationCount: number; delegationSuccessRate: number; lastInteraction: string; notes: string[];
};

type TaskData = {
  id: string; title: string; description: string; status: string; priority: string;
  source: string; createdBy: string; assignedTo?: string;
  startedAt?: string; completedAt?: string; result?: string; error?: string; tags: string[];
};

function RelationshipList({ relationships, tasks, agentId, agents }: {
  relationships: RelationshipData[];
  tasks: TaskData[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (relationships.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No relationships yet.</p>;
  }

  return (
    <div className="space-y-2">
      {relationships.map((rel) => (
        <RelationshipCard
          key={rel.targetAgentId}
          rel={rel}
          tasks={tasks}
          agentId={agentId}
          agents={agents}
          isExpanded={expandedId === rel.targetAgentId}
          onToggle={() => setExpandedId(expandedId === rel.targetAgentId ? null : rel.targetAgentId)}
        />
      ))}
    </div>
  );
}

function RelationshipCard({ rel, tasks, agentId, agents, isExpanded, onToggle }: {
  rel: RelationshipData;
  tasks: TaskData[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const target = agents[rel.targetAgentId];
  const trustColor = rel.trustScore > 0.7 ? 'text-green-400'
    : rel.trustScore >= 0.4 ? 'text-yellow-400' : 'text-red-400';

  // Task history between these two agents (delegations in both directions)
  const taskHistory = useMemo(() => {
    return tasks
      .filter(t =>
        t.source === 'agent' && (
          (t.createdBy === agentId && t.assignedTo === rel.targetAgentId) ||
          (t.createdBy === rel.targetAgentId && t.assignedTo === agentId)
        ),
      )
      .sort((a, b) => (b.completedAt ?? b.startedAt ?? '').localeCompare(a.completedAt ?? a.startedAt ?? ''))
      .slice(0, 10);
  }, [tasks, agentId, rel.targetAgentId]);

  return (
    <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
      {/* Clickable header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-zinc-750 transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ backgroundColor: target?.color ?? '#6b7280' }}
        >
          {(target?.name ?? '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">
            {target?.name ?? rel.targetAgentId}
          </div>
          <div className="text-xs text-zinc-400">
            {rel.interactionCount} interactions
            {rel.delegationCount > 0 && ` \u00b7 ${rel.delegationCount} delegations`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-semibold ${trustColor}`}>
            {Math.round(rel.trustScore * 100)}%
          </div>
          <div className="text-xs text-zinc-500">Trust</div>
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`text-zinc-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-zinc-700 px-3 py-3 space-y-3">
          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-900/50 rounded px-2.5 py-2">
              <div className="text-xs text-zinc-500">Success Rate</div>
              <div className={`text-sm font-semibold ${
                rel.delegationSuccessRate > 0.7 ? 'text-green-400'
                : rel.delegationSuccessRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {rel.delegationCount > 0 ? `${Math.round(rel.delegationSuccessRate * 100)}%` : 'N/A'}
              </div>
            </div>
            <div className="bg-zinc-900/50 rounded px-2.5 py-2">
              <div className="text-xs text-zinc-500">Delegations</div>
              <div className="text-sm font-semibold text-white">{rel.delegationCount}</div>
            </div>
            <div className="bg-zinc-900/50 rounded px-2.5 py-2">
              <div className="text-xs text-zinc-500">Last Active</div>
              <div className="text-sm font-semibold text-white">
                {rel.lastInteraction ? formatRelativeTime(rel.lastInteraction) : 'Never'}
              </div>
            </div>
          </div>

          {/* Trust bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500">Trust Level</span>
              <span className={`text-xs font-medium ${trustColor}`}>{Math.round(rel.trustScore * 100)}%</span>
            </div>
            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  rel.trustScore > 0.7 ? 'bg-green-500' : rel.trustScore >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.round(rel.trustScore * 100)}%` }}
              />
            </div>
          </div>

          {/* Notes */}
          {rel.notes.length > 0 && (
            <div>
              <h5 className="text-xs text-zinc-500 font-medium mb-1">Notes</h5>
              <ul className="space-y-0.5">
                {rel.notes.map((note, i) => (
                  <li key={i} className="text-xs text-zinc-400">{note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Task history */}
          {taskHistory.length > 0 && (
            <div>
              <h5 className="text-xs text-zinc-500 font-medium mb-1.5">Interaction History</h5>
              <div className="space-y-1.5">
                {taskHistory.map((task) => {
                  const isSent = task.createdBy === agentId;
                  const statusColor = task.status === 'completed' ? 'text-green-400'
                    : task.status === 'failed' ? 'text-red-400'
                    : task.status === 'running' ? 'text-blue-400'
                    : 'text-zinc-400';
                  return (
                    <div key={task.id} className="flex items-start gap-2 text-xs">
                      <span className={`shrink-0 mt-0.5 font-mono ${isSent ? 'text-blue-400' : 'text-amber-400'}`}>
                        {isSent ? '\u2192' : '\u2190'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-zinc-300 truncate block">{task.title}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`font-medium ${statusColor}`}>{task.status}</span>
                          {task.completedAt && (
                            <span className="text-zinc-600">{formatRelativeTime(task.completedAt)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {taskHistory.length === 0 && rel.notes.length === 0 && (
            <p className="text-xs text-zinc-600 italic">No detailed interaction history available.</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function InboxList({ tasks, agentId, agents }: {
  tasks: InboxTask[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
}) {
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
  const counterpart = counterpartId ? agents[counterpartId] : null;
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

/** Chat-style view of an inbox interaction (request + reply). */
function InboxConversation({ task, allTasks, agentId, agents, onBack }: {
  task: InboxTask;
  allTasks: InboxTask[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
  onBack: () => void;
}) {
  // Build the conversation messages from the task chain
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
      // This is a reply task — find the original request
      // Reply titles are "[Completed] Original Title" or "[Failed] Original Title"
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

      // The reply itself
      msgs.push({
        id: task.id,
        senderId: task.createdBy,
        content: task.description || task.title,
        timestamp: task.completedAt ?? task.id,
        status: task.title.startsWith('[Failed]') ? 'failed' : 'completed',
        isReply: true,
      });
    } else {
      // This is an original task — show it as the first message
      msgs.push({
        id: task.id,
        senderId: task.createdBy,
        content: `**${task.title}**\n\n${task.description}`,
        timestamp: task.completedAt ?? task.id,
      });

      // If it has a result, show the executor's response
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

      // Also look for a separate reply task
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

  // Determine the counterpart for the header
  const counterpartId = task.createdBy === agentId ? task.assignedTo : task.createdBy;
  const counterpart = counterpartId ? agents[counterpartId] : null;
  const self = agents[agentId];

  return (
    <div className="flex flex-col h-full -m-4">
      {/* Header with back button */}
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const sender = agents[msg.senderId];
          const isSelf = msg.senderId === agentId;
          return (
            <div key={msg.id} className="flex gap-3">
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
                style={{ backgroundColor: sender?.color ?? (isSelf ? self?.color : '#6b7280') ?? '#6b7280' }}
              >
                {(sender?.name ?? (isSelf ? self?.name : '?') ?? '?').charAt(0).toUpperCase()}
              </div>

              {/* Content */}
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

        {/* Status footer for pending/running tasks */}
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
