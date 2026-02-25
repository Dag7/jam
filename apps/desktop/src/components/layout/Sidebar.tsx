import React from 'react';
import { ServicePanel } from '@/components/ServiceBar';

export type NavTab = 'chat' | 'agents' | 'dashboard' | 'settings';

interface IconRailProps {
  expanded: boolean;
  activeTab: NavTab;
  onToggleExpanded: () => void;
  onTabChange: (tab: NavTab) => void;
}

const TABS: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
  {
    id: 'chat',
    label: 'Chat',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

export const IconRail: React.FC<IconRailProps> = React.memo(({
  expanded,
  activeTab,
  onToggleExpanded,
  onTabChange,
}) => {
  return (
    <aside
      style={{ width: expanded ? 208 : 48 }}
      className="shrink-0 border-r border-zinc-800 bg-surface-raised flex flex-col overflow-hidden"
    >
      {/* Hamburger toggle at top */}
      <div className="shrink-0 p-1.5">
        <button
          onClick={onToggleExpanded}
          className={`
            flex items-center rounded-lg
            hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors
            ${expanded ? 'w-full px-3 py-2.5 gap-3' : 'justify-center w-full py-2.5'}
          `}
          aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          {expanded && <span className="text-xs font-medium">Menu</span>}
        </button>
      </div>

      {/* Tab navigation */}
      <nav className="flex flex-col gap-1 px-1.5">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-3 rounded-lg transition-colors relative
                ${expanded ? 'px-3 py-2.5' : 'justify-center py-2.5'}
                ${isActive
                  ? 'text-zinc-100 bg-zinc-800/60'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                }
              `}
              title={expanded ? undefined : tab.label}
            >
              {/* Active indicator */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r" />
              )}
              <span className="shrink-0">{tab.icon}</span>
              {expanded && <span className="text-xs font-medium whitespace-nowrap">{tab.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Services panel — always mounted, hidden via opacity+height when collapsed */}
      <div
        className={`transition-none ${
          expanded ? 'opacity-100 flex-1 min-h-0' : 'opacity-0 h-0 overflow-hidden pointer-events-none'
        }`}
      >
        <ServicePanel />
      </div>
    </aside>
  );
});
IconRail.displayName = 'IconRail';
