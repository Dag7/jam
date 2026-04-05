<p align="center">
  <img src="apps/desktop/src/assets/jam-logo.png" alt="Jam" width="128" />
</p>

<h1 align="center">Jam</h1>

<p align="center">Autonomous AI Agent Orchestrator — build, run, and coordinate a team of autonomous coding agents from your desktop with voice control.</p>

[![Release](https://img.shields.io/github/v/release/Dag7/jam?label=Download&style=flat-square)](https://github.com/Dag7/jam/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)]()
[![License](https://img.shields.io/github/license/Dag7/jam?style=flat-square)]()

## Preview

<p align="center">
  <a href="https://youtu.be/sXrvp5j5U6s">
    <img src="https://img.youtube.com/vi/sXrvp5j5U6s/maxresdefault.jpg" alt="Jam Preview" width="600" />
  </a>
</p>

## Quick Start

```bash
git clone https://github.com/Dag7/jam.git
cd jam
./scripts/setup.sh
yarn dev
```

The setup script handles everything: Node version, Yarn 4 via Corepack, dependencies, and verification. Just clone and run.

> **Requires**: Node.js >= 22 (the script will install it via nvm/fnm if needed)

## Download

Pre-built binaries — no setup needed:

| Platform | Download |
|----------|----------|
| macOS | [Jam.dmg](https://github.com/Dag7/jam/releases/latest/download/Jam.dmg) |
| Windows | [Jam-Setup.exe](https://github.com/Dag7/jam/releases/latest/download/Jam-Setup.exe) |
| Linux | [Jam.AppImage](https://github.com/Dag7/jam/releases/latest/download/Jam.AppImage) |

> macOS builds are signed and notarized with Apple Developer ID — no Gatekeeper warnings.

## What is Jam?

Jam is an **autonomous agent orchestration system**. It lets you spin up a team of AI coding agents that work independently — each with its own terminal, personality, voice, memory, and workspace. Agents execute tasks autonomously, learn from their interactions, evolve their personalities over time, and coordinate with each other. You interact through text or voice; Jam handles the routing, context, and lifecycle.

### Features

- **Autonomous agent orchestration** — Agents work independently with their own PTY, memory, and evolving personality
- **Voice control** — Talk to your agents hands-free with STT/TTS (Whisper + ElevenLabs/OpenAI)
- **4 agent runtimes** — Claude Code, Cursor, OpenCode, and Codex CLI as backends
- **Living personalities** — Each agent has a SOUL.md that evolves over time
- **Conversation memory** — Agents remember past conversations across sessions via JSONL history
- **Dynamic skills** — Agents auto-generate reusable skill files from learned patterns
- **Chat + Stage views** — Unified chat or per-agent terminal view
- **Per-agent voices** — Assign unique TTS voices (61 total across OpenAI + ElevenLabs)
- **Command routing** — Voice commands routed to the right agent by name
- **Sandbox isolation** — Docker containers or OS-level sandboxing (Seatbelt/Bubblewrap)
- **Git worktree isolation** — Each agent can work on its own branch
- **Team coordination** — Task scheduling, smart assignment, trust scoring
- **Auto-update** — Built-in update mechanism via GitHub Releases

### Architecture

<p align="center">
  <img src="docs/images/architecture-overview.png" alt="Architecture Overview" width="800" />
</p>

The system is a Yarn 4 monorepo with 10 packages:

| Package | Description |
|---------|-------------|
| `@jam/core` | Domain models, port interfaces, event definitions |
| `@jam/eventbus` | In-process pub/sub EventBus (22 events) with diagnostics |
| `@jam/agent-runtime` | PTY management, agent lifecycle, 4 runtime implementations |
| `@jam/voice` | STT/TTS providers, command parser, voice service |
| `@jam/memory` | File-based agent memory with session persistence |
| `@jam/team` | Task scheduling, smart assignment, soul evolution, communication |
| `@jam/sandbox` | Docker containerization, seccomp, port allocation, audit logging |
| `@jam/os-sandbox` | OS-level sandboxing (Seatbelt/Bubblewrap), git worktree management |
| `@jam/computer-use` | Virtual desktop (X11), screenshot, browser automation |
| `@jam/desktop` | Electron + React desktop app |

### Agent Runtimes

<p align="center">
  <img src="docs/images/runtime-pattern.png" alt="Agent Runtime Pattern" width="800" />
</p>

All runtimes extend `BaseAgentRuntime` using the Template Method pattern:

| Runtime | CLI | Output | Input | Session Resume |
|---------|-----|--------|-------|----------------|
| **Claude Code** | `claude` | JSONL | stdin | `--resume <id>` |
| **Cursor** | `cursor-agent` | JSONL | stdin | — |
| **OpenCode** | `opencode` | Raw stream | stdin | — |
| **Codex CLI** | `codex` | Raw stream | CLI arg | — |

### Voice Providers

| Type | Provider | Options |
|------|----------|---------|
| **STT** | OpenAI Whisper | whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe |
| **STT** | ElevenLabs | scribe_v1, scribe_v1_experimental |
| **TTS** | OpenAI | 13 voices, speed control |
| **TTS** | ElevenLabs | 48 voices, stability + similarity tuning |

### Sandboxing

| Tier | Method | Features |
|------|--------|----------|
| **OS** | Seatbelt (macOS) / Bubblewrap (Linux) | Domain whitelist, file deny lists, deny-write patterns |
| **Docker** | Container per agent | CPU/memory limits, seccomp, network policy, disk quota, audit log |
| **Worktree** | Git branch isolation | Auto-create worktrees, merge status tracking |

## How It Works

### Prompt Flow

<p align="center">
  <img src="docs/images/prompt-flow.png" alt="Prompt Flow" width="700" />
</p>

When you send a message: React UI captures input, invokes IPC to the main process, which parses the command, resolves the target agent, enqueues it, enriches context (SOUL.md + conversation history + skills), and executes via the agent's runtime. The response is recorded and returned to the UI.

### Voice Pipeline

<p align="center">
  <img src="docs/images/voice-pipeline.png" alt="Voice Pipeline" width="700" />
</p>

Voice flows through: audio capture → STT transcription → command parsing & agent routing → agent execution → TTS response → audio playback. Progress phrases provide real-time voice feedback during execution.

### Conversation Context

<p align="center">
  <img src="docs/images/conversation-context.png" alt="Conversation Context" width="700" />
</p>

Agents maintain context through three mechanisms:
1. **Session ID resume** — Claude Code uses `--resume` to continue server-side conversations
2. **Conversation JSONL** — Daily log files, last 20 entries injected into system prompt (all runtimes)
3. **SOUL.md + Skills** — Persistent personality and auto-matched skill files

For detailed architecture documentation, see [docs/architecture.md](docs/architecture.md).

## Configuration

### Prerequisites

- At least one agent runtime CLI installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenCode](https://opencode.ai), [Codex CLI](https://github.com/openai/codex), or [Cursor](https://cursor.com)
- API keys for your preferred voice providers (optional, for voice features):
  - OpenAI API key (for Whisper STT and/or OpenAI TTS)
  - ElevenLabs API key (for ElevenLabs STT and/or TTS)

### First Launch

1. Launch Jam
2. Open **Settings** (gear icon in sidebar)
3. Add your API keys for voice providers
4. Create an agent — pick a name, runtime, model, and voice

### Agent Workspace

Each agent gets a directory at `~/.jam/agents/<name>/`:

```
~/.jam/agents/sue/
├── SOUL.md              # Living personality file
├── conversations/       # Daily JSONL conversation logs
│   └── 2026-04-04.jsonl
└── skills/              # Agent-created skill files
    └── react-patterns.md
```

## Development

### Requirements

- Node.js >= 22 (Vite 7 requires 22.12+)
- Yarn 4 (managed automatically via Corepack)

### Commands

| Command | Description |
|---------|-------------|
| `yarn dev` | Start desktop app in dev mode |
| `yarn build` | Build all packages |
| `yarn typecheck` | Type check all packages |
| `yarn test` | Run all tests |
| `yarn test:coverage` | Run tests with coverage |

### Project Structure

```
packages/
  core/             # Domain models, port interfaces, events
  eventbus/         # In-process EventBus + HookRegistry
  agent-runtime/    # PTY management, agent lifecycle, runtimes
  voice/            # STT/TTS providers, command parser
  memory/           # File-based agent memory
  team/             # Task scheduling, soul evolution, communication
  sandbox/          # Docker containerization, seccomp
  os-sandbox/       # OS-level sandboxing, git worktrees
  computer-use/     # Virtual desktop, browser automation
  brain/            # Brain client, memory store
apps/
  desktop/          # Electron + React desktop app
```

### Design Principles

- **SOLID** — Depend on abstractions (port interfaces in `@jam/core`); inject narrow deps
- **Template Method** — `BaseAgentRuntime` owns shared lifecycle; runtimes override hooks
- **Strategy pattern** — Pluggable runtimes, output strategies, and voice providers
- **Observer pattern** — EventBus for decoupled event propagation
- **Container/Component** — React containers wire to Zustand, components stay pure
- **Factory maps** — Provider/command registries use data maps, never switch statements
