import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store';

/**
 * Manages TTS audio playback queue.
 * Prevents agents from talking over each other by playing responses sequentially.
 * Supports interruption via custom 'jam:interrupt-tts' DOM event.
 */
export function useTTSQueue() {
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const interruptTTS = () => {
    queueRef.current.length = 0;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    playingRef.current = false;
    useAppStore.getState().setVoiceState('idle');
    window.jam.voice.notifyTTSState(false);
  };

  const playNextTTS = () => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      audioRef.current = null;
      blobUrlRef.current = null;
      useAppStore.getState().setVoiceState('idle');
      window.jam.voice.notifyTTSState(false);
      return;
    }

    playingRef.current = true;
    const audioData = queueRef.current.shift()!;

    try {
      const match = audioData.match(/^data:([^;]+);base64,(.+)$/);
      let audioSrc: string;

      if (match) {
        const mimeType = match[1];
        const base64Data = match[2];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        blobUrlRef.current = URL.createObjectURL(blob);
        audioSrc = blobUrlRef.current;
      } else {
        blobUrlRef.current = null;
        audioSrc = audioData;
      }

      const audio = new Audio(audioSrc);
      audioRef.current = audio;
      useAppStore.getState().setVoiceState('speaking');
      window.jam.voice.notifyTTSState(true);

      audio.play().catch((err) => {
        console.error('[TTS] Failed to play audio:', err);
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        audioRef.current = null;
        playNextTTS();
      });

      audio.onended = () => {
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        audioRef.current = null;
        playNextTTS();
      };

      audio.onerror = (err) => {
        console.error('[TTS] Audio error:', err);
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        audioRef.current = null;
        playNextTTS();
      };
    } catch (err) {
      console.error('[TTS] Audio setup error:', err);
      audioRef.current = null;
      blobUrlRef.current = null;
      playNextTTS();
    }
  };

  const enqueueTTS = (audioData: string) => {
    queueRef.current.push(audioData);
    if (!playingRef.current) playNextTTS();
  };

  // Listen for interrupt signal from useVoice (user started speaking)
  useEffect(() => {
    window.addEventListener('jam:interrupt-tts', interruptTTS);
    return () => {
      window.removeEventListener('jam:interrupt-tts', interruptTTS);
      interruptTTS();
    };
  }, []);

  return { enqueueTTS, interruptTTS };
}
