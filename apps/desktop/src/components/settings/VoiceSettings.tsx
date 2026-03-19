import React, { useState } from 'react';
import {
  type STTProvider,
  type TTSProvider,
  type VoiceSensitivity,
  STT_MODELS,
  TTS_VOICES,
  VOICE_PROVIDERS,
} from '@/constants/provider-catalog';

interface VoiceConfig {
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  sttModel: string;
  ttsVoice: string;
  ttsSpeed: number;
  voiceSensitivity: VoiceSensitivity;
  minRecordingMs: number;
  noSpeechThreshold: number;
  voiceEnabled: boolean;
  ttsMaxChars: number;
  ttsPlaybackTimeoutMs: number;
}

interface VoiceSettingsProps {
  config: VoiceConfig;
  blocklistText: string;
  testingVoice: boolean;
  onConfigChange: (updates: Partial<VoiceConfig>) => void;
  onBlocklistChange: (text: string) => void;
  onTestVoice: () => void;
}

export const VoiceSettings: React.FC<VoiceSettingsProps> = ({
  config,
  blocklistText,
  testingVoice,
  onConfigChange,
  onBlocklistChange,
  onTestVoice,
}) => {
  return (
    <>
      {/* Voice Output */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Voice Output
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-zinc-200">Enable Voice</label>
              <p className="text-xs text-zinc-500">When disabled, agents won't speak responses aloud</p>
            </div>
            <button
              type="button"
              onClick={() => onConfigChange({ voiceEnabled: !config.voiceEnabled })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                config.voiceEnabled ? 'bg-blue-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  config.voiceEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Max Characters <span className="text-zinc-500">({config.ttsMaxChars.toLocaleString()})</span>
            </label>
            <input
              type="range"
              min={500}
              max={20000}
              step={500}
              value={config.ttsMaxChars}
              onChange={(e) => onConfigChange({ ttsMaxChars: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <div className="relative h-4 text-[10px] text-zinc-500 mt-0.5">
              <span className="absolute left-0">500</span>
              <span className="absolute" style={{ left: '28.2%' }}>6k</span>
              <span className="absolute" style={{ left: '59%' }}>12k</span>
              <span className="absolute right-0">20k</span>
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Longer responses are truncated before synthesis. Default: 6,000
            </p>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Playback Timeout <span className="text-zinc-500">({Math.round(config.ttsPlaybackTimeoutMs / 1000)}s)</span>
            </label>
            <input
              type="range"
              min={15000}
              max={300000}
              step={5000}
              value={config.ttsPlaybackTimeoutMs}
              onChange={(e) => onConfigChange({ ttsPlaybackTimeoutMs: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <div className="relative h-4 text-[10px] text-zinc-500 mt-0.5">
              <span className="absolute left-0">15s</span>
              <span className="absolute" style={{ left: '15.8%' }}>1m</span>
              <span className="absolute" style={{ left: '36.8%' }}>2m</span>
              <span className="absolute right-0">5m</span>
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Safety timeout — playback is stopped if it exceeds this duration. Default: 2 min
            </p>
          </div>
        </div>
      </section>

      {/* Speech-to-Text */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Speech-to-Text
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Provider</label>
            <select
              value={config.sttProvider}
              onChange={(e) => {
                const provider = e.target.value as STTProvider;
                const models = STT_MODELS[provider];
                onConfigChange({ sttProvider: provider, sttModel: models[0]?.id ?? '' });
              }}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            >
              {VOICE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Model</label>
            <ComboSelect
              value={config.sttModel}
              options={STT_MODELS[config.sttProvider]}
              onChange={(val) => onConfigChange({ sttModel: val })}
              placeholder="Custom model ID"
            />
          </div>
        </div>
      </section>

      {/* Text-to-Speech */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Text-to-Speech
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Provider</label>
            <select
              value={config.ttsProvider}
              onChange={(e) => {
                const provider = e.target.value as TTSProvider;
                const voices = TTS_VOICES[provider];
                onConfigChange({ ttsProvider: provider, ttsVoice: voices[0]?.id ?? '' });
              }}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            >
              {VOICE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Default Voice</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <ComboSelect
                  value={config.ttsVoice}
                  options={TTS_VOICES[config.ttsProvider]}
                  onChange={(val) => onConfigChange({ ttsVoice: val })}
                  placeholder="Custom voice ID"
                />
              </div>
              <button
                type="button"
                onClick={onTestVoice}
                disabled={testingVoice}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded-lg text-sm text-zinc-300 disabled:opacity-50 transition-colors self-start"
                title="Preview voice"
              >
                {testingVoice ? '...' : '\u25B6'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Speech Speed <span className="text-zinc-500">({Math.round(config.ttsSpeed * 100)}%)</span>
            </label>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={config.ttsSpeed}
              onChange={(e) => onConfigChange({ ttsSpeed: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-0.5">
              <span>50%</span>
              <span>100%</span>
              <span>150%</span>
              <span>200%</span>
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Controls how fast agents speak. Default: 125%
            </p>
          </div>
        </div>
      </section>

      {/* Voice Filtering */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Voice Filtering
        </h3>
        <p className="text-xs text-zinc-500 mb-3">
          Reduce false triggers from ambient noise in always-listening mode.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Mic Sensitivity</label>
            <div className="flex gap-1">
              {(['low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => onConfigChange({ voiceSensitivity: level })}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    config.voiceSensitivity === level
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Low = quiet room, Medium = normal, High = noisy environment
            </p>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Min Recording Duration <span className="text-zinc-500">({config.minRecordingMs}ms)</span>
            </label>
            <input
              type="range"
              min={100}
              max={2000}
              step={100}
              value={config.minRecordingMs}
              onChange={(e) => onConfigChange({ minRecordingMs: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <p className="text-xs text-zinc-600">
              Recordings shorter than this are discarded as noise
            </p>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Speech Confidence Threshold <span className="text-zinc-500">({config.noSpeechThreshold.toFixed(1)})</span>
            </label>
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={config.noSpeechThreshold}
              onChange={(e) => onConfigChange({ noSpeechThreshold: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <p className="text-xs text-zinc-600">
              Higher = stricter, rejects more noise (Whisper only)
            </p>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Noise Blocklist</label>
            <textarea
              value={blocklistText}
              onChange={(e) => onBlocklistChange(e.target.value)}
              rows={4}
              placeholder="One phrase per line (e.g., bye bye)"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
            />
            <p className="text-xs text-zinc-600">
              Transcriptions matching these phrases exactly are ignored
            </p>
          </div>
        </div>
      </section>
    </>
  );
};

/** Combobox-style select: dropdown with custom input option */
export const ComboSelect: React.FC<{
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (val: string) => void;
  placeholder?: string;
}> = ({ value, options, onChange, placeholder }) => {
  const isCustom = value !== '' && !options.some((o) => o.id === value);
  const [showCustom, setShowCustom] = useState(isCustom);

  return (
    <div className="space-y-1">
      <select
        value={showCustom ? '__custom__' : value}
        onChange={(e) => {
          if (e.target.value === '__custom__') {
            setShowCustom(true);
            onChange('');
          } else {
            setShowCustom(false);
            onChange(e.target.value);
          }
        }}
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        <option value="__custom__">Custom...</option>
      </select>
      {showCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'Enter custom value'}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          autoFocus
        />
      )}
    </div>
  );
};
