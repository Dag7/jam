Create a new agent runtime implementation for $ARGUMENTS.

Steps:
1. Create `packages/agent-runtime/src/runtimes/$ARGUMENTS.ts`
2. Extend `BaseAgentRuntime` from `./base-runtime.js`
3. Implement all abstract methods:
   - `runtimeId`, `metadata` (id, displayName, cliCommand, models, detectAuth, getAuthHint)
   - `buildSpawnConfig()`, `parseOutput()`, `formatInput()`
   - `getCommand()`, `buildExecuteArgs()`, `buildExecuteEnv()`
   - `createOutputStrategy()` — use `JsonlOutputStrategy` for JSONL-streaming CLIs or `ThrottledOutputStrategy` for raw-streaming CLIs
   - `parseExecutionOutput()`
4. Override `writeInput()` only if the runtime doesn't use stdin (e.g., CLI arg runtimes)
5. Export the class from `packages/agent-runtime/src/index.ts`
6. Register the runtime in `apps/desktop/electron/orchestrator.ts` constructor
7. Run `yarn typecheck && yarn build` to verify

Reference existing runtimes for patterns:
- JSONL streaming: `claude-code.ts`, `cursor.ts`
- Raw streaming: `opencode.ts`, `codex-cli.ts`
