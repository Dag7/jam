# Jam - AI Agent Orchestrator

## Architecture

Yarn 4 monorepo with the following packages:

- `packages/core` (@jam/core) - Domain models, port interfaces, events
- `packages/eventbus` (@jam/eventbus) - In-process EventBus + HookRegistry
- `packages/agent-runtime` (@jam/agent-runtime) - PTY management, agent lifecycle, runtimes
- `packages/voice` (@jam/voice) - STT/TTS providers, command parser, voice service
- `packages/memory` (@jam/memory) - File-based agent memory + session persistence
- `apps/desktop` (@jam/desktop) - Electron + React desktop app

### Desktop App Structure

```
apps/desktop/
├── electron/
│   ├── main.ts              # App entry — window creation, calls register*Handlers()
│   ├── orchestrator.ts       # Wires services together, manages lifecycle
│   ├── command-router.ts     # Unified voice/text command routing with handler registry
│   ├── preload.ts            # contextBridge → window.jam API
│   ├── ipc/                  # Domain-specific IPC handler modules
│   │   ├── agent-handlers.ts
│   │   ├── terminal-handlers.ts
│   │   ├── voice-handlers.ts
│   │   ├── chat-handlers.ts
│   │   ├── config-handlers.ts
│   │   ├── window-handlers.ts
│   │   ├── setup-handlers.ts
│   │   └── service-handlers.ts
│   └── utils/
│       └── path-fix.ts       # PATH fixup for macOS/Linux GUI apps
├── src/
│   ├── App.tsx               # Pure layout component
│   ├── constants/
│   │   └── provider-catalog.ts  # Shared STT/TTS/model catalogs
│   ├── hooks/
│   │   ├── useTTSQueue.ts    # TTS audio queue (sequential playback)
│   │   └── useIPCSubscriptions.ts  # All IPC event subscriptions
│   ├── containers/           # Zustand-connected components
│   ├── components/           # Pure presentational components
│   └── store/                # Zustand slices
```

### Agent Runtime Structure

```
packages/agent-runtime/src/runtimes/
├── base-runtime.ts        # Abstract base — Template Method pattern for execute()
├── output-strategy.ts     # Strategy pattern — JsonlOutputStrategy, ThrottledOutputStrategy
├── jsonl-parser.ts        # Shared JSONL parsing for stream-json runtimes
├── claude-code.ts         # extends BaseAgentRuntime (JSONL)
├── cursor.ts              # extends BaseAgentRuntime (JSONL)
├── opencode.ts            # extends BaseAgentRuntime (Throttled)
└── codex-cli.ts           # extends BaseAgentRuntime (Throttled, CLI-arg input)
```

## Principles

- **SRP** — each IPC handler module owns one domain (agents, voice, chat, etc.)
- **OCP** — provider registries, command handler registry, progress phrase registry use data maps
- **DIP** — depend on abstractions (port interfaces in @jam/core); inject narrow deps via interfaces
- **Template Method** — BaseAgentRuntime owns shared execute() lifecycle; subclasses override hooks
- **Strategy pattern** — OutputStrategy for runtimes, IAgentRuntime, ISTTProvider, ITTSProvider
- **Container/Component pattern** in React — containers wire to Zustand, components are pure
- **EventBus (Observer pattern)** for cross-cutting event propagation
- **CommandRouter** with handler registry for extensible command dispatch

## Commands

- `yarn dev` - Start desktop app in dev mode
- `yarn build` - Build all packages
- `yarn typecheck` - Type check all packages
- `yarn workspace @jam/desktop electron:dev` - Start Electron dev server

## Slash Commands

Project-specific Claude slash commands in `.claude/commands/`:

- `/add-runtime <name>` — Step-by-step guide for adding a new agent runtime
- `/add-voice-provider <name>` — Adding a new STT/TTS provider
- `/add-ipc-handler <name>` — Creating a new IPC handler module
- `/review-solid <file>` — Audit a file for SOLID violations

## Key Patterns

