import React, { useState, useEffect } from 'react';

const AGENT_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ec4899', '#06b6d4',
];

const RUNTIMES = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
];

type TTSProvider = 'openai' | 'elevenlabs';

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

const MODELS_BY_RUNTIME: Record<string, Array<{ id: string; label: string; group: string }>> = {
  'claude-code': [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', group: 'Claude 4' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', group: 'Claude 4' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', group: 'Claude 4' },
    { id: 'opus', label: 'Opus (latest)', group: 'Aliases' },
    { id: 'sonnet', label: 'Sonnet (latest)', group: 'Aliases' },
    { id: 'haiku', label: 'Haiku (latest)', group: 'Aliases' },
  ],
  opencode: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', group: 'Anthropic' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', group: 'Anthropic' },
    { id: 'gpt-4o', label: 'GPT-4o', group: 'OpenAI' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', group: 'OpenAI' },
    { id: 'o3', label: 'o3', group: 'OpenAI' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', group: 'Google' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', group: 'Google' },
  ],
};

export interface AgentFormValues {
  id?: string;
  name: string;
  runtime: string;
  model?: string;
  systemPrompt?: string;
  color: string;
  voice: { ttsVoiceId: string };
  cwd?: string;
  autoStart?: boolean;
  allowFullAccess?: boolean;
  allowInterrupts?: boolean;
}

interface AgentConfigFormProps {
  onSubmit: (profile: Record<string, unknown>) => void;
  onCancel: () => void;
  initialValues?: AgentFormValues;
}

export const AgentConfigForm: React.FC<AgentConfigFormProps> = ({
  onSubmit,
  onCancel,
  initialValues,
}) => {
  const isEditing = !!initialValues?.id;

  const [name, setName] = useState(initialValues?.name ?? '');
  const [runtime, setRuntime] = useState(initialValues?.runtime ?? 'claude-code');
  const [model, setModel] = useState(initialValues?.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initialValues?.systemPrompt ?? '');
  const [color, setColor] = useState(initialValues?.color ?? AGENT_COLORS[0]);
  const [ttsVoiceId, setTtsVoiceId] = useState(initialValues?.voice?.ttsVoiceId ?? '');
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>('openai');
  const [cwd, setCwd] = useState(initialValues?.cwd ?? '');
  const [autoStart, setAutoStart] = useState(initialValues?.autoStart ?? false);
  const [allowFullAccess, setAllowFullAccess] = useState(initialValues?.allowFullAccess ?? false);
  const [allowInterrupts, setAllowInterrupts] = useState(initialValues?.allowInterrupts ?? false);

  // Load TTS provider from global config and ensure voice is compatible
  useEffect(() => {
    window.jam.config.get().then((c) => {
      const provider = (c.ttsProvider as TTSProvider) || 'openai';
      setTtsProvider(provider);

      const providerVoices = TTS_VOICES[provider] || [];
      const storedVoice = initialValues?.voice?.ttsVoiceId;
      const isCompatible = storedVoice && providerVoices.some((v) => v.id === storedVoice);

      if (isCompatible) {
        setTtsVoiceId(storedVoice);
      } else {
        // Stored voice is missing or incompatible with current provider — use default
        const defaultVoice = (c.ttsVoice as string) || providerVoices[0]?.id || '';
        setTtsVoiceId(defaultVoice);
      }
    });
  }, [initialValues?.voice?.ttsVoiceId]);

  const voices = TTS_VOICES[ttsProvider] || [];
  const models = MODELS_BY_RUNTIME[runtime] || [];

  // Group models by their group label
  const modelGroups = models.reduce<Record<string, typeof models>>((acc, m) => {
    (acc[m.group] ??= []).push(m);
    return acc;
  }, {});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const voiceId = ttsVoiceId || voices[0]?.id || 'alloy';
    onSubmit({
      ...(isEditing ? { id: initialValues!.id } : {}),
      name,
      runtime,
      model: model || undefined,
      systemPrompt: systemPrompt || undefined,
      color,
      voice: { ttsVoiceId: voiceId },
      cwd: cwd || undefined,
      autoStart,
      allowFullAccess,
      allowInterrupts,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">
        {isEditing ? `Configure ${initialValues!.name}` : 'New Agent'}
      </h3>

      <div>
        <label className="block text-xs text-zinc-400 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Mike"
          required
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-400 mb-1">Runtime</label>
        <select
          value={runtime}
          onChange={(e) => {
            setRuntime(e.target.value);
            setModel('');
          }}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
        >
          {RUNTIMES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
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
          {Object.entries(modelGroups).map(([group, groupModels]) => (
            <optgroup key={group} label={group}>
              {groupModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-zinc-400 mb-1">
          Persona / System Prompt
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="e.g., You are wise and always reflect before your final reply..."
          rows={3}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-400 mb-1">
          Working Directory
        </label>
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={name ? `~/.jam/agents/` + name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() : '~/.jam/agents/agent-name'}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
        />
        <p className="text-[10px] text-zinc-600 mt-1">
          Defaults to ~/.jam/agents/agent-name if left empty. Created automatically.
        </p>
      </div>

      <div>
        <label className="block text-xs text-zinc-400 mb-1">Voice</label>
        <select
          value={ttsVoiceId}
          onChange={(e) => setTtsVoiceId(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
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
                color === c ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="autoStart"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
          />
          <label htmlFor="autoStart" className="text-xs text-zinc-400">
            Auto-start on app launch
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="allowFullAccess"
            checked={allowFullAccess}
            onChange={(e) => setAllowFullAccess(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-zinc-900"
          />
          <label htmlFor="allowFullAccess" className="text-xs text-zinc-400">
            Full access <span className="text-zinc-600">(web search, file ops, no confirmation prompts)</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="allowInterrupts"
            checked={allowInterrupts}
            onChange={(e) => setAllowInterrupts(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-zinc-900"
          />
          <label htmlFor="allowInterrupts" className="text-xs text-zinc-400">
            Allow interrupts <span className="text-zinc-600">(new commands abort the current task)</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isEditing ? 'Save Changes' : 'Create Agent'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
