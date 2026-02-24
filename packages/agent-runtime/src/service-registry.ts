import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createLogger } from '@jam/core';

const log = createLogger('ServiceRegistry');

const SERVICES_FILE = '.services.json';

export interface TrackedService {
  agentId: string;
  pid: number;
  port?: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
  /** The shell command used to start this service (for restart) */
  command?: string;
  /** Working directory the service was started from */
  cwd?: string;
}

/** Tracks background processes spawned by agents.
 *  Agents write to `.services.json` in their workspace directory.
 *  Jam reads these files to monitor, display, and clean up services. */
export class ServiceRegistry {
  /** Cached services by agentId */
  private services = new Map<string, TrackedService[]>();

  /** Scan an agent's workspace for `.services.json` and update cache.
   *  Checks both the root cwd and immediate subdirectories (agents may
   *  create projects in subdirs that register their own services).
   *  Keeps dead entries visible (alive=false) for restart capability. */
  async scan(agentId: string, cwd: string): Promise<TrackedService[]> {
    // Collect all .services.json paths: root + one level of subdirectories
    const servicePaths: string[] = [];
    const rootPath = join(cwd, SERVICES_FILE);
    if (existsSync(rootPath)) servicePaths.push(rootPath);

    try {
      const SKIP = new Set(['node_modules', '.git', '__pycache__', 'conversations']);
      const dirEntries = await readdir(cwd, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
        const subPath = join(cwd, entry.name, SERVICES_FILE);
        if (existsSync(subPath)) servicePaths.push(subPath);
      }
    } catch { /* cwd might not exist or be unreadable */ }

    if (servicePaths.length === 0) {
      this.services.delete(agentId);
      return [];
    }

    const allEntries: TrackedService[] = [];

    for (const filePath of servicePaths) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        // Derive cwd for this .services.json (the directory it lives in)
        const serviceCwd = filePath.replace(/[/\\]\.services\.json$/, '');

        for (const line of lines) {
          try {
            const raw = JSON.parse(line);
            if (!raw.pid || !raw.name) continue;
            const alive = isProcessAlive(raw.pid);
            allEntries.push({
              agentId,
              pid: raw.pid,
              port: raw.port ?? undefined,
              name: raw.name,
              logFile: raw.logFile ?? undefined,
              startedAt: raw.startedAt ?? new Date().toISOString(),
              alive,
              command: raw.command ?? undefined,
              cwd: raw.cwd ?? serviceCwd,
            });
          } catch { /* skip malformed line */ }
        }
      } catch (err) {
        log.warn(`Failed to read ${filePath}: ${String(err)}`);
      }
    }

    // Deduplicate: keep the latest entry per service name AND per port.
    // Same port = same service even if the name changed between runs.
    const byName = new Map<string, TrackedService>();
    const byPort = new Map<number, TrackedService>();

    // Sort oldest-first so later (newer) entries overwrite earlier ones
    allEntries.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    for (const entry of allEntries) {
      // If this port was already claimed by a newer-named service, evict the old name
      if (entry.port) {
        const prev = byPort.get(entry.port);
        if (prev && prev.name !== entry.name) {
          byName.delete(prev.name);
        }
        byPort.set(entry.port, entry);
      }
      byName.set(entry.name, entry);
    }
    const deduped = Array.from(byName.values());

    this.services.set(agentId, deduped);
    return deduped;
  }

  /** Scan all agents' workspaces */
  async scanAll(agents: Array<{ id: string; cwd?: string }>): Promise<void> {
    await Promise.all(
      agents
        .filter(a => a.cwd)
        .map(a => this.scan(a.id, a.cwd!)),
    );
  }

  /** List all tracked services across all agents */
  list(): TrackedService[] {
    const all: TrackedService[] = [];
    for (const services of this.services.values()) {
      all.push(...services);
    }
    return all;
  }

  /** List services for a specific agent */
  listForAgent(agentId: string): TrackedService[] {
    return this.services.get(agentId) ?? [];
  }

  /** Stop a specific service by PID — marks as dead in cache */
  stopService(pid: number): boolean {
    try {
      process.kill(pid, 'SIGTERM');
      log.info(`Stopped service PID ${pid}`);
      // Mark as dead in cache (keep the entry for restart)
      for (const [agentId, services] of this.services) {
        let changed = false;
        for (const svc of services) {
          if (svc.pid === pid) {
            svc.alive = false;
            changed = true;
          }
        }
        if (changed) this.services.set(agentId, services);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Restart a stopped service by name. Requires `command` + `cwd` in the entry. */
  restartService(serviceName: string): { success: boolean; pid?: number; error?: string } {
    // Find the service entry
    let entry: TrackedService | undefined;
    for (const services of this.services.values()) {
      entry = services.find(s => s.name === serviceName);
      if (entry) break;
    }

    if (!entry) return { success: false, error: 'Service not found' };
    if (!entry.command) return { success: false, error: 'No command recorded — cannot restart' };
    if (entry.alive) return { success: false, error: 'Service is already running' };

    const cwd = entry.cwd || process.cwd();
    const logFile = entry.logFile || `logs/${entry.name}.log`;
    const logPath = join(cwd, logFile);

    try {
      const child = spawn('sh', ['-c', `${entry.command} > ${logPath} 2>&1`], {
        cwd,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      const newPid = child.pid!;
      log.info(`Restarted service "${entry.name}" (PID ${newPid}) in ${cwd}`);

      // Update the cache entry in-place
      entry.pid = newPid;
      entry.alive = true;
      entry.startedAt = new Date().toISOString();

      // Append new entry to .services.json
      const servicesFile = join(cwd, SERVICES_FILE);
      const line = JSON.stringify({
        pid: newPid,
        port: entry.port,
        name: entry.name,
        command: entry.command,
        cwd,
        logFile,
        startedAt: entry.startedAt,
      });
      writeFile(servicesFile, line + '\n', { flag: 'a' }).catch(() => {});

      return { success: true, pid: newPid };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /** Stop all tracked services for a specific agent */
  stopForAgent(agentId: string): void {
    const services = this.services.get(agentId) ?? [];
    for (const svc of services) {
      try {
        process.kill(svc.pid, 'SIGTERM');
        log.info(`Stopped service "${svc.name}" (PID ${svc.pid}) for agent ${agentId}`);
      } catch { /* already dead */ }
    }
    this.services.delete(agentId);
  }

  /** Stop ALL tracked services across all agents */
  stopAll(): void {
    for (const [agentId, services] of this.services) {
      for (const svc of services) {
        try {
          process.kill(svc.pid, 'SIGTERM');
          log.info(`Stopped service "${svc.name}" (PID ${svc.pid}) for agent ${agentId}`);
        } catch { /* already dead */ }
      }
    }
    this.services.clear();
  }
}

/** Check if a process is alive */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
