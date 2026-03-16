import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../utils/io.js';
import { notifyJam } from '../utils/notify.js';

const CRON_FILE = '.cron.json';

interface CronEntry {
  name: string;
  schedule: string;
  command: string;
  cwd: string;
  enabled: boolean;
  createdAt: string;
}

export function cronAdd(flags: Record<string, string>): void {
  const name = flags['name'];
  const schedule = flags['schedule'];
  const command = flags['command'];
  const cwd = flags['cwd'] || process.cwd();

  if (!name) { console.error('Error: --name is required'); process.exit(1); }
  if (!schedule) { console.error('Error: --schedule is required (cron expression)'); process.exit(1); }
  if (!command) { console.error('Error: --command is required'); process.exit(1); }

  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    console.error('Error: invalid cron expression "' + schedule + '" — must have 5 fields (minute hour dom month dow)');
    process.exit(1);
  }

  const filePath = path.join(cwd, CRON_FILE);
  const entries = readJsonFile(filePath) as unknown as CronEntry[];
  const existing = entries.findIndex((e) => e.name === name);
  const entry: CronEntry = { name, schedule, command, cwd, enabled: true, createdAt: new Date().toISOString() };

  if (existing >= 0) {
    entries[existing] = entry;
    console.log('Updated cron "' + name + '" -> ' + schedule);
  } else {
    entries.push(entry);
    console.log('Added cron "' + name + '" -> ' + schedule);
  }
  writeJsonFile(filePath, entries);
  notifyJam();
}

export function cronRemove(flags: Record<string, string>): void {
  const name = flags['name'];
  if (!name) { console.error('Error: --name is required'); process.exit(1); }
  const cwd = flags['cwd'] || process.cwd();
  const filePath = path.join(cwd, CRON_FILE);
  const entries = readJsonFile(filePath) as unknown as CronEntry[];
  const filtered = entries.filter((e) => e.name !== name);
  if (filtered.length === entries.length) { console.error('Cron job "' + name + '" not found'); process.exit(1); }
  writeJsonFile(filePath, filtered);
  notifyJam();
  console.log('Removed cron "' + name + '"');
}

export function cronList(flags: Record<string, string>): void {
  const cwd = flags['cwd'] || process.cwd();
  const filePath = path.join(cwd, CRON_FILE);
  const entries = readJsonFile(filePath) as unknown as CronEntry[];
  if (entries.length === 0) { console.log('No cron jobs registered'); return; }
  console.log('Cron jobs (' + filePath + '):\n');
  for (const e of entries) {
    const status = e.enabled !== false ? 'ACTIVE' : 'PAUSED';
    console.log('  [' + status + '] ' + e.name + '  "' + e.schedule + '"  cmd="' + e.command + '"');
  }
}

export function cronSetEnabled(flags: Record<string, string>, enabled: boolean): void {
  const name = flags['name'];
  if (!name) { console.error('Error: --name is required'); process.exit(1); }
  const cwd = flags['cwd'] || process.cwd();
  const filePath = path.join(cwd, CRON_FILE);
  const entries = readJsonFile(filePath) as unknown as CronEntry[];
  const entry = entries.find((e) => e.name === name);
  if (!entry) { console.error('Cron job "' + name + '" not found'); process.exit(1); return; }
  entry.enabled = enabled;
  writeJsonFile(filePath, entries);
  notifyJam();
  console.log('Cron "' + name + '" ' + (enabled ? 'enabled' : 'disabled'));
}
