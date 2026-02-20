import React, { useState, useEffect } from 'react';

type STTProvider = 'openai' | 'elevenlabs';
type TTSProvider = 'openai' | 'elevenlabs';

type VoiceSensitivity = 'low' | 'medium' | 'high';

interface Config {
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  sttModel: string;
  ttsVoice: string;
  defaultModel: string;
  defaultRuntime: string;
  voiceSensitivity: VoiceSensitivity;
  minRecordingMs: number;
  noSpeechThreshold: number;
  noiseBlocklist: string[];
}

// --- STT models per provider ---
const STT_MODELS: Record<STTProvider, Array<{ id: string; label: string }>> = {
  openai: [
    { id: 'whisper-1', label: 'Whisper v1' },
    { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
    { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe' },
  ],
  elevenlabs: [
    { id: 'scribe_v1', label: 'Scribe v1 (Recommended)' },
    { id: 'scribe_v1_experimental', label: 'Scribe v1 Experimental' },
  ],
};

// --- TTS voices per provider ---
const TTS_VOICES: Record<TTSProvider, Array<{ id: string; label: string }>> = {
  openai: [
    { id: 'alloy', label: 'Alloy' },
    { id: 'ash', label: 'Ash' },
    { id: 'ballad', label: 'Ballad' },
    { id: 'coral', label: 'Coral' },
    { id: 'echo', label: 'Echo' },
    { id: 'fable', label: 'Fable' },
    { id: 'nova', label: 'Nova' },
    { id: 'onyx', label: 'Onyx' },
    { id: 'sage', label: 'Sage' },
    { id: 'shimmer', label: 'Shimmer' },
  ],
  elevenlabs: [
    { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (Deep, Narration)' },
    { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (Soft, Feminine)' },
    { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel (Authoritative, British)' },
    { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi (Strong, Feminine)' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli (Friendly, Young)' },
    { id: 'jsCqWAovK2LkecY7zXl4', label: 'Freya (Expressive, Nordic)' },
    { id: 'oWAxZDx7w5VEj9dCyTzz', label: 'Grace (Southern, Warm)' },
    { id: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum (Intense, Transatlantic)' },
    { id: 'IKne3meq5aSn9XLyUdCD', label: 'Charlie (Natural, Australian)' },
    { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte (Swedish, Seductive)' },
    { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (Calm, American)' },
    { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam (Raspy, American)' },
    { id: 'ThT5KcBeYPX3keUQqHPh', label: 'Dorothy (Pleasant, British)' },
    { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold (Crisp, American)' },
    { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni (Well-rounded)' },
  ],
};

// --- AI agent models ---
const AGENT_MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'o4-mini', label: 'OpenAI o4-mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
];

const PROVIDERS = [
  { id: 'openai' as const, label: 'OpenAI' },
  { id: 'elevenlabs' as const, label: 'ElevenLabs' },
];

// Combobox-style select: dropdown with custom input option
const ComboSelect: React.FC<{
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

export const SettingsContainer: React.FC<{
  onClose: () => void;
  onRerunSetup?: () => void;
}> = ({
  onClose,
  onRerunSetup,
}) => {
  const [config, setConfig] = useState<Config>({
    sttProvider: 'openai',
    ttsProvider: 'openai',
    sttModel: 'whisper-1',
    ttsVoice: 'alloy',
    defaultModel: 'claude-opus-4-6',
    defaultRuntime: 'claude-code',
    voiceSensitivity: 'medium',
    minRecordingMs: 600,
    noSpeechThreshold: 0.6,
    noiseBlocklist: [
      'bye', 'bye bye', 'bye-bye', 'goodbye',
      'thank you', 'thanks', 'thank', 'you',
      'hmm', 'uh', 'um', 'ah', 'oh',
      'okay', 'ok',
    ],
  });
  const [blocklistText, setBlocklistText] = useState('');

  const [openaiKey, setOpenaiKey] = useState('');
  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [hasOpenai, setHasOpenai] = useState(false);
  const [hasElevenlabs, setHasElevenlabs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    window.jam.config.get().then((c) => {
      const loaded = c as unknown as Partial<Config>;
      setConfig((prev) => ({ ...prev, ...loaded }));
      if (Array.isArray(loaded.noiseBlocklist)) {
        setBlocklistText(loaded.noiseBlocklist.join('\n'));
      }
    });
    window.jam.apiKeys.has('openai').then(setHasOpenai);
    window.jam.apiKeys.has('elevenlabs').then(setHasElevenlabs);
  }, []);

  const needsOpenai =
    config.sttProvider === 'openai' || config.ttsProvider === 'openai';
  const needsElevenlabs =
    config.sttProvider === 'elevenlabs' || config.ttsProvider === 'elevenlabs';

  // Reset model/voice to first option when switching providers
  const handleSTTProviderChange = (provider: STTProvider) => {
    const models = STT_MODELS[provider];
    setConfig({
      ...config,
      sttProvider: provider,
      sttModel: models[0]?.id ?? '',
    });
  };

  const handleTTSProviderChange = (provider: TTSProvider) => {
    const voices = TTS_VOICES[provider];
    setConfig({
      ...config,
      ttsProvider: provider,
      ttsVoice: voices[0]?.id ?? '',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);

    try {
      if (openaiKey) {
        await window.jam.apiKeys.set('openai', openaiKey);
        setHasOpenai(true);
        setOpenaiKey('');
      }
      if (elevenlabsKey) {
        await window.jam.apiKeys.set('elevenlabs', elevenlabsKey);
        setHasElevenlabs(true);
        setElevenlabsKey('');
      }

      // Convert blocklist textarea to array before saving
      const configToSave = {
        ...config,
        noiseBlocklist: blocklistText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      await window.jam.config.set(configToSave as unknown as Record<string, unknown>);
      setStatus('Settings saved.');
    } catch (error) {
      setStatus(`Error: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async (service: 'openai' | 'elevenlabs') => {
    await window.jam.apiKeys.delete(service);
    if (service === 'openai') setHasOpenai(false);
    else setHasElevenlabs(false);
    setStatus(`${service} key removed.`);
  };

  // Suppress unused warning - onClose provided for interface consistency
  void onClose;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Voice Providers */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Speech-to-Text
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Provider</label>
              <select
                value={config.sttProvider}
                onChange={(e) => handleSTTProviderChange(e.target.value as STTProvider)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Model</label>
              <ComboSelect
                value={config.sttModel}
                options={STT_MODELS[config.sttProvider]}
                onChange={(val) => setConfig({ ...config, sttModel: val })}
                placeholder="Custom model ID"
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Text-to-Speech
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Provider</label>
              <select
                value={config.ttsProvider}
                onChange={(e) => handleTTSProviderChange(e.target.value as TTSProvider)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Default Voice</label>
              <ComboSelect
                value={config.ttsVoice}
                options={TTS_VOICES[config.ttsProvider]}
                onChange={(val) => setConfig({ ...config, ttsVoice: val })}
                placeholder="Custom voice ID"
              />
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
                    onClick={() => setConfig({ ...config, voiceSensitivity: level })}
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
                Min Recording Duration <span className="text-zinc-600">({config.minRecordingMs}ms)</span>
              </label>
              <input
                type="range"
                min={100}
                max={2000}
                step={100}
                value={config.minRecordingMs}
                onChange={(e) => setConfig({ ...config, minRecordingMs: Number(e.target.value) })}
                className="w-full accent-blue-500"
              />
              <p className="text-xs text-zinc-600">
                Recordings shorter than this are discarded as noise
              </p>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Speech Confidence Threshold <span className="text-zinc-600">({config.noSpeechThreshold.toFixed(1)})</span>
              </label>
              <input
                type="range"
                min={0.1}
                max={0.95}
                step={0.05}
                value={config.noSpeechThreshold}
                onChange={(e) => setConfig({ ...config, noSpeechThreshold: Number(e.target.value) })}
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
                onChange={(e) => setBlocklistText(e.target.value)}
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

        {/* API Keys */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            API Keys
          </h3>
          <p className="text-xs text-zinc-500 mb-3">
            Encrypted locally via safeStorage.
          </p>

          <div className="space-y-4">
            {needsOpenai && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-400">OpenAI</label>
                  {hasOpenai && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-400">configured</span>
                      <button
                        onClick={() => handleDeleteKey('openai')}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        remove
                      </button>
                    </div>
                  )}
                </div>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={hasOpenai ? 'Key saved (enter new to replace)' : 'sk-...'}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            {needsElevenlabs && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-400">ElevenLabs</label>
                  {hasElevenlabs && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-400">configured</span>
                      <button
                        onClick={() => handleDeleteKey('elevenlabs')}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        remove
                      </button>
                    </div>
                  )}
                </div>
                <input
                  type="password"
                  value={elevenlabsKey}
                  onChange={(e) => setElevenlabsKey(e.target.value)}
                  placeholder={hasElevenlabs ? 'Key saved (enter new to replace)' : 'xi-...'}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            {!needsOpenai && !needsElevenlabs && (
              <p className="text-xs text-zinc-500">
                Select a provider above to configure its API key.
              </p>
            )}
          </div>
        </section>

        {/* Agent Defaults */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Agent Defaults
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Default Model</label>
              <ComboSelect
                value={config.defaultModel}
                options={AGENT_MODELS}
                onChange={(val) => setConfig({ ...config, defaultModel: val })}
                placeholder="Custom model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Default Runtime</label>
              <select
                value={config.defaultRuntime}
                onChange={(e) => setConfig({ ...config, defaultRuntime: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                <option value="claude-code">Claude Code</option>
                <option value="opencode">OpenCode</option>
              </select>
            </div>
          </div>
        </section>
        {/* Re-run Setup */}
        {onRerunSetup && (
          <section>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Setup
            </h3>
            <button
              onClick={async () => {
                await window.jam.setup.resetOnboarding();
                onRerunSetup();
              }}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
            >
              Re-run Setup Wizard
            </button>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-zinc-800 space-y-2">
        {status && (
          <p className={`text-xs ${status.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {status}
          </p>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};
