import { useState } from 'react';
import { useAppStore } from '@/store';
import { TeamOverviewContainer } from './TeamOverviewContainer';
import { TaskBoardContainer } from './TaskBoardContainer';
import { CommunicationsContainer } from './CommunicationsContainer';
import { AgentDetailContainer } from './AgentDetailContainer';
import { ScheduleList } from '@/components/dashboard/ScheduleList';
import { ImprovementList } from '@/components/dashboard/ImprovementList';

type DashboardTab = 'overview' | 'tasks' | 'comms' | 'schedules' | 'code' | 'agent';

export function DashboardContainer() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const agents = useAppStore((s) => s.agents);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setActiveTab('agent');
  };

  const tabs: Array<{ id: DashboardTab; label: string }> = [
    { id: 'overview', label: 'Team Overview' },
    { id: 'tasks', label: 'Task Board' },
    { id: 'comms', label: 'Communications' },
    { id: 'schedules', label: 'Schedules' },
    { id: 'code', label: 'Code' },
    { id: 'agent', label: 'Agent Detail' },
  ];

  // Sorted agent list for the sidebar (non-system agents first, then system)
  const agentList = Object.values(agents).sort((a, b) => {
    if (a.profile.isSystem && !b.profile.isSystem) return 1;
    if (!a.profile.isSystem && b.profile.isSystem) return -1;
    return a.profile.name.localeCompare(b.profile.name);
  });

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800 bg-zinc-900/80">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab !== 'agent' && (
          <div className="h-full overflow-y-auto p-4">
            {activeTab === 'overview' && (
              <TeamOverviewContainer onSelectAgent={handleSelectAgent} />
            )}
            {activeTab === 'tasks' && <TaskBoardContainer />}
            {activeTab === 'comms' && <CommunicationsContainer />}
            {activeTab === 'schedules' && <ScheduleList />}
            {activeTab === 'code' && <ImprovementList />}
          </div>
        )}

        {activeTab === 'agent' && (
          <div className="flex h-full">
            {/* Agent sidebar */}
            <div className="w-48 shrink-0 border-r border-zinc-800 overflow-y-auto">
              <div className="p-2 space-y-0.5">
                {agentList.map((a) => {
                  const isSelected = a.profile.id === selectedAgentId;
                  const isRunning = a.status === 'running';
                  return (
                    <button
                      key={a.profile.id}
                      onClick={() => setSelectedAgentId(a.profile.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
                        isSelected
                          ? 'bg-zinc-700 text-white'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ backgroundColor: a.profile.color }}
                      >
                        {a.profile.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{a.profile.name}</div>
                        <div className={`text-[10px] ${isRunning ? 'text-green-400' : 'text-zinc-500'}`}>
                          {a.status}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Agent detail */}
            <div className="flex-1 overflow-y-auto">
              {selectedAgentId ? (
                <AgentDetailContainer agentId={selectedAgentId} />
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-500">
                  Select an agent
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
