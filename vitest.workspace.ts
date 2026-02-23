import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/agent-runtime',
  'packages/eventbus',
  'packages/voice',
  'packages/memory',
  'packages/team',
  'apps/desktop',
]);
