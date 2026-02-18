# Jam

AI Agent Orchestrator — run a team of AI agents from your desktop with voice control.

[![Release](https://img.shields.io/github/v/release/doorzdev/jam?label=Download&style=flat-square)](https://github.com/doorzdev/jam/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)]()
[![License](https://img.shields.io/github/license/doorzdev/jam?style=flat-square)]()

## Download

| Platform | Download |
|----------|----------|
| macOS | [Jam.dmg](https://github.com/doorzdev/jam/releases/latest/download/Jam.dmg) |
| Windows | [Jam-Setup.exe](https://github.com/doorzdev/jam/releases/latest/download/Jam-Setup.exe) |
| Linux | [Jam.AppImage](https://github.com/doorzdev/jam/releases/latest/download/Jam.AppImage) |

> macOS builds are signed and notarized with Apple Developer ID — no Gatekeeper warnings.

## What is Jam?

Jam lets you create, manage, and talk to a team of AI coding agents running on your machine. Each agent gets its own terminal, personality, voice, and workspace.

### Features

- **Multi-agent orchestration** — Run multiple AI agents simultaneously, each in their own PTY
- **Voice control** — Talk to your agents hands-free with STT/TTS (Whisper + ElevenLabs/OpenAI)
- **Agent runtimes** — Supports Claude Code and OpenCode as backends
- **Living personalities** — Each agent has a SOUL.md that evolves over time
- **Conversation memory** — Agents remember past conversations across sessions
- **Dynamic skills** — Agents auto-generate reusable skill files from learned patterns
- **Chat + Stage views** — Unified chat or grid view showing all agents at once
- **Per-agent voices** — Assign unique TTS voices to each agent
- **Command routing** — Voice commands are routed to the right agent by name

### Architecture

```
┌─────────────────────────────────────────────┐
│                  Desktop App                 │
│            (Electron + React + Zustand)      │
├─────────────────────────────────────────────┤
│  Orchestrator                               │
│  ├── AgentManager (lifecycle, PTY, execute) │
│  ├── VoiceService (STT/TTS pipeline)        │
│  ├── EventBus (cross-cutting events)        │
│  └── MemoryStore (file-based persistence)   │
├─────────────────────────────────────────────┤
│  Agent Runtimes                             │
│  ├── Claude Code  (claude CLI)              │
│  └── OpenCode     (opencode CLI)            │
├─────────────────────────────────────────────┤
│  Voice Providers                            │
│  ├── STT: Whisper / ElevenLabs              │
│  └── TTS: OpenAI / ElevenLabs              │
└─────────────────────────────────────────────┘
```

## Setup

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [OpenCode](https://opencode.ai) CLI installed
- API keys for your preferred voice providers (optional, for voice features):
  - OpenAI API key (for Whisper STT and/or OpenAI TTS)
  - ElevenLabs API key (for ElevenLabs STT and/or TTS)

### Configuration

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
│   └── 2026-02-18.jsonl
└── skills/              # Agent-created skill files
    └── react-patterns.md
```

## Development

### Requirements

- Node.js 20+
- Yarn 4 (Corepack)

### Getting Started

```bash
# Clone and install
git clone https://github.com/doorzdev/jam.git
cd jam
corepack enable
yarn install

# Start dev mode
yarn dev
```

### Commands

| Command | Description |
|---------|-------------|
| `yarn dev` | Start desktop app in dev mode |
| `yarn build` | Build all packages |
| `yarn typecheck` | Type check all packages |

### Project Structure

```
packages/
  core/           # Domain models, port interfaces, events
  eventbus/       # In-process EventBus
  agent-runtime/  # PTY management, agent lifecycle, runtimes
  voice/          # STT/TTS providers, command parser
  memory/         # File-based agent memory
apps/
  desktop/        # Electron + React desktop app
```

### Design Principles

- **SOLID** — depend on abstractions (port interfaces in `@jam/core`)
- **Strategy pattern** — pluggable runtimes and voice providers
- **Observer pattern** — EventBus for decoupled event propagation
- **Container/Component** — React containers wire to Zustand, components stay pure
