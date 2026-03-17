import React, { useState, useEffect, useCallback } from 'react';
import { SecretsManager } from '@/components/settings/SecretsManager';
import { VoiceSettings, ComboSelect } from '@/components/settings/VoiceSettings';
import { SandboxSettings } from '@/components/settings/SandboxSettings';
import { BrainSettings } from '@/components/settings/BrainSettings';
import { AboutSection } from '@/components/settings/AboutSection';
import {
  type STTProvider,
  type TTSProvider,
  type VoiceSensitivity,
  TTS_VOICES,
  AGENT_MODELS,
} from '@/constants/provider-catalog';

interface ModelTierConfig {
  creative: string;
  analytical: string;
  routine: string;
}

type ContainerExitBehavior = 'stop' | 'delete' | 'keep-running';
type SandboxTier = 'none' | 'os' | 'docker';

interface OsSandboxSettings {
  enabled: boolean;
  allowedDomains: string[];
  denyRead: string[];
  extraAllowWrite: string[];
  denyWrite: string[];
}

interface WorktreeSettings {
  autoCreate: boolean;
  worktreeDir: string;
}

type AgentExecution = 'host' | 'container';

interface SandboxDockerSettings {
  containerExitBehavior: ContainerExitBehavior;
  computerUseEnabled: boolean;
  computerUseResolution: string;
  agentExecution: AgentExecution;
}

interface BrainConfig {
  enabled: boolean;
  url: string;
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
  sandboxTier: SandboxTier;
  osSandbox: OsSandboxSettings;
  worktree: WorktreeSettings;
  sandbox: SandboxDockerSettings;
  brain: BrainConfig;
}

const DEFAULT_CONFIG: Config = {
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
  sandboxTier: 'os',
  osSandbox: {
    enabled: true,
    allowedDomains: ['api.anthropic.com', 'api.openai.com', 'github.com', 'registry.npmjs.org'],
    denyRead: ['~/.ssh', '~/.gnupg', '~/.aws/credentials'],
    extraAllowWrite: ['/tmp'],
    denyWrite: ['.env', '*.pem', '*.key'],
  },
  worktree: { autoCreate: true, worktreeDir: '.jam-worktrees' },
  sandbox: { containerExitBehavior: 'stop', computerUseEnabled: false, computerUseResolution: '1920x1080', agentExecution: 'container' },
  brain: { enabled: false, url: 'http://localhost:8080' },
};

