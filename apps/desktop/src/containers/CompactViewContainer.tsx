import React, { useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '@/store';
import { useVoice } from '@/hooks/useVoice';
import { AgentStatusBadge } from '@/components/agent/AgentStatusBadge';
import { MicButton } from '@/components/voice/MicButton';
import type { AgentVisualState } from '@/store/agentSlice';

export const CompactViewContainer: React.FC = () => {
  const agentsMap = useAppStore((s) => s.agents);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const {
    voiceMode,
    isRecording,
    isListening,
    audioLevelRef,
    startCapture,
    stopCapture,
    toggleListening,
  } = useVoice();

  const agentList = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const isVoiceActive = isRecording || isListening;
  const audioBarRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Self-animate the tiny audio level bar via rAF — no React re-renders
  useEffect(() => {
    if (!isVoiceActive) return;
    const animate = () => {
      if (audioBarRef.current) {
        const level = audioLevelRef.current ?? 0;
        audioBarRef.current.style.width = `${Math.min(level * 500, 100)}%`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isVoiceActive, audioLevelRef]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 min-h-0 select-none titlebar-drag">
      {/* Agent chips */}
      <div className="flex items-center gap-1.5 flex-1 flex-wrap min-w-0">
        {agentList.map((agent) => (
          <div
            key={agent.profile.id}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/50 shrink-0"
          >
            {/* Color dot with initial */}
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ backgroundColor: `${agent.profile.color}30`, color: agent.profile.color }}
            >
              {agent.profile.name.charAt(0).toUpperCase()}
            </div>
            {/* Name */}
            <span className="text-xs text-zinc-300 font-medium max-w-[80px] truncate">
              {agent.profile.name}
            </span>
            {/* Status badge */}
            <AgentStatusBadge state={agent.visualState as AgentVisualState} />
          </div>
        ))}

        {agentList.length === 0 && (
          <span className="text-xs text-zinc-600">No agents</span>
        )}
      </div>

      {/* Mic indicator */}
      <div className="shrink-0 titlebar-no-drag">
        <MicButton
          voiceMode={voiceMode}
          isRecording={isRecording}
          isListening={isListening}
          isProcessing={false}
          onPressStart={startCapture}
          onPressEnd={stopCapture}
          onToggleListening={toggleListening}
        />
      </div>

      {/* Audio level bar (tiny) */}
      {isVoiceActive && (
        <div className="w-8 h-3 bg-zinc-800 rounded-full overflow-hidden shrink-0">
          <div
            ref={audioBarRef}
            className="h-full bg-green-500/60 rounded-full"
            style={{ width: '0%' }}
          />
        </div>
      )}

      {/* Expand button — back to full view */}
      <button
        onClick={() => setViewMode('chat')}
        className="titlebar-no-drag shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700"
        title="Expand to full view"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>
  );
};
