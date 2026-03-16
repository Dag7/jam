import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RESCAN_FILE = path.join(os.homedir(), '.jam', 'ipc', '.rescan');

/**
 * Touch ~/.jam/ipc/.rescan to notify the Jam orchestrator that
 * .services.json or .cron.json has changed and a re-scan is needed.
 * The ipc/ directory is a dedicated shared mount between host and containers,
 * keeping agent workspaces isolated.
 */
export function notifyJam(): void {
  try {
    const dir = path.dirname(RESCAN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RESCAN_FILE, Date.now().toString(), 'utf-8');
  } catch {
    // Non-critical — orchestrator will pick up changes on next periodic scan
  }
}
