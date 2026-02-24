import { useState, useEffect } from 'react';
import { SoulView } from '@/components/dashboard/SoulView';

interface ServiceEntry {
  pid: number;
  port?: number;
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
  } | null;
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    totalTokensIn: number;
    totalTokensOut: number;
    averageResponseMs: number;
    streaks: { current: number; best: number };
  } | null;
  tasks: Array<{ id: string; title: string; status: string; priority: string; startedAt?: string }>;
  services: ServiceEntry[];

  relationships: Array<{
    targetAgentId: string;
    trustScore: number;
    interactionCount: number;
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
  onStopService: (pid: number) => void;
  onRestartService: (serviceName: string) => void;
  onOpenService: (port: number) => void;
  isReflecting?: boolean;
}

const tabs = ['Soul', 'Stats', 'Tasks', 'Activity', 'Services', 'Relationships'] as const;
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
                  key={`${svc.name}-${svc.pid}`}
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
                      {isAlive && (
                        <button
                          onClick={() => onStopService(svc.pid)}
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
                    <span>PID {svc.pid}</span>
                    {svc.logFile && <span>{svc.logFile}</span>}
                    <span>{new Date(svc.startedAt).toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'Relationships' && (
          <div className="space-y-2">
            {relationships.length === 0 && (
              <p className="text-sm text-zinc-500 italic">No relationships yet.</p>
            )}
            {relationships.map((rel) => {
              const target = agents[rel.targetAgentId];
              return (
                <div
                  key={rel.targetAgentId}
                  className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 flex items-center gap-3"
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
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm font-semibold ${
                        rel.trustScore > 0.7
                          ? 'text-green-400'
                          : rel.trustScore >= 0.4
                            ? 'text-yellow-400'
                            : 'text-red-400'
                      }`}
                    >
                      {Math.round(rel.trustScore * 100)}%
                    </div>
                    <div className="text-xs text-zinc-500">Trust</div>
                  </div>
                </div>
              );
            })}
          </div>
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
