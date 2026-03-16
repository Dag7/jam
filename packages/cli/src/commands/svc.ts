import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../utils/io.js';
import { checkPort, checkHttp } from '../utils/health.js';
import { notifyJam } from '../utils/notify.js';

const SERVICES_FILE = '.services.json';

interface ServiceEntry {
  name: string;
  port: number;
  command: string;
  cwd: string;
  startedAt: string;
  logFile?: string;
  healthPath?: string;
}

export function svcRegister(flags: Record<string, string>): void {
  const name = flags['name'];
  const port = flags['port'] ? parseInt(flags['port'], 10) : undefined;
  const command = flags['command'];
  const cwd = flags['cwd'] || process.cwd();
  const logFile = flags['log'];
  const healthPath = flags['health'];

  if (!name) { console.error('Error: --name is required'); process.exit(1); }
  if (!port || !Number.isFinite(port)) { console.error('Error: --port is required (number)'); process.exit(1); }
  if (!command) { console.error('Error: --command is required'); process.exit(1); }

  const filePath = path.join(cwd, SERVICES_FILE);
  const entries = readJsonFile(filePath) as unknown as ServiceEntry[];
  const existing = entries.findIndex((e) => e.name === name);
  const entry: ServiceEntry = { port, name, command, cwd, startedAt: new Date().toISOString() };
  if (logFile) entry.logFile = logFile;
  if (healthPath) entry.healthPath = healthPath;

  if (existing >= 0) {
    entries[existing] = entry;
    console.log('Updated service "' + name + '" on port ' + port);
  } else {
    entries.push(entry);
    console.log('Registered service "' + name + '" on port ' + port);
  }
  writeJsonFile(filePath, entries);
  notifyJam();
}

export function svcDeregister(flags: Record<string, string>): void {
  const name = flags['name'];
  if (!name) { console.error('Error: --name is required'); process.exit(1); }
  const cwd = flags['cwd'] || process.cwd();
  const filePath = path.join(cwd, SERVICES_FILE);
  const entries = readJsonFile(filePath) as unknown as ServiceEntry[];
  const filtered = entries.filter((e) => e.name !== name);
  if (filtered.length === entries.length) { console.error('Service "' + name + '" not found'); process.exit(1); }
  writeJsonFile(filePath, filtered);
  notifyJam();
  console.log('Deregistered service "' + name + '"');
}

export function svcList(flags: Record<string, string>): void {
  const cwd = flags['cwd'] || process.cwd();
  const filePath = path.join(cwd, SERVICES_FILE);
  const entries = readJsonFile(filePath) as unknown as ServiceEntry[];
  if (entries.length === 0) { console.log('No services registered'); return; }
  console.log('Services (' + filePath + '):\n');
  for (const e of entries) {
    const health = e.healthPath ? ' [health: ' + e.healthPath + ']' : '';
    console.log('  ' + e.name + '  port=' + e.port + '  cmd="' + e.command + '"' + health);
  }
}

export function svcCheck(flags: Record<string, string>): void {
  const name = flags['name'];
  const port = flags['port'] ? parseInt(flags['port'], 10) : undefined;
  if (!name && !port) { console.error('Error: --name or --port is required'); process.exit(1); }
  const cwd = flags['cwd'] || process.cwd();
  const filePath = path.join(cwd, SERVICES_FILE);
  const entries = readJsonFile(filePath) as unknown as ServiceEntry[];
  const entry = name
    ? entries.find((e) => e.name === name)
    : entries.find((e) => e.port === port);

  if (!entry) {
    if (port) {
      checkPort(port).then((alive) => {
        console.log('Port ' + port + ': ' + (alive ? 'ALIVE' : 'DEAD'));
        process.exit(alive ? 0 : 1);
      });
      return;
    }
    console.error('Service "' + name + '" not found');
    process.exit(1);
    return;
  }

  const check = entry.healthPath ? checkHttp(entry.port, entry.healthPath) : checkPort(entry.port);
  check.then((alive) => {
    const method = entry.healthPath ? 'HTTP ' + entry.healthPath : 'TCP';
    console.log(entry.name + ' (port ' + entry.port + ') [' + method + ']: ' + (alive ? 'HEALTHY' : 'UNHEALTHY'));
    process.exit(alive ? 0 : 1);
  });
}
