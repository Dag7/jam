import React from 'react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggle,
  children,
}) => {
  return (
    <aside
      className={`
        shrink-0 border-r border-zinc-800 bg-surface-raised
        transition-[width] duration-200 ease-out flex flex-col
        ${collapsed ? 'w-14' : 'w-[280px]'}
      `}
    >
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        {!collapsed && (
          <span className="text-sm font-semibold text-zinc-300">Agents</span>
        )}
        <button
          onClick={onToggle}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
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
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">{children}</div>
    </aside>
  );
};
