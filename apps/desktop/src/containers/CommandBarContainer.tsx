import React, { useState } from 'react';
import { useVoice } from '@/hooks/useVoice';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { MicButton } from '@/components/voice/MicButton';
import { Waveform } from '@/components/voice/Waveform';
import { TranscriptOverlay } from '@/components/voice/TranscriptOverlay';

export const CommandBarContainer: React.FC = () => {
  const {
    voiceState,
    voiceMode,
    transcript,
    isRecording,
    isListening,
    audioLevel,
    setVoiceMode,
    startCapture,
    stopCapture,
    toggleListening,
  } = useVoice();
  const { sendTextCommand } = useOrchestrator();
  const [textInput, setTextInput] = useState('');

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendTextCommand(textInput.trim());
      setTextInput('');
    }
  };

  const isPTT = voiceMode === 'push-to-talk';
  const isVoiceActive = isRecording || isListening;

  const placeholder = isRecording
    ? 'Recording...'
    : isListening
      ? 'Listening for voice...'
      : isPTT
        ? 'Type a command or hold mic to talk...'
        : 'Type a command or click mic to listen...';

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-4 py-3 shrink-0">
      <TranscriptOverlay
        text={transcript?.text ?? null}
        isFinal={transcript?.isFinal ?? false}
      />

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

        <Waveform isActive={isVoiceActive} audioLevel={audioLevel} />

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
