import { execFileSync } from 'node:child_process';
import { createLogger } from '@jam/core';

const log = createLogger('PathFix');

/** Parse a semver-like version string (e.g. "v22.3.0") into comparable parts */
function parseNodeVersion(dir: string): [number, number, number] | null {
  const match = dir.match(/\/v(\d+)\.(\d+)\.(\d+)\//);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Fix nvm PATH ordering: nvm login shells may put an old default Node first.
 * Claude Code v2+ requires Node 20.12+, so ensure the newest nvm Node version
 * comes first in PATH.
 */
function fixNvmNodeOrder(): void {
  const fs = require('node:fs') as typeof import('node:fs');
  const nvmDir = `${process.env.HOME}/.nvm/versions/node`;

  try {
    if (!fs.existsSync(nvmDir)) return;
  } catch { return; }

  let currentMajor: number;
  try {
    const ver = execFileSync('node', ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
    currentMajor = parseInt(ver.replace(/^v/, '').split('.')[0], 10) || 0;
    if (currentMajor >= 20) return;
  } catch {
    currentMajor = 0;
  }

  let dirs: string[];
  try {
    dirs = fs.readdirSync(nvmDir).filter((d: string) => d.startsWith('v'));
  } catch { return; }

  let best: { dir: string; version: [number, number, number] } | null = null;
  for (const d of dirs) {
    const ver = parseNodeVersion(`/${d}/`);
    if (!ver) continue;
    if (ver[0] < 20) continue;
    if (!best || compareVersions(ver, best.version) > 0) {
      best = { dir: d, version: ver };
    }
  }

  if (!best) {
    log.warn(`Node v${currentMajor} found, but no Node >= 20 installed in ${nvmDir}`);
    return;
  }

  const bestBin = `${nvmDir}/${best.dir}/bin`;
  try {
    if (!fs.existsSync(bestBin)) return;
  } catch { return; }

  process.env.PATH = `${bestBin}:${process.env.PATH}`;
  log.info(`Node PATH fixed: prepended v${best.version.join('.')} (was v${currentMajor || 'none'}) → ${bestBin}`);
}

/**
 * Fix PATH for macOS/Linux GUI apps.
 * Electron apps don't inherit the shell PATH, so tools like 'claude', 'opencode', etc.
 * won't be found. Resolve the real PATH from the user's login shell at startup.
 */
export function fixPath(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const result = execFileSync(shell, ['-lc', 'echo -n "$PATH"'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (result && !result.includes('\n')) {
      process.env.PATH = result;
    }
  } catch {
    // Fallback: append common locations
  }

  const extras = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${process.env.HOME}/.local/bin`,
    `${process.env.HOME}/.cargo/bin`,
    '/opt/homebrew/sbin',
  ];
  const currentPath = process.env.PATH || '';
  const pathSet = new Set(currentPath.split(':'));
  const missing = extras.filter((p) => !pathSet.has(p));
  if (missing.length > 0) {
    process.env.PATH = `${currentPath}:${missing.join(':')}`;
  }

  fixNvmNodeOrder();
}
