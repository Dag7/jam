import React from 'react';
import { LogsContainer } from '@/containers/LogsContainer';

interface LogsDrawerProps {
  onClose: () => void;
}

export const LogsDrawer: React.FC<LogsDrawerProps> = ({ onClose }) => {
  return (
    <div className="w-[480px] shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>

        <span className="text-sm font-medium text-zinc-200 flex-1">System Logs</span>

        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Close logs"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Log content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <LogsContainer />
      </div>
    </div>
  );
};
