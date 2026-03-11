import React, { useState, useEffect, useCallback } from 'react';

type SandboxTier = 'none' | 'os' | 'docker';
type ContainerExitBehavior = 'stop' | 'delete' | 'keep-running';
type AgentExecution = 'host' | 'container';

interface OsSandboxConfig {
  enabled: boolean;
  allowedDomains: string[];
  denyRead: string[];
  extraAllowWrite: string[];
  denyWrite: string[];
}

interface WorktreeConfig {
  autoCreate: boolean;
  worktreeDir: string;
}

interface DockerConfig {
  containerExitBehavior: ContainerExitBehavior;
  computerUseEnabled: boolean;
  computerUseResolution: string;
  agentExecution: AgentExecution;
}

interface SandboxSettingsProps {
  sandboxTier: SandboxTier;
  osSandbox: OsSandboxConfig;
  worktree: WorktreeConfig;
  docker: DockerConfig;
  onSandboxTierChange: (tier: SandboxTier) => void;
  onOsSandboxChange: (updates: Partial<OsSandboxConfig>) => void;
  onWorktreeChange: (updates: Partial<WorktreeConfig>) => void;
  onDockerChange: (updates: Partial<DockerConfig>) => void;
}

interface RuntimeAuthStatus {
  runtimeId: string;
  displayName: string;
  authType: string;
  authEnvVar?: string;
  hasAuthCommand: boolean;
  authenticated: boolean;
  expired?: boolean;
  hasApiKey: boolean;
}

const TIER_OPTIONS: Array<{ id: SandboxTier; label: string; desc: string }> = [
  { id: 'none', label: 'None', desc: 'Agents run directly on host \u2014 no isolation' },
  { id: 'os', label: 'OS Sandbox', desc: 'Lightweight OS-level sandbox \u2014 no Docker required' },
  { id: 'docker', label: 'Docker', desc: 'Full container isolation \u2014 requires Docker installed' },
];

const EXIT_OPTIONS: Array<{ id: ContainerExitBehavior; label: string; desc: string }> = [
  { id: 'stop', label: 'Stop', desc: 'Containers stop but stay on disk for fast restart' },
  { id: 'delete', label: 'Delete', desc: 'Containers are fully removed on exit' },
  { id: 'keep-running', label: 'Keep Running', desc: 'Containers stay running in the background' },
];

const AUTH_TYPE_LABELS: Record<string, string> = {
  oauth: 'OAuth',
  'api-key': 'API Key',
  config: 'Config File',
};

