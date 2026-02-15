import React, { useState } from 'react';
import { useVoice } from '@/hooks/useVoice';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { MicButton } from '@/components/voice/MicButton';
import { Waveform } from '@/components/voice/Waveform';
import { TranscriptOverlay } from '@/components/voice/TranscriptOverlay';

export const CommandBarContainer: React.FC = () => {
  const {
    voiceState,
    transcript,
    isRecording,
    startCapture,
    stopCapture,
  } = useVoice();
  const { sendTextCommand, selectedAgentId } = useOrchestrator();
  const [textInput, setTextInput] = useState('');

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendTextCommand(textInput.trim());
      setTextInput('');
    }
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-4 py-3 shrink-0">
      <TranscriptOverlay
        text={transcript?.text ?? null}
        isFinal={transcript?.isFinal ?? false}
      />

      <div className="flex items-center gap-3">
        <MicButton
          isRecording={isRecording}
          isProcessing={voiceState === 'processing'}
          disabled={!selectedAgentId}
          onPressStart={startCapture}
          onPressEnd={stopCapture}
        />

        <Waveform isActive={isRecording} />

        <form onSubmit={handleTextSubmit} className="flex-1">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              !selectedAgentId
                ? 'Select an agent to start...'
                : isRecording
                  ? 'Listening...'
                  : 'Type a command or hold mic to talk...'
            }
            disabled={!selectedAgentId || isRecording}
            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
        </form>
      </div>
    </div>
  );
};
