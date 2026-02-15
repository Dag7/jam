# Jam - AI Agent Orchestrator

## Architecture

Yarn 4 monorepo with the following packages:

- `packages/core` (@jam/core) - Domain models, port interfaces, events
- `packages/eventbus` (@jam/eventbus) - In-process EventBus + HookRegistry
- `packages/agent-runtime` (@jam/agent-runtime) - PTY management, agent lifecycle, runtimes
- `packages/voice` (@jam/voice) - STT/TTS providers, command parser, voice service
- `packages/memory` (@jam/memory) - File-based agent memory + session persistence
- `apps/desktop` (@jam/desktop) - Electron + React desktop app

## Principles

- SOLID - depend on abstractions (port interfaces in @jam/core)
- Strategy pattern for runtimes (IAgentRuntime) and voice providers (ISTTProvider, ITTSProvider)
- Container/Component pattern in React - containers wire to Zustand, components are pure
- IPresentationAdapter decouples application logic from UI framework
- EventBus (Observer pattern) for cross-cutting event propagation

## Commands

- `yarn dev` - Start desktop app in dev mode
- `yarn build` - Build all packages
- `yarn typecheck` - Type check all packages
- `yarn workspace @jam/desktop electron:dev` - Start Electron dev server

## Key Patterns

- IPC follows whatsapp-relay patterns: `ipcRenderer.invoke` for request/response, `ipcRenderer.send` for fire-and-forget, `createEventListener` for event streams
- Agent runtimes: ClaudeCodeRuntime, OpenCodeRuntime (implement IAgentRuntime)
- Voice: Whisper STT + ElevenLabs TTS (implement ISTTProvider / ITTSProvider)
- Storage: electron-store + safeStorage for encrypted API keys, file-based for agent memory
