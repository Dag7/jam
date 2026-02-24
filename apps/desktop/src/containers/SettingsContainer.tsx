import React, { useState, useEffect } from 'react';
import { SecretsManager } from '@/components/settings/SecretsManager';
import {
  type STTProvider,
  type TTSProvider,
  type VoiceSensitivity,
  STT_MODELS,
  TTS_VOICES,
  AGENT_MODELS,
  VOICE_PROVIDERS,
} from '@/constants/provider-catalog';

interface ModelTierConfig {
  creative: string;
  analytical: string;
  routine: string;
}

interface Config {
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  sttModel: string;
  ttsVoice: string;
  ttsSpeed: number;
  defaultModel: string;
  defaultRuntime: string;
  voiceSensitivity: VoiceSensitivity;
  minRecordingMs: number;
  noSpeechThreshold: number;
  noiseBlocklist: string[];
  modelTiers: ModelTierConfig;
  teamRuntime: string;
}

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
    ttsSpeed: 1.25,
    defaultModel: 'claude-opus-4-6',
    defaultRuntime: 'claude-code',
    modelTiers: { creative: 'claude-opus-4-6', analytical: 'sonnet', routine: 'haiku' },
    teamRuntime: 'claude-code',
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
  const [runtimeOptions, setRuntimeOptions] = useState<Array<{ id: string; displayName: string }>>([]);

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
    window.jam.runtimes.listMetadata().then((meta) => {
      setRuntimeOptions(meta.map((r) => ({ id: r.id, displayName: r.displayName })));
    });
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

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="Back"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>
          </div>
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
                {VOICE_PROVIDERS.map((p) => (
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
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Speech Speed <span className="text-zinc-600">({Math.round(config.ttsSpeed * 100)}%)</span>
              </label>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.05}
                value={config.ttsSpeed}
                onChange={(e) => setConfig({ ...config, ttsSpeed: Number(e.target.value) })}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
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

        {/* Secrets Vault */}
        <SecretsManager />

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
                {runtimeOptions.map((r) => (
                  <option key={r.id} value={r.id}>{r.displayName}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
        {/* Model Tiers */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Model Tiers
          </h3>
          <p className="text-xs text-zinc-500 mb-3">
            Configure which models handle different team operations. Creative ops (soul evolution, code improvement) use the best model. Routine ops (summarization, parsing) use the cheapest.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Creative Tier (soul evolution, code improvement)</label>
              <ComboSelect
                value={config.modelTiers.creative}
                options={AGENT_MODELS}
                onChange={(val) => setConfig({ ...config, modelTiers: { ...config.modelTiers, creative: val } })}
                placeholder="Model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Analytical Tier (reflection, task analysis)</label>
              <ComboSelect
                value={config.modelTiers.analytical}
                options={AGENT_MODELS}
                onChange={(val) => setConfig({ ...config, modelTiers: { ...config.modelTiers, analytical: val } })}
                placeholder="Model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Routine Tier (summarization, parsing)</label>
              <ComboSelect
                value={config.modelTiers.routine}
                options={AGENT_MODELS}
                onChange={(val) => setConfig({ ...config, modelTiers: { ...config.modelTiers, routine: val } })}
                placeholder="Model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Team Runtime</label>
              <select
                value={config.teamRuntime}
                onChange={(e) => setConfig({ ...config, teamRuntime: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                {runtimeOptions.map((r) => (
                  <option key={r.id} value={r.id}>{r.displayName}</option>
                ))}
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

          {/* Save button */}
          <div className="pt-2 pb-4 space-y-2">
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
      </div>
    </div>
  );
};
