import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/store';

const DEFAULT_PLAYBACK_TIMEOUT_MS = 120_000;

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
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackTimeoutRef = useRef(DEFAULT_PLAYBACK_TIMEOUT_MS);

  // Load configurable playback timeout on mount
  useEffect(() => {
    window.jam.config.get().then((c) => {
      const timeout = (c as { ttsPlaybackTimeoutMs?: number }).ttsPlaybackTimeoutMs;
      if (typeof timeout === 'number' && timeout > 0) {
        playbackTimeoutRef.current = timeout;
      }
    });
  }, []);

  const interruptTTS = useCallback(() => {
    if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
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
  }, []);

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
        if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        audioRef.current = null;
        playNextTTS();
      });

      // Safety timeout: if onended never fires (e.g., after system sleep),
      // force-advance the queue. Timeout is configurable (default 2 min).
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = setTimeout(() => {
        safetyTimerRef.current = null;
        if (playingRef.current && audioRef.current === audio) {
          console.warn('[TTS] Safety timeout — forcing queue advance');
          audio.pause();
          audio.onended = null;
          audio.onerror = null;
          if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
          audioRef.current = null;
          playNextTTS();
        }
      }, playbackTimeoutRef.current);

      audio.onended = () => {
        if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        audioRef.current = null;
        playNextTTS();
      };

      audio.onerror = (err) => {
        console.error('[TTS] Audio error:', err);
        if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
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

  // Stable reference — all state is in refs, so no deps needed.
  // This prevents useIPCSubscriptions from re-subscribing on every render.
  const enqueueTTS = useCallback((audioData: string) => {
    queueRef.current.push(audioData);
    if (!playingRef.current) playNextTTS();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for interrupt signal from useVoice (user started speaking)
  useEffect(() => {
    window.addEventListener('jam:interrupt-tts', interruptTTS);
    return () => {
      window.removeEventListener('jam:interrupt-tts', interruptTTS);
      interruptTTS();
    };
  }, [interruptTTS]);

  return { enqueueTTS, interruptTTS };
}
