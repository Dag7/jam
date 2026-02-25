import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '@/store';

// Fallback constants — overridden by config from main process
const DEFAULT_VAD_THRESHOLD = 0.03;
const DEFAULT_MIN_RECORDING_MS = 600;
const SILENCE_TIMEOUT_MS = 4000; // Stop recording after 4s of sustained silence
const VAD_CHECK_INTERVAL_MS = 50; // Check audio level every 50ms
const SILENCE_DEBOUNCE_COUNT = 6; // Require 6 consecutive silent checks (300ms) before starting countdown

export function useVoice() {
  const voiceState = useAppStore((s) => s.voiceState);
  const transcript = useAppStore((s) => s.currentTranscript);
  const voiceMode = useAppStore((s) => s.voiceMode);
  const setVoiceState = useAppStore((s) => s.setVoiceState);
  const setVoiceMode = useAppStore((s) => s.setVoiceMode);

  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const audioLevelRef = useRef(0);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const silentChecksRef = useRef(0);
  const isRecordingRef = useRef(false);
  const recordingStartRef = useRef<number>(0);

  // Configurable filter settings from main process
  const vadThresholdRef = useRef(DEFAULT_VAD_THRESHOLD);
  const minRecordingMsRef = useRef(DEFAULT_MIN_RECORDING_MS);

  // Load filter settings from main process on mount
  useEffect(() => {
    window.jam.voice.getFilterSettings().then((settings) => {
      vadThresholdRef.current = settings.vadThreshold;
      minRecordingMsRef.current = settings.minRecordingMs;
    }).catch(() => {
      // Use defaults if IPC fails
    });
  }, []);

  // Get audio RMS level from analyser
  const getAudioLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;

    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }, []);

  // Start recording (captures audio chunks)
  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || isRecordingRef.current) return;

    // Interrupt any playing TTS — user is speaking, agent should stop
    window.dispatchEvent(new Event('jam:interrupt-tts'));

    chunksRef.current = [];
    recordingStartRef.current = Date.now();

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      if (chunksRef.current.length === 0) return;

      // Minimum recording duration filter — discard noise blips
      const duration = Date.now() - recordingStartRef.current;
      if (duration < minRecordingMsRef.current) {
        return; // Too short, likely noise
      }

      // Routing is name-based in main process — no need for selectedAgentId
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      window.jam.voice.sendAudioChunk('_voice', arrayBuffer);
      setVoiceState('processing');
    };

    mediaRecorder.start(100);
    mediaRecorderRef.current = mediaRecorder;
    isRecordingRef.current = true;
    setIsRecording(true);
    setVoiceState('capturing');
  }, [setVoiceState]);

  // Stop recording and send audio
  const endRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
  }, []);

  // Acquire mic stream and set up audio analysis
  const acquireMicStream = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current) return streamRef.current;

    // Check OS-level mic permission first (macOS)
    try {
      const perm = await window.jam.voice.checkMicPermission();
      if (!perm.granted) {
        const msg = perm.status === 'denied'
          ? 'Microphone access denied. Open System Settings → Privacy & Security → Microphone and enable Jam.'
          : 'Microphone permission not granted. Please allow microphone access when prompted.';
        setMicError(msg);
        throw new Error(msg);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Microphone')) throw err;
      // IPC call failed — continue and let getUserMedia handle it
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    });

    setMicError(null);

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    streamRef.current = stream;
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    return stream;
  }, []);

  // Release mic stream and cleanup
  const releaseMicStream = useCallback(() => {
    if (vadIntervalRef.current !== null) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    endRecording();

    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    audioLevelRef.current = 0;
  }, [endRecording]);

  // --- Push-to-Talk ---
  const startCapture = useCallback(async () => {

    try {
      await acquireMicStream();
      beginRecording();

      // Poll audio level for waveform visualization during PTT
      vadIntervalRef.current = window.setInterval(() => {
        audioLevelRef.current = getAudioLevel();
      }, VAD_CHECK_INTERVAL_MS);
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      setMicError(error instanceof Error ? error.message : 'Failed to access microphone');
    }
  }, [acquireMicStream, beginRecording, getAudioLevel]);

  const stopCapture = useCallback(() => {
    if (vadIntervalRef.current !== null) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    endRecording();
    // In PTT mode, release the stream when done
    if (voiceMode === 'push-to-talk') {
      releaseMicStream();
    }
  }, [endRecording, releaseMicStream, voiceMode]);

  // --- Always-Listening (VAD) ---
  const startListening = useCallback(async () => {

    try {
      await acquireMicStream();
      setIsListening(true);
      setVoiceState('idle');

      // Start VAD polling
      vadIntervalRef.current = window.setInterval(() => {
        const level = getAudioLevel();
        audioLevelRef.current = level;

        if (level > vadThresholdRef.current) {
          // Voice detected — start recording if not already
          if (!isRecordingRef.current) {
            beginRecording();
          }
          // Reset silence tracking
          silentChecksRef.current = 0;
          if (silenceTimerRef.current !== null) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (isRecordingRef.current) {
          // Below threshold while recording — require sustained silence before countdown
          silentChecksRef.current++;
          if (silentChecksRef.current >= SILENCE_DEBOUNCE_COUNT && silenceTimerRef.current === null) {
            silenceTimerRef.current = window.setTimeout(() => {
              endRecording();
              silenceTimerRef.current = null;
              silentChecksRef.current = 0;
            }, SILENCE_TIMEOUT_MS);
          }
        }
      }, VAD_CHECK_INTERVAL_MS);
    } catch (error) {
      console.error('Failed to start always-listening mode:', error);
      setMicError(error instanceof Error ? error.message : 'Failed to access microphone');
    }
  }, [acquireMicStream, setVoiceState, getAudioLevel, beginRecording, endRecording]);

  const stopListening = useCallback(() => {
    setIsListening(false);
    releaseMicStream();
    setVoiceState('idle');
  }, [releaseMicStream, setVoiceState]);

  // Toggle listening for always-listening mode
  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Reload filter settings when config changes (triggered after Settings save)
  const reloadFilterSettings = useCallback(() => {
    window.jam.voice.getFilterSettings().then((settings) => {
      vadThresholdRef.current = settings.vadThreshold;
      minRecordingMsRef.current = settings.minRecordingMs;
    }).catch(() => {});
  }, []);

  // Cleanup on unmount or agent change
  useEffect(() => {
    return () => {
      releaseMicStream();
    };
  }, [releaseMicStream]);

  // Voice no longer depends on agent selection — routing is name-based

  return {
    voiceState,
    voiceMode,
    transcript,
    isRecording,
    isListening,
    audioLevelRef,
    micError,
    setVoiceMode,
    // Push-to-talk
    startCapture,
    stopCapture,
    // Always-listening
    toggleListening,
    // Settings
    reloadFilterSettings,
  };
}
