import React from 'react';

type SandboxTier = 'none' | 'os' | 'docker';
type ContainerExitBehavior = 'stop' | 'delete' | 'keep-running';

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
  return (
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
  );
};
