import React from 'react';

export const TitleBar: React.FC = () => {
  return (
    <div className="titlebar-drag h-[38px] flex items-center justify-between px-4 bg-surface-raised border-b border-zinc-800 shrink-0">
      {/* macOS traffic lights occupy the left side */}
      <div className="w-[70px]" />

      <span className="text-xs font-medium text-zinc-500 select-none">
        Jam
      </span>

      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={() => window.jam.window.minimize()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={() => window.jam.window.maximize()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Maximize"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="0.5" y="0.5" width="8" height="8" rx="1" />
          </svg>
        </button>
        <button
          onClick={() => window.jam.window.close()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-600 text-zinc-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
};
