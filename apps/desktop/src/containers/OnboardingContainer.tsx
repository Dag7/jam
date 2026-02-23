import React, { useState, useEffect } from 'react';
import jamLogo from '@/assets/jam-logo.png';

type OnboardingStep = 'welcome' | 'runtimes' | 'voice' | 'agent' | 'done';

interface RuntimeInfo {
  id: string;
  name: string;
  available: boolean;
  authenticated: boolean;
  version: string;
  nodeVersion: string;
  error: string;
  authHint: string;
}

import {
  type TTSProvider,
  TTS_VOICES,
  AGENT_COLORS,
} from '@/constants/provider-catalog';

interface RuntimeMetadataItem {
  id: string;
  displayName: string;
  cliCommand: string;
  models: Array<{ id: string; label: string; group: string }>;
}

const STEPS: OnboardingStep[] = ['welcome', 'runtimes', 'voice', 'agent', 'done'];

export const OnboardingContainer: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const stepIndex = STEPS.indexOf(step);

  const next = () => {
    const nextIdx = stepIndex + 1;
    if (nextIdx < STEPS.length) setStep(STEPS[nextIdx]);
  };

  const prev = () => {
    const prevIdx = stepIndex - 1;
    if (prevIdx >= 0) setStep(STEPS[prevIdx]);
  };

  const handleFinish = async () => {
    await window.jam.setup.completeOnboarding();
    onComplete();
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Drag region for frameless window */}
      <div className="h-10 flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          {/* Progress dots */}
          <div className="flex justify-center gap-2 mb-8">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === stepIndex ? 'bg-blue-500' : i < stepIndex ? 'bg-blue-500/40' : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>

          {step === 'welcome' && <WelcomeStep onNext={next} />}
          {step === 'runtimes' && <RuntimesStep onNext={next} onPrev={prev} />}
          {step === 'voice' && <VoiceStep onNext={next} onPrev={prev} />}
          {step === 'agent' && <AgentStep onNext={next} onPrev={prev} />}
          {step === 'done' && <DoneStep onFinish={handleFinish} onPrev={prev} />}
        </div>
      </div>
    </div>
  );
};

// --- Step: Welcome ---
const WelcomeStep: React.FC<{ onNext: () => void }> = ({ onNext }) => (
  <div className="text-center space-y-6">
    <img src={jamLogo} alt="Jam" className="w-24 h-24 mx-auto" />
    <div>
      <h1 className="text-2xl font-bold text-zinc-100">Welcome to Jam</h1>
      <p className="text-sm text-zinc-400 mt-2 max-w-sm mx-auto">
        Run a team of AI coding agents from your desktop with voice control.
        Let's get you set up.
      </p>
    </div>
    <button
      onClick={onNext}
      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
    >
      Get Started
    </button>
  </div>
);