/** Single runtime auth row */
const RuntimeAuthRow: React.FC<{
  rt: RuntimeAuthStatus;
  onRefresh: () => void;
}> = ({ rt, onRefresh }) => {
  const [loginLoading, setLoginLoading] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoginLoading(true);
    setError(null);
    try {
      const result = await window.jam.auth.login(rt.runtimeId);
      if (!result.success) setError(result.error ?? 'Login failed');
      onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSetApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setError(null);
    try {
      const result = await window.jam.auth.setApiKey(rt.runtimeId, apiKeyInput.trim());
      if (result.success) {
        setApiKeyInput('');
        setShowApiKey(false);
        onRefresh();
      } else {
        setError(result.error ?? 'Failed to save key');
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRemoveApiKey = async () => {
    setError(null);
    await window.jam.auth.removeApiKey(rt.runtimeId);
    onRefresh();
  };

  const statusBadge = rt.authenticated && !rt.expired
    ? 'bg-green-900/50 text-green-400'
    : rt.expired
      ? 'bg-yellow-900/50 text-yellow-400'
      : 'bg-zinc-800 text-zinc-500';

  const statusText = rt.authenticated && !rt.expired
    ? (rt.hasApiKey ? 'api key' : 'authenticated')
    : rt.expired ? 'expired' : 'not configured';

  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-300 font-medium">{rt.displayName}</span>
          <span className="text-[9px] text-zinc-600">{AUTH_TYPE_LABELS[rt.authType] ?? rt.authType}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusBadge}`}>{statusText}</span>
          {rt.hasAuthCommand && (
            <button
              onClick={handleLogin}
              disabled={loginLoading}
              className="px-2 py-0.5 text-[10px] rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-50 transition-colors"
            >
              {loginLoading ? 'Logging in...' : 'Login'}
            </button>
          )}
          {rt.authEnvVar && (
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="px-2 py-0.5 text-[10px] rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              {showApiKey ? 'Cancel' : (rt.hasApiKey ? 'Change Key' : 'Set Key')}
            </button>
          )}
          {rt.hasApiKey && !showApiKey && (
            <button
              onClick={handleRemoveApiKey}
              className="px-2 py-0.5 text-[10px] rounded text-red-500 hover:text-red-400 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {showApiKey && rt.authEnvVar && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSetApiKey()}
            placeholder={`${rt.authEnvVar} value`}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            onClick={handleSetApiKey}
            disabled={!apiKeyInput.trim()}
            className="px-2 py-1 text-[10px] rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            Save
          </button>
        </div>
      )}
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
};

export const SandboxSettings: React.FC<SandboxSettingsProps> = ({
  sandboxTier,
  osSandbox,
  worktree,
  docker,
  onSandboxTierChange,
  onOsSandboxChange,
  onWorktreeChange,
  onDockerChange,
}) => {
  const [runtimeAuth, setRuntimeAuth] = useState<RuntimeAuthStatus[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);

  const refreshAuth = useCallback(async () => {
    const statuses = await window.jam.auth.statusAll();
    setRuntimeAuth(statuses);
  }, []);

  useEffect(() => { refreshAuth(); }, [refreshAuth]);

  const handleSyncCredentials = async () => {
    setSyncLoading(true);
    try {
      await window.jam.auth.syncCredentials();
      await refreshAuth();
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <>
      {/* Runtime Authentication — shown for all sandbox tiers */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Runtime Authentication
        </h3>
        <p className="text-[10px] text-zinc-600 mb-2">
          Login or set API keys for agent runtimes. Credentials are encrypted locally.
        </p>
        <div className="divide-y divide-zinc-800">
          {runtimeAuth.map((rt) => (
            <RuntimeAuthRow key={rt.runtimeId} rt={rt} onRefresh={refreshAuth} />
          ))}
        </div>
        {sandboxTier === 'docker' && (
          <div className="mt-2">
            <button
              onClick={handleSyncCredentials}
              disabled={syncLoading}
              className="px-2 py-1 text-[10px] rounded border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 disabled:opacity-50 transition-colors"
              title="Sync macOS Keychain credentials to file for Docker container access"
            >
              {syncLoading ? 'Syncing...' : 'Sync Keychain to Containers'}
            </button>
          </div>
        )}
      </section>

      {/* Sandbox & Isolation */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Sandbox & Isolation
        </h3>
        <div className="space-y-4">
          {/* Tier selector */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Isolation Level</label>
            <div className="flex gap-1">
              {TIER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onSandboxTierChange(opt.id)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    sandboxTier === opt.id
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              {TIER_OPTIONS.find(o => o.id === sandboxTier)?.desc}
            </p>
          </div>

          {/* OS Sandbox settings */}
          {sandboxTier === 'os' && (
            <div className="space-y-3 pl-3 border-l-2 border-blue-600/30">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Allowed Domains</label>
                <textarea
                  value={osSandbox.allowedDomains.join('\n')}
                  onChange={(e) => onOsSandboxChange({
                    allowedDomains: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
                  })}
                  rows={4}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono text-xs"
                  placeholder="api.anthropic.com&#10;api.openai.com&#10;github.com"
                />
                <p className="text-[10px] text-zinc-600 mt-0.5">Network domains agents can access (one per line)</p>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Protected Paths (deny read)</label>
                <textarea
                  value={osSandbox.denyRead.join('\n')}
                  onChange={(e) => onOsSandboxChange({
                    denyRead: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
                  })}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono text-xs"
                  placeholder="~/.ssh&#10;~/.gnupg&#10;~/.aws/credentials"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Write-Denied Patterns</label>
                <textarea
                  value={osSandbox.denyWrite.join('\n')}
                  onChange={(e) => onOsSandboxChange({
                    denyWrite: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
                  })}
                  rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono text-xs"
                  placeholder=".env&#10;*.pem&#10;*.key"
                />
              </div>
            </div>
          )}

          {/* Docker settings */}
          {sandboxTier === 'docker' && (
            <div className="space-y-3 pl-3 border-l-2 border-blue-600/30">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">On App Exit</label>
                <div className="flex gap-1">
                  {EXIT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => onDockerChange({ containerExitBehavior: opt.id })}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        docker.containerExitBehavior === opt.id
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-600 mt-1">
                  {EXIT_OPTIONS.find(o => o.id === docker.containerExitBehavior)?.desc}
                </p>
              </div>

              {/* Agent Execution Mode */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Agent Execution</label>
                <div className="flex gap-1">
                  {([
                    { id: 'container' as AgentExecution, label: 'Container', desc: 'Full isolation — agent CLI runs inside Docker container' },
                    { id: 'host' as AgentExecution, label: 'Host', desc: 'Semi isolation — agent runs natively, container provides services' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => onDockerChange({ agentExecution: opt.id })}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        docker.agentExecution === opt.id
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-600 mt-1">
                  {docker.agentExecution === 'host'
                    ? 'Agent runs natively on host — container provides services (desktop, web servers)'
                    : 'Agent runs inside Docker container — full process and filesystem isolation'}
                </p>
              </div>

              {/* Computer Use */}
              <div className="pt-3 border-t border-zinc-700/50">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs text-zinc-400">Virtual Desktop</label>
                    <p className="text-[10px] text-zinc-600">Agents with Computer Use get an isolated Linux desktop</p>
                  </div>
                  <button
                    onClick={() => onDockerChange({ computerUseEnabled: !docker.computerUseEnabled })}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      docker.computerUseEnabled ? 'bg-blue-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        docker.computerUseEnabled ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                </div>
                {docker.computerUseEnabled && (
                  <div className="mt-2">
                    <label className="block text-[10px] text-zinc-500 mb-0.5">Resolution</label>
                    <select
                      value={docker.computerUseResolution}
                      onChange={(e) => onDockerChange({ computerUseResolution: e.target.value })}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-500"
                    >
                      <option value="1280x720">1280x720</option>
                      <option value="1920x1080">1920x1080</option>
                      <option value="2560x1440">2560x1440</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Git Worktrees */}
          <div className="pt-3 border-t border-zinc-700/50">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs text-zinc-400">Git Worktrees</label>
                <p className="text-[10px] text-zinc-600">Auto-create isolated git branches per agent</p>
              </div>
              <button
                onClick={() => onWorktreeChange({ autoCreate: !worktree.autoCreate })}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  worktree.autoCreate ? 'bg-blue-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    worktree.autoCreate ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </div>
            {worktree.autoCreate && (
              <div className="mt-2">
                <label className="block text-[10px] text-zinc-500 mb-0.5">Worktree directory name</label>
                <input
                  type="text"
                  value={worktree.worktreeDir}
                  onChange={(e) => onWorktreeChange({ worktreeDir: e.target.value })}
                  className="w-48 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
};
