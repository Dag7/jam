import React, { useState } from 'react';
import { useVoice } from '@/hooks/useVoice';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { useAppStore } from '@/store';
import { MicButton } from '@/components/voice/MicButton';
import { Waveform } from '@/components/voice/Waveform';
import { TranscriptOverlay } from '@/components/voice/TranscriptOverlay';

// Named selector — returns primitive (string|null) so Zustand's Object.is comparison
// prevents re-renders when the value hasn't changed.
const selectWorkingAgentId = (s: ReturnType<typeof useAppStore.getState>): string | null => {
  if (s.processingAgentId) return s.processingAgentId;
  const agents = s.agents;
  for (const id in agents) {
    if (agents[id].visualState === 'thinking') return id;
  }
  return null;
};

export const CommandBarContainer: React.FC = () => {
  const {
    voiceState,
    voiceMode,
    transcript,
    isRecording,
    isListening,
    audioLevelRef,
    micError,
    setVoiceMode,
    startCapture,
    stopCapture,
    toggleListening,
  } = useVoice();
  const { sendTextCommand, interruptAgent, clearChat } = useOrchestrator();
  const isProcessing = useAppStore((s) => s.isProcessing);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const [textInput, setTextInput] = useState('');

  const workingAgentId = useAppStore(selectWorkingAgentId);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendTextCommand(textInput.trim());
      setTextInput('');
    }
  };

  const handleInterrupt = () => {
    if (workingAgentId) {
      interruptAgent(workingAgentId);
    }
  };

  const isPTT = voiceMode === 'push-to-talk';
  const isVoiceActive = isRecording || isListening;

  const isBusy = isProcessing || !!workingAgentId;

  const placeholder = isRecording
    ? 'Recording...'
    : isListening
      ? 'Listening for voice...'
      : isBusy
        ? 'Type another command (will queue)...'
        : isPTT
          ? 'Type a command or hold mic to talk...'
          : 'Type a command or click mic to listen...';

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-4 py-3 shrink-0">
      <TranscriptOverlay
        text={transcript?.text ?? null}
        isFinal={transcript?.isFinal ?? false}
      />

      {micError && (
        <div className="mb-2 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-xs text-red-300">
          {micError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <MicButton
          voiceMode={voiceMode}
          isRecording={isRecording}
          isListening={isListening}
          isProcessing={voiceState === 'processing'}
          onPressStart={startCapture}
          onPressEnd={stopCapture}
          onToggleListening={toggleListening}
        />

        <Waveform isActive={isVoiceActive} audioLevelRef={audioLevelRef} />

        <form onSubmit={handleTextSubmit} className="flex-1">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={placeholder}
            disabled={isRecording}
            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
        </form>

        {/* Cancel/interrupt button — shown when any agent is working */}
        {workingAgentId && (
          <button
            onClick={handleInterrupt}
            className="px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 border border-red-800/50"
            title="Cancel current task"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        )}

        {/* Clear chat */}
        <button
          onClick={clearChat}
          className="px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
          title="Clear conversation"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>

        {/* View mode toggle: chat → stage → compact → chat */}
        <button
          onClick={() => {
            const next = viewMode === 'chat' ? 'stage' : viewMode === 'stage' ? 'compact' : 'chat';
            setViewMode(next);
          }}
          className={`
            px-3 py-2 rounded-lg text-xs font-medium transition-colors
            ${viewMode === 'stage'
              ? 'bg-purple-900/30 text-purple-300 hover:bg-purple-900/50'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
            }
          `}
          title={
            viewMode === 'chat' ? 'Switch to stage view'
              : viewMode === 'stage' ? 'Switch to compact view'
              : 'Switch to chat view'
          }
        >
          {viewMode === 'chat' ? (
            /* Grid icon — switch to stage */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          ) : viewMode === 'stage' ? (
            /* Minimize icon — switch to compact */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            /* Chat icon — switch to chat */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
        </button>

        {/* Voice mode toggle */}
        <button
          onClick={() => {
            if (isListening) toggleListening();
            setVoiceMode(isPTT ? 'always-listening' : 'push-to-talk');
          }}
          disabled={isRecording}
          className={`
            px-3 py-2 rounded-lg text-xs font-medium transition-colors
            ${isPTT
              ? 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
              : 'bg-blue-900/30 text-blue-300 hover:bg-blue-900/50'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
          title={isPTT ? 'Switch to always-listening mode' : 'Switch to push-to-talk mode'}
        >
          {isPTT ? 'PTT' : 'VAD'}
        </button>
      </div>
    </div>
  );
};
