import { useState } from 'react';
import { TeamOverviewContainer } from './TeamOverviewContainer';
import { TaskBoardContainer } from './TaskBoardContainer';
import { CommunicationsContainer } from './CommunicationsContainer';
import { AgentDetailContainer } from './AgentDetailContainer';

type DashboardTab = 'overview' | 'tasks' | 'comms' | 'agent';

export function DashboardContainer() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setActiveTab('agent');
  };

  const tabs: Array<{ id: DashboardTab; label: string }> = [
    { id: 'overview', label: 'Team Overview' },
    { id: 'tasks', label: 'Task Board' },
    { id: 'comms', label: 'Communications' },
    { id: 'agent', label: 'Agent Detail' },
  ];

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
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && (
          <TeamOverviewContainer onSelectAgent={handleSelectAgent} />
        )}
        {activeTab === 'tasks' && <TaskBoardContainer />}
        {activeTab === 'comms' && <CommunicationsContainer />}
        {activeTab === 'agent' && selectedAgentId && (
          <AgentDetailContainer agentId={selectedAgentId} />
        )}
        {activeTab === 'agent' && !selectedAgentId && (
          <div className="flex items-center justify-center h-full text-zinc-500">
            Select an agent from Team Overview to view details
          </div>
        )}
      </div>
    </div>
  );
}