export const SettingsContainer: React.FC<{
  onClose: () => void;
  onRerunSetup?: () => void;
}> = ({ onClose, onRerunSetup }) => {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [blocklistText, setBlocklistText] = useState('');

  const [openaiKey, setOpenaiKey] = useState('');
  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [hasOpenai, setHasOpenai] = useState(false);
  const [hasElevenlabs, setHasElevenlabs] = useState(false);
  const [brainKey, setBrainKey] = useState('');
  const [hasBrain, setHasBrain] = useState(false);
  const [brainHealth, setBrainHealth] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [runtimeOptions, setRuntimeOptions] = useState<Array<{ id: string; displayName: string }>>([]);
  const [testingVoice, setTestingVoice] = useState(false);

  useEffect(() => {
    window.jam.config.get().then((c) => {
      const loaded = c as unknown as Partial<Config> & { sandbox?: Record<string, unknown> };
      // Map nested computerUse back to flat keys for UI
      const sandboxLoaded = loaded.sandbox ?? {} as typeof loaded.sandbox & { computerUse?: Record<string, unknown> };
      const computerUse = sandboxLoaded.computerUse as { enabled?: boolean; resolution?: string } | undefined;
      const dockerSettings: Partial<SandboxDockerSettings> = {
        containerExitBehavior: sandboxLoaded.containerExitBehavior as ContainerExitBehavior | undefined,
        computerUseEnabled: computerUse?.enabled ?? (sandboxLoaded.computerUseEnabled as boolean | undefined) ?? false,
        computerUseResolution: computerUse?.resolution ?? (sandboxLoaded.computerUseResolution as string | undefined) ?? '1920x1080',
        agentExecution: (sandboxLoaded.agentExecution as AgentExecution | undefined) ?? 'container',
      };
      setConfig((prev) => ({
        ...prev,
        ...loaded,
        osSandbox: { ...prev.osSandbox, ...(loaded.osSandbox as Partial<OsSandboxSettings> | undefined) },
        worktree: { ...prev.worktree, ...(loaded.worktree as Partial<WorktreeSettings> | undefined) },
        sandbox: { ...prev.sandbox, ...dockerSettings },
        brain: { ...prev.brain, ...(loaded.brain as Partial<BrainConfig> | undefined) },
      }));
      if (Array.isArray(loaded.noiseBlocklist)) {
        setBlocklistText(loaded.noiseBlocklist.join('\n'));
      }
    });
    window.jam.apiKeys.has('openai').then(setHasOpenai);
    window.jam.apiKeys.has('elevenlabs').then(setHasElevenlabs);
    window.jam.apiKeys.has('brain').then(setHasBrain);
    window.jam.runtimes.listMetadata().then((meta) => {
      setRuntimeOptions(meta.map((r) => ({ id: r.id, displayName: r.displayName })));
    });
  }, []);

  const needsOpenai = config.sttProvider === 'openai' || config.ttsProvider === 'openai';
  const needsElevenlabs = config.sttProvider === 'elevenlabs' || config.ttsProvider === 'elevenlabs';

  const handleTestVoice = useCallback(async () => {
    setTestingVoice(true);
    try {
      const voiceId = config.ttsVoice || TTS_VOICES[config.ttsProvider][0]?.id || 'alloy';
      const result = await window.jam.voice.testVoice(voiceId);
      if (result.success && result.audioData) {
        const audio = new Audio(result.audioData);
        audio.play();
      }
    } catch { /* ignore */ }
    finally { setTestingVoice(false); }
  }, [config.ttsVoice, config.ttsProvider]);

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
      if (brainKey) {
        await window.jam.apiKeys.set('brain', brainKey);
        setHasBrain(true);
        setBrainKey('');
      }

      // Translate flat UI keys into nested structure the backend expects
      const { computerUseEnabled, computerUseResolution, ...restSandbox } = config.sandbox as SandboxDockerSettings & Record<string, unknown>;
      const configToSave = {
        ...config,
        sandbox: {
          ...restSandbox,
          computerUse: {
            enabled: computerUseEnabled ?? false,
            resolution: computerUseResolution ?? '1920x1080',
            noVncEnabled: true,
          },
        },
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

  const updateConfig = useCallback((updates: Partial<Config>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

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

        {/* Voice: STT, TTS, Filtering */}
        <VoiceSettings
          config={config}
          blocklistText={blocklistText}
          testingVoice={testingVoice}
          onConfigChange={updateConfig}
          onBlocklistChange={setBlocklistText}
          onTestVoice={handleTestVoice}
        />

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
                onChange={(val) => updateConfig({ defaultModel: val })}
                placeholder="Custom model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Default Runtime</label>
              <select
                value={config.defaultRuntime}
                onChange={(e) => updateConfig({ defaultRuntime: e.target.value })}
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
                onChange={(val) => updateConfig({ modelTiers: { ...config.modelTiers, creative: val } })}
                placeholder="Model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Analytical Tier (reflection, task analysis)</label>
              <ComboSelect
                value={config.modelTiers.analytical}
                options={AGENT_MODELS}
                onChange={(val) => updateConfig({ modelTiers: { ...config.modelTiers, analytical: val } })}
                placeholder="Model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Routine Tier (summarization, parsing)</label>
              <ComboSelect
                value={config.modelTiers.routine}
                options={AGENT_MODELS}
                onChange={(val) => updateConfig({ modelTiers: { ...config.modelTiers, routine: val } })}
                placeholder="Model ID"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Team Runtime</label>
              <select
                value={config.teamRuntime}
                onChange={(e) => updateConfig({ teamRuntime: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                {runtimeOptions.map((r) => (
                  <option key={r.id} value={r.id}>{r.displayName}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Kalanu Brain */}
        <BrainSettings
          config={config.brain}
          brainKey={brainKey}
          hasBrainKey={hasBrain}
          brainHealth={brainHealth}
          onConfigChange={(updates) => updateConfig({ brain: { ...config.brain, ...updates } })}
          onBrainKeyChange={setBrainKey}
          onDeleteBrainKey={async () => {
            await window.jam.apiKeys.delete('brain');
            setHasBrain(false);
          }}
          onTestConnection={async () => {
            const result = await window.jam.brain.health();
            setBrainHealth(result.healthy);
          }}
        />

        {/* Sandbox & Isolation */}
        <SandboxSettings
          sandboxTier={config.sandboxTier}
          osSandbox={config.osSandbox}
          worktree={config.worktree}
          docker={config.sandbox}
          onSandboxTierChange={(tier) => updateConfig({ sandboxTier: tier })}
          onOsSandboxChange={(updates) => updateConfig({ osSandbox: { ...config.osSandbox, ...updates } })}
          onWorktreeChange={(updates) => updateConfig({ worktree: { ...config.worktree, ...updates } })}
          onDockerChange={(updates) => updateConfig({ sandbox: { ...config.sandbox, ...updates } })}
        />

        {/* About & Updates */}
        <AboutSection />

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