### Adding a New Runtime

1. Create file in `packages/agent-runtime/src/runtimes/`
2. Extend `BaseAgentRuntime`, implement abstract hooks
3. Choose output strategy: `JsonlOutputStrategy` (line-buffered JSONL) or `ThrottledOutputStrategy` (raw streaming)
4. Export from `packages/agent-runtime/src/index.ts`
5. Register in orchestrator constructor

### IPC Handler Modules (Narrow Dependencies)

Each `electron/ipc/*-handlers.ts` exports:
- A `XxxHandlerDeps` interface — only what that handler needs
- A `registerXxxHandlers(deps: XxxHandlerDeps, ...)` function

In `main.ts`, deps are destructured from orchestrator:
```typescript
registerAgentHandlers({
  runtimeRegistry: orchestrator.runtimeRegistry,
  agentManager: orchestrator.agentManager,
});
```
Never pass the whole orchestrator. This makes dependencies explicit and testable.

### CommandRouter — Handler Registry

`command-router.ts` uses a handler registry for command dispatch (OCP):
```typescript
this.registerCommand('status-query', (agentId) => this.handleStatusQuery(agentId));
this.registerCommand('interrupt', (agentId) => this.handleInterrupt(agentId));
```
Adding new command types = calling `registerCommand()`. Handlers call `router.dispatch(targetId, parsed)` instead of if/else chains.

### Provider Registry Pattern

Orchestrator uses factory maps instead of switch statements:
```typescript
private readonly sttFactories: Record<string, (key, model) => ISTTProvider> = {
  openai: (key, model) => new WhisperSTTProvider(key, model),
  elevenlabs: (key, model) => new ElevenLabsSTTProvider(key, model),
};
```
Adding a new provider = adding one entry to the map.

### Progress Phrase Registry

Orchestrator uses a data-driven pattern array for TTS progress:
```typescript
private readonly progressPhrases: Array<{ pattern: RegExp; phrase: string }> = [
  { pattern: /bash|command|shell/i, phrase: 'Running a command.' },
  { pattern: /write|edit|create/i, phrase: 'Writing some code.' },
];
```
Adding new phrases = adding entries to the array.

### Shared Catalogs

`src/constants/provider-catalog.ts` is the single source of truth for STT_MODELS, TTS_VOICES, AGENT_MODELS, AGENT_COLORS. Import from here — never duplicate these lists.

### Dependency Injection

- `AgentManager` receives `AgentContextBuilder` and `TaskTracker` via constructor
- `VoiceService` accepts optional `CommandParser` via config
- Orchestrator creates and injects all dependencies

### React Hooks

- `useTTSQueue` — manages TTS audio playback queue with refs (no module-level globals)
- `useIPCSubscriptions` — subscribes to all IPC events, dispatches to Zustand store
- App.tsx is a pure layout component that delegates all logic to hooks/containers

### IPC Communication

- `ipcRenderer.invoke` for request/response (agents:list, config:get, etc.)
- `ipcRenderer.send` for fire-and-forget (voice:audioChunk, voice:ttsState)
- `createEventListener` helper for event streams with automatic cleanup

### Security

- All shell commands use `execFileSync` with argument arrays (never string interpolation)
- API keys encrypted via electron safeStorage
- No `execSync` with user-influenced strings

## Code Quality Rules

- Never use `execSync` with string interpolation — always `execFileSync` with argument arrays
- Never duplicate provider catalogs — import from `src/constants/provider-catalog.ts`
- Never instantiate dependencies directly in classes — inject via constructors
- Never add switch/if-else chains for provider/command types — use registry maps
- Never put IPC handlers inline in main.ts — create a handler module in `electron/ipc/`
- Never pass the whole orchestrator to handlers — define narrow `XxxHandlerDeps` interfaces
- Never use module-level mutable state in React — use refs inside hooks
- Keep App.tsx as a pure layout component — extract logic to hooks
- New runtimes must extend `BaseAgentRuntime` — never implement IAgentRuntime from scratch
