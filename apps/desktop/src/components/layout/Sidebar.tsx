import React from 'react';

export type SidebarTab = 'agents' | 'dashboard' | 'settings' | 'logs';

interface SidebarProps {
  collapsed: boolean;
  activeTab: SidebarTab;
  onToggle: () => void;
  onTabChange: (tab: SidebarTab) => void;
  children: React.ReactNode;
}

const TABS: Array<{ id: SidebarTab; label: string; icon: React.ReactNode }> = [
  {
    id: 'agents',
    label: 'Agents',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  activeTab,
  onToggle,
  onTabChange,
  children,
}) => {
  return (
    <aside
      className={`
        shrink-0 border-r border-zinc-800 bg-surface-raised
        transition-[width] duration-200 ease-out flex flex-col overflow-hidden
        ${collapsed ? 'w-12' : 'w-[280px]'}
      `}
    >
      {/* Tab navigation */}
      <div className={`flex border-b border-zinc-800 shrink-0 ${collapsed ? 'flex-col' : 'flex-row'}`}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex items-center justify-center gap-2 transition-colors
              ${collapsed ? 'w-full h-10' : 'flex-1 h-9'}
              ${activeTab === tab.id
                ? 'text-zinc-100 bg-zinc-800/60'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
              }
            `}
            title={tab.label}
          >
            {tab.icon}
            {!collapsed && (
              <span className="text-xs font-medium">{tab.label}</span>
            )}
          </button>
        ))}
      </div>

      {/* Panel content */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">{children}</div>
      )}

      {/* Collapse toggle at bottom */}
      <div className={`shrink-0 border-t border-zinc-800 ${collapsed ? 'p-1' : 'p-2'}`}>
        <button
          onClick={onToggle}
          className={`
            flex items-center justify-center rounded
            hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors
            ${collapsed ? 'w-full h-8' : 'w-full h-7 gap-2'}
          `}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}
          >
            <path d="M9 3L5 7L9 11" />
          </svg>
          {!collapsed && (
            <span className="text-xs">Collapse</span>
          )}
        </button>
      </div>
    </aside>
  );
};
