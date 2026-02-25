import React from 'react';
import jamLogo from '@/assets/jam-logo.png';

export interface HeaderBarProps {
  agents: Array<{ id: string; name: string; color: string; visualState: string }>;
  voiceState: 'idle' | 'capturing' | 'processing' | 'speaking';
  notificationCount: number;
  notificationOpen: boolean;
  logsOpen: boolean;
  onToggleNotifications: () => void;
  onToggleLogs: () => void;
}

const voiceColors: Record<string, string> = {
  idle: 'text-zinc-600',
  capturing: 'text-red-400',
  processing: 'text-amber-400',
  speaking: 'text-green-400',
};

export const HeaderBar: React.FC<HeaderBarProps> = React.memo(({
  agents,
  voiceState,
  notificationCount,
  notificationOpen,
  logsOpen,
  onToggleNotifications,
  onToggleLogs,
}) => {
  return (
    <div className="titlebar-drag h-[38px] flex items-center justify-between px-4 bg-surface-raised border-b border-zinc-800 shrink-0">
      {/* Left: macOS traffic lights spacer + logo */}
      <div className="flex items-center gap-2">
        <div className="w-[70px]" />
        <img src={jamLogo} alt="Jam" className="w-5 h-5 select-none" draggable={false} />
        <span className="text-xs font-semibold text-zinc-400 select-none">Jam</span>
      </div>

      {/* Right: status indicators + controls */}
      <div className="titlebar-no-drag flex items-center gap-1">
        {/* Agent status dots */}
        {agents.length > 0 && (
          <div className="flex items-center gap-1 mr-1">
            {agents.map((agent) => {
              const isActive = agent.visualState === 'working' || agent.visualState === 'thinking';
              const isIdle = agent.visualState === 'idle';
              return (
                <span
                  key={agent.id}
                  className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white transition-opacity ${
                    isActive ? 'animate-pulse' : ''
                  } ${isIdle ? 'opacity-40 grayscale' : ''}`}
                  style={{ backgroundColor: agent.color }}
                  title={`${agent.name} — ${agent.visualState}`}
                >
                  {agent.name.charAt(0).toUpperCase()}
                </span>
              );
            })}
          </div>
        )}

        {/* Voice indicator */}
        <div
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${voiceColors[voiceState] ?? voiceColors.idle} ${
            voiceState === 'capturing' ? 'animate-pulse' : ''
          }`}
          title={`Voice: ${voiceState}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>

        {/* Notifications bell */}
        <button
          onClick={onToggleNotifications}
          className={`w-6 h-6 flex items-center justify-center rounded relative transition-colors ${
            notificationOpen
              ? 'text-amber-400 bg-amber-500/10'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
          }`}
          title="Notifications"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {notificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white leading-none">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </button>

        {/* Logs toggle */}
        <button
          onClick={onToggleLogs}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            logsOpen
              ? 'text-blue-400 bg-blue-500/10'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
          }`}
          title={logsOpen ? 'Close logs' : 'Open logs'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-zinc-700 mx-1" />

        {/* Window controls */}
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
});
HeaderBar.displayName = 'HeaderBar';
