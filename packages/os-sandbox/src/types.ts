/** Sandbox isolation tier — determines which isolation mechanism is active */
export type SandboxTier = 'none' | 'os' | 'docker';

/** OS-level sandbox configuration (seatbelt on macOS, bubblewrap on Linux) */
export interface OsSandboxConfig {
  /** Whether OS-level sandboxing is active */
  enabled: boolean;
  /** Domains agents are allowed to reach (API endpoints, package registries) */
  allowedDomains: string[];
  /** Paths agents are forbidden from reading */
  denyRead: string[];
  /** Additional paths agents are allowed to write to beyond their workspace */
  extraAllowWrite: string[];
  /** Paths explicitly denied for writing even within allowed areas */
  denyWrite: string[];
}

/** Git worktree isolation settings */
export interface WorktreeConfig {
  /** Auto-create worktrees when agent cwd is a git repo */
  autoCreate: boolean;
  /** Directory name for worktrees inside the repo */
  worktreeDir: string;
}

/** Info about an active agent worktree */
export interface WorktreeInfo {
  agentId: string;
  worktreePath: string;
  branch: string;
  repoRoot: string;
  createdAt: string;
}

/** Merge diff for a worktree branch */
export interface MergeDiff {
  agentId: string;
  branch: string;
  filesChanged: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted';
    diff: string;
  }>;
  conflictsDetected: boolean;
}

export interface MergeResult {
  success: boolean;
  mergedFiles: number;
  error?: string;
}

export type MergeStatus = 'clean' | 'ahead' | 'behind' | 'diverged' | 'conflict' | 'unknown';

export const DEFAULT_OS_SANDBOX_CONFIG: OsSandboxConfig = {
  enabled: true, // ON by default
  allowedDomains: [
    // Anthropic API
    'api.anthropic.com',
    // OpenAI (voice STT/TTS + Codex)
    'api.openai.com',
    // ElevenLabs (voice TTS/STT)
    'api.elevenlabs.io',
    // GitHub (agent git operations)
    'github.com',
    'api.github.com',
    // Package registries
    'registry.npmjs.org',
    'registry.yarnpkg.com',
    'pypi.org',
    'files.pythonhosted.org',
  ],
  denyRead: [
    '~/.ssh',
    '~/.gnupg',
    '~/.aws/credentials',
    '~/.config/gcloud',
  ],
  extraAllowWrite: ['/tmp'],
  denyWrite: ['.env', '*.pem', '*.key'],
};

export const DEFAULT_WORKTREE_CONFIG: WorktreeConfig = {
  autoCreate: true,
  worktreeDir: '.jam-worktrees',
};
