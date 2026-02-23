Create a new IPC handler module for $ARGUMENTS.

Steps:
1. Create `apps/desktop/electron/ipc/$ARGUMENTS-handlers.ts`
2. Define a narrow dependency interface:
   ```typescript
   export interface XxxHandlerDeps {
     // Only the specific services/stores this handler needs
   }
   ```
3. Export `registerXxxHandlers(deps: XxxHandlerDeps): void`
4. Inside, register `ipcMain.handle()` or `ipcMain.on()` calls
5. Wire up in `apps/desktop/electron/main.ts` `registerIpcHandlers()`:
   ```typescript
   registerXxxHandlers({
     // Destructure only needed props from orchestrator
   });
   ```
6. Add preload bridge in `apps/desktop/electron/preload.ts`:
   ```typescript
   xxxMethod: (...args) => ipcRenderer.invoke('xxx:method', ...args),
   ```
7. Add TypeScript types in `apps/desktop/src/global.d.ts` under `JamAPI`
8. Run `yarn typecheck && yarn build` to verify

Pattern reference: see `agent-handlers.ts`, `config-handlers.ts` for examples of narrow dep interfaces.