// --- Step: Runtime Detection ---
const RuntimesStep: React.FC<{ onNext: () => void; onPrev: () => void }> = ({ onNext, onPrev }) => {
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ runtimeId: string; success: boolean; output: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [cliCommands, setCliCommands] = useState<Record<string, string>>({});

  const refresh = () => {
    setLoading(true);
    setTestResult(null);
    Promise.all([
      window.jam.setup.detectRuntimes(),
      window.jam.runtimes.listMetadata(),
    ]).then(([detected, meta]) => {
      setRuntimes(detected);
      const cmds: Record<string, string> = {};
      for (const m of meta) cmds[m.id] = m.cliCommand;
      setCliCommands(cmds);
      setLoading(false);
    });
  };

  useEffect(() => { refresh(); }, []);

  const hasAnyRuntime = runtimes.some((r) => r.available);
  const hasAuthedRuntime = runtimes.some((r) => r.available && r.authenticated);
  const needsAuth = hasAnyRuntime && !hasAuthedRuntime;

  const handleOpenTerminal = (r: RuntimeInfo) => {
    const cmd = cliCommands[r.id] ?? r.id;
    window.jam.setup.openTerminal(cmd);
  };

  const handleTest = async (r: RuntimeInfo) => {
    setTesting(r.id);
    setTestResult(null);
    try {
      const result = await window.jam.setup.testRuntime(r.id);
      setTestResult({ runtimeId: r.id, ...result });
    } catch (err) {
      setTestResult({ runtimeId: r.id, success: false, output: String(err) });
    }
    setTesting(null);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-zinc-100">Agent Runtimes</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Jam needs at least one AI coding CLI installed and authenticated.
        </p>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="text-center text-zinc-500 text-sm py-4">Detecting runtimes...</div>
        ) : (
          runtimes.map((r) => (
            <div
              key={r.id}
              className={`p-3 rounded-lg border ${
                r.error
                  ? 'border-red-500/30 bg-red-500/5'
                  : r.available && r.authenticated
                    ? 'border-green-500/30 bg-green-500/5'
                    : r.available
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-zinc-700 bg-zinc-800/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-zinc-200">{r.name}</div>
                  <div className="text-xs text-zinc-500">
                    {cliCommands[r.id] ?? r.id} CLI
                    {r.version && ` v${r.version}`}
                    {r.nodeVersion && ` (Node ${r.nodeVersion})`}
                  </div>
                </div>
                {r.error ? (
                  <span className="text-xs text-red-400 font-medium">Error</span>
                ) : r.available && r.authenticated ? (
                  <span className="text-xs text-green-400 font-medium">Ready</span>
                ) : r.available ? (
                  <span className="text-xs text-amber-400 font-medium">Needs auth</span>
                ) : (
                  <span className="text-xs text-zinc-500">Not installed</span>
                )}
              </div>

              {/* Error message */}
              {r.error && (
                <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-300">{r.error}</p>
                </div>
              )}

              {/* Actions for installed runtimes */}
              {r.available && (
                <div className="mt-2 flex items-center gap-2">
                  {!r.authenticated && (
                    <button
                      onClick={() => handleOpenTerminal(r)}
                      className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-md transition-colors"
                    >
                      Open Terminal to Authenticate
                    </button>
                  )}
                  <button
                    onClick={() => handleTest(r)}
                    disabled={testing === r.id}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded-md transition-colors"
                  >
                    {testing === r.id ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={refresh}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md transition-colors"
                  >
                    Re-check
                  </button>
                </div>
              )}

              {/* Test result */}
              {testResult && testResult.runtimeId === r.id && (
                <div className={`mt-2 p-2 rounded text-xs font-mono ${
                  testResult.success ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'
                }`}>
                  <div className="font-sans font-medium mb-1">
                    {testResult.success ? 'Connection successful' : 'Connection failed'}
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-[10px] opacity-80 max-h-24 overflow-y-auto">
                    {testResult.output}
                  </pre>
                </div>
              )}

              {/* Install hint for missing runtimes */}
              {!r.available && (
                <div className="mt-2">
                  <code className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                    {r.authHint}
                  </code>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {needsAuth && (
        <p className="text-xs text-zinc-500 text-center">
          Authenticate in the terminal that opens, then click Re-check.
        </p>
      )}

      <StepNav onPrev={onPrev} onNext={onNext} nextLabel={hasAnyRuntime ? 'Continue' : 'Skip for now'} />
    </div>
  );
};

// --- Step: Voice API Keys ---
const VoiceStep: React.FC<{ onNext: () => void; onPrev: () => void }> = ({ onNext, onPrev }) => {
  const [openaiKey, setOpenaiKey] = useState('');
  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [hasOpenai, setHasOpenai] = useState(false);
  const [hasElevenlabs, setHasElevenlabs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    window.jam.apiKeys.has('openai').then(setHasOpenai);
    window.jam.apiKeys.has('elevenlabs').then(setHasElevenlabs);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      if (openaiKey.trim()) {
        await window.jam.apiKeys.set('openai', openaiKey.trim());
        setHasOpenai(true);
        setOpenaiKey('');
      }
      if (elevenlabsKey.trim()) {
        await window.jam.apiKeys.set('elevenlabs', elevenlabsKey.trim());
        setHasElevenlabs(true);
        setElevenlabsKey('');
      }
      setStatus('Keys saved.');
    } catch (err) {
      setStatus(`Error: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const hasKeys = hasOpenai || hasElevenlabs;
  const hasPendingKeys = openaiKey.trim() || elevenlabsKey.trim();

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-zinc-100">Voice Setup</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Add API keys for voice features (STT + TTS). You can change these later in Settings.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-zinc-400">OpenAI API Key</label>
            {hasOpenai && <span className="text-xs text-green-400">configured</span>}
          </div>
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder={hasOpenai ? 'Key saved (enter new to replace)' : 'sk-...'}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <p className="text-[10px] text-zinc-600 mt-1">
            Used for Whisper STT and OpenAI TTS voices
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-zinc-400">ElevenLabs API Key</label>
            {hasElevenlabs && <span className="text-xs text-green-400">configured</span>}
          </div>
          <input
            type="password"
            value={elevenlabsKey}
            onChange={(e) => setElevenlabsKey(e.target.value)}
            placeholder={hasElevenlabs ? 'Key saved (enter new to replace)' : 'xi-...'}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <p className="text-[10px] text-zinc-600 mt-1">
            Used for ElevenLabs STT and premium TTS voices
          </p>
        </div>
      </div>

      {hasPendingKeys && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-sm rounded-lg border border-zinc-700 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Keys'}
        </button>
      )}

      {status && (
        <p className={`text-xs text-center ${status.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
          {status}
        </p>
      )}

      <StepNav onPrev={onPrev} onNext={onNext} nextLabel={hasKeys ? 'Continue' : 'Skip for now'} />
    </div>
  );
};

// --- Step: Create First Agent ---
const AgentStep: React.FC<{ onNext: () => void; onPrev: () => void }> = ({ onNext, onPrev }) => {
  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState('claude-code');
  const [model, setModel] = useState('');
  const [color, setColor] = useState(AGENT_COLORS[0]);
  const [ttsVoiceId, setTtsVoiceId] = useState('alloy');
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>('openai');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeMeta, setRuntimeMeta] = useState<RuntimeMetadataItem[]>([]);

  useEffect(() => {
    window.jam.config.get().then((c) => {
      const provider = (c.ttsProvider as TTSProvider) || 'openai';
      setTtsProvider(provider);
      setTtsVoiceId((c.ttsVoice as string) || TTS_VOICES[provider][0]?.id || 'alloy');
    });
    window.jam.runtimes.listMetadata().then(setRuntimeMeta);
  }, []);

  const voices = TTS_VOICES[ttsProvider] || [];
  const currentRuntime = runtimeMeta.find((r) => r.id === runtime);
  const models = currentRuntime?.models ?? [];

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await window.jam.agents.create({
        name: name.trim(),
        runtime,
        model: model || undefined,
        color,
        voice: { ttsVoiceId },
        autoStart: true,
        allowFullAccess: true,
        allowInterrupts: true,
      });
      if (result.success) {
        // Auto-start the agent so it's ready when onboarding finishes
        if (result.agentId) {
          window.jam.agents.start(result.agentId).catch(() => {});
        }
        onNext();
      } else {
        setError(result.error || 'Failed to create agent');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-bold text-zinc-100">Create Your First Agent</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Give your agent a name and pick a runtime. You can create more later.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Sue, Mike, Atlas..."
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Runtime</label>
          <select
            value={runtime}
            onChange={(e) => { setRuntime(e.target.value); setModel(''); }}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
          >
            {runtimeMeta.map((r) => (
              <option key={r.id} value={r.id}>{r.displayName}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Default</option>
            {models.map((m: { id: string; label: string }) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Voice</label>
          <select
            value={ttsVoiceId}
            onChange={(e) => setTtsVoiceId(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Color</label>
          <div className="flex gap-2">
            {AGENT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-zinc-950' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 text-center">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={onPrev}
          className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {creating ? 'Creating...' : 'Create Agent'}
        </button>
        <button
          onClick={onNext}
          className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
};

// --- Step: Done ---
const DoneStep: React.FC<{ onFinish: () => void; onPrev: () => void }> = ({ onFinish }) => (
  <div className="text-center space-y-6">
    <div className="text-4xl">Ready</div>
    <div>
      <h2 className="text-xl font-bold text-zinc-100">You're all set!</h2>
      <p className="text-sm text-zinc-400 mt-2 max-w-sm mx-auto">
        Start your agents, talk to them via voice or text, and watch them work.
        You can always adjust settings from the sidebar.
      </p>
    </div>
    <button
      onClick={onFinish}
      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
    >
      Launch Jam
    </button>
  </div>
);

// --- Shared navigation ---
const StepNav: React.FC<{
  onPrev: () => void;
  onNext: () => void;
  nextLabel?: string;
}> = ({ onPrev, onNext, nextLabel = 'Continue' }) => (
  <div className="flex justify-between pt-2">
    <button
      onClick={onPrev}
      className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
    >
      Back
    </button>
    <button
      onClick={onNext}
      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
    >
      {nextLabel}
    </button>
  </div>
);
