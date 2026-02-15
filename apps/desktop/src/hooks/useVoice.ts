import { useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store';

export function useVoice() {
  const voiceState = useAppStore((s) => s.voiceState);
  const transcript = useAppStore((s) => s.currentTranscript);
  const voiceMode = useAppStore((s) => s.settings.voiceMode);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const setVoiceState = useAppStore((s) => s.setVoiceState);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startCapture = useCallback(async () => {
    if (!selectedAgentId) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        window.jam.voice.sendAudioChunk(selectedAgentId, arrayBuffer);

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
        setVoiceState('processing');
      };

      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setVoiceState('capturing');
    } catch (error) {
      console.error('Failed to start audio capture:', error);
    }
  }, [selectedAgentId, setVoiceState]);

  const stopCapture = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
  }, []);

  return {
    voiceState,
    transcript,
    voiceMode,
    isRecording,
    startCapture,
    stopCapture,
  };
}
