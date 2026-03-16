/**
 * Reads the esbuild-bundled CLI (dist/jam.js) and generates a TypeScript
 * module that exports the script as a string constant.
 *
 * The orchestrator imports this constant and writes it to ~/.jam/bin/jam.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const bundlePath = new URL('../dist/jam.cjs', import.meta.url).pathname;
const outputPath = new URL('../src/generated/jam-embed.ts', import.meta.url).pathname;

const script = readFileSync(bundlePath, 'utf-8');

// Prepend shebang (esbuild's --banner doesn't always play nicely with CJS)
const withShebang = script.startsWith('#!/') ? script : '#!/usr/bin/env node\n' + script;

// Use JSON.stringify for safe escaping — no template-literal issues
const output = `// AUTO-GENERATED — do not edit. Run \`yarn build\` to regenerate.
export const JAM_CLI_SCRIPT = ${JSON.stringify(withShebang)};
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output, 'utf-8');

console.log(`Generated embed: ${outputPath} (${withShebang.length} bytes)`);
