import { useState } from 'react';
import { SoulView } from '@/components/dashboard/SoulView';
import { ActivityHeatmap } from '@/components/charts/ActivityHeatmap';
import { AgentTaskList, StatBlock } from '@/components/dashboard/AgentTaskList';
import { AgentActivityList } from '@/components/dashboard/AgentActivityList';
import { AgentServicesList } from '@/components/dashboard/AgentServicesList';
import { AgentRelationships } from '@/components/dashboard/AgentRelationships';
import { AgentInbox } from '@/components/dashboard/AgentInbox';

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
  agent: { id: string; name: string; color: string; avatarUrl?: string };
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
  activityHeatmap?: Record<string, number>;
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
  activityHeatmap,
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
        {agent.avatarUrl ? (
          <img
            src={agent.avatarUrl.startsWith('/') ? `jam-local://${agent.avatarUrl}` : agent.avatarUrl}
            alt={agent.name}
            className="w-10 h-10 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white"
            style={{ backgroundColor: agent.color }}
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>
        )}
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
              <>
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
                {activityHeatmap && Object.keys(activityHeatmap).length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-zinc-500 mb-2">Task Activity (12 weeks)</div>
                    <ActivityHeatmap data={activityHeatmap} color={agent.color} />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-500 italic">No stats available.</p>
            )}
          </div>
        )}

        {activeTab === 'Tasks' && (
          <AgentTaskList tasks={tasks} onCancelTask={onCancelTask} />
        )}

        {activeTab === 'Inbox' && (
          <AgentInbox tasks={tasks} agentId={agent.id} agents={agents} />
        )}

        {activeTab === 'Activity' && (
          <AgentActivityList activity={activity} agents={agents} />
        )}

        {activeTab === 'Services' && (
          <AgentServicesList
            services={services}
            onStopService={onStopService}
            onRestartService={onRestartService}
            onOpenService={onOpenService}
          />
        )}

        {activeTab === 'Relationships' && (
          <AgentRelationships
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
