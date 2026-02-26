import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createLogger } from '@jam/core';
import treeKill from 'tree-kill';

const log = createLogger('ServiceRegistry');

const SERVICES_FILE = '.services.json';

/** Grace period (ms) after restart during which we trust the service is alive */
const RESTART_GRACE_MS = 10_000;
/** How often the health monitor checks services (ms) */
const HEALTH_CHECK_INTERVAL_MS = 8_000;
/** Consecutive failures before marking a service as dead */
const FAILURE_THRESHOLD = 3;
/** Maximum directory depth when scanning for .services.json */
const MAX_SCAN_DEPTH = 3;
/** Directories to skip during recursive scan */
const SCAN_SKIP = new Set(['node_modules', '.git', '__pycache__', 'conversations', 'venv', '.venv', 'dist', 'build']);

export interface TrackedService {
  agentId: string;
  /** Port the service listens on — primary identifier */
  port: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
  /** The shell command used to start this service (for restart) */
  command?: string;
  /** Working directory the service was started from */
  cwd?: string;
}

/** Resolves container ports to host ports (for Docker sandbox mode).
 *  Default: returns the port as-is (native mode). */
export type PortResolver = (agentId: string, containerPort: number) => number;

/** Container operations for sandbox mode — stop/restart services inside Docker */
export interface ContainerOps {
  /** Kill process listening on containerPort inside the agent's container */
  killInContainer(agentId: string, containerPort: number): Promise<boolean>;
  /** Restart a command inside the agent's container (detached) */
  restartInContainer(agentId: string, command: string, cwd: string): Promise<boolean>;
}

export class ServiceRegistry {
  /** Cached services by agentId */
  private services = new Map<string, TrackedService[]>();
  /** Track recently restarted services (name → timestamp) to avoid false-dead during startup */
  private recentRestarts = new Map<string, number>();
  /** Consecutive health check failures per service (key: "agentId:name") */
  private failureCounts = new Map<string, number>();
  /** Health monitor interval handle */
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  /** Port resolver for sandbox mode (maps container port → host port) */
  private portResolver: PortResolver = (_agentId, port) => port;
  /** Container operations for sandbox mode (stop/restart inside Docker) */
  private containerOps: ContainerOps | null = null;

  /** Set a custom port resolver (for Docker sandbox mode) */
  setPortResolver(resolver: PortResolver): void {
    this.portResolver = resolver;
  }

  /** Set container operations for sandbox mode */
  setContainerOps(ops: ContainerOps): void {
    this.containerOps = ops;
  }

  /** Scan an agent's workspace for `.services.json` and update cache.
   *  Recursively checks up to MAX_SCAN_DEPTH levels of subdirectories
   *  (agents may create projects in nested subdirs that register their
   *  own services). Keeps dead entries visible (alive=false) for restart. */
  async scan(agentId: string, cwd: string): Promise<TrackedService[]> {
    // Recursively collect all .services.json paths
    const servicePaths = await this.findServiceFiles(cwd, 0);

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
            // Port is required — services without a port can't be tracked
            if (!raw.port || !raw.name) continue;

            // Check if port is responding (primary alive indicator)
            // In sandbox mode, resolve container port → host port for the check
            const checkPort = this.portResolver(agentId, raw.port);
            let alive = await isPortAlive(checkPort);

            // During the grace period after restart, trust the service is alive
            const restartedAt = this.recentRestarts.get(raw.name);
            if (!alive && restartedAt && Date.now() - restartedAt < RESTART_GRACE_MS) {
              alive = true;
            }

            allEntries.push({
              agentId,
              port: raw.port,
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
      const prev = byPort.get(entry.port);
      if (prev && prev.name !== entry.name) {
        byName.delete(prev.name);
      }
      byPort.set(entry.port, entry);
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

  /** Stop a service by port — kills inside container (sandbox) or via lsof (native) */
  async stopService(port: number): Promise<boolean> {
    // In sandbox mode, kill the process inside the container
    if (this.containerOps) {
      const svc = this.findServiceByPort(port);
      if (svc) {
        const ok = await this.containerOps.killInContainer(svc.agentId, port);
        if (ok) {
          log.info(`Stopped service "${svc.name}" on container port ${port} via docker exec`);
          this.markServiceDead(port);
          return true;
        }
      }
      log.warn(`Failed to stop service on container port ${port}`);
      return false;
    }

    // Native mode: find PID on host via lsof
    const pid = await findPidByPort(port);
    if (!pid) {
      log.warn(`No process found listening on port ${port}`);
      return false;
    }
    try {
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) log.warn(`tree-kill failed for service on port ${port} (PID ${pid}): ${err.message}`);
      });
      log.info(`Stopped service on port ${port} (PID ${pid})`);
      this.markServiceDead(port);
      return true;
    } catch {
      return false;
    }
  }

  /** Mark a service as dead in cache by port */
  private markServiceDead(port: number): void {
    for (const [, services] of this.services) {
      for (const svc of services) {
        if (svc.port === port) {
          svc.alive = false;
          this.failureCounts.delete(`${svc.agentId}:${svc.name}`);
        }
      }
    }
  }

  /** Recursively find .services.json files up to MAX_SCAN_DEPTH */
  private async findServiceFiles(dir: string, depth: number): Promise<string[]> {
    const results: string[] = [];
    const filePath = join(dir, SERVICES_FILE);
    if (existsSync(filePath)) results.push(filePath);
    if (depth >= MAX_SCAN_DEPTH) return results;

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || SCAN_SKIP.has(entry.name)) continue;
        const subResults = await this.findServiceFiles(join(dir, entry.name), depth + 1);
        results.push(...subResults);
      }
    } catch { /* dir might not exist or be unreadable */ }
    return results;
  }

  /** Find a tracked service entry by its container port */
  private findServiceByPort(port: number): TrackedService | undefined {
    for (const [, services] of this.services) {
      const svc = services.find(s => s.port === port);
      if (svc) return svc;
    }
    return undefined;
  }

  /** Restart a stopped service by name. Requires `command` + `cwd` in the entry. */
  async restartService(serviceName: string): Promise<{ success: boolean; error?: string }> {
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

    // In sandbox mode, restart inside the container
    if (this.containerOps) {
      const ok = await this.containerOps.restartInContainer(entry.agentId, entry.command, cwd);
      if (!ok) return { success: false, error: 'Failed to restart inside container' };
      log.info(`Restarted service "${entry.name}" on port ${entry.port} inside container`);
      this.markServiceRestarted(entry);
      return { success: true };
    }

    // Native mode: spawn on host
    const logFile = entry.logFile || `logs/${entry.name}.log`;
    const logPath = resolve(cwd, logFile);
    if (!logPath.startsWith(resolve(cwd))) {
      return { success: false, error: 'Log file path escapes working directory' };
    }

    try {
      const child = spawn('sh', ['-c', `exec ${entry.command}`], {
        cwd,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      child.unref();

      log.info(`Restarted service "${entry.name}" on port ${entry.port} in ${cwd}`);
      this.markServiceRestarted(entry);

      // Append new entry to .services.json (port-based, no PID)
      const servicesFile = join(cwd, SERVICES_FILE);
      const line = JSON.stringify({
        port: entry.port,
        name: entry.name,
        command: entry.command,
        cwd,
        logFile,
        startedAt: entry.startedAt,
      });
      writeFile(servicesFile, line + '\n', { flag: 'a' }).catch(() => {});

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /** Update cache after a service restart */
  private markServiceRestarted(entry: TrackedService): void {
    entry.alive = true;
    entry.startedAt = new Date().toISOString();
    this.recentRestarts.set(entry.name, Date.now());
    this.failureCounts.delete(`${entry.agentId}:${entry.name}`);
  }

  /** Resolve a container port to the host port for browser access.
   *  Returns the port as-is if no resolver is set or service not found. */
  resolvePortForBrowser(containerPort: number): number {
    const svc = this.findServiceByPort(containerPort);
    if (!svc) return containerPort;
    return this.portResolver(svc.agentId, containerPort);
  }

  // ── Health Monitor ──────────────────────────────────────────────

  /** Start the background health monitor.
   *  Checks all cached services on an interval, using consecutive failure
   *  thresholds to avoid flicker from transient check failures. */
  startHealthMonitor(): void {
    if (this.healthInterval) return;
    log.info(`Health monitor started (interval=${HEALTH_CHECK_INTERVAL_MS}ms, threshold=${FAILURE_THRESHOLD})`);
    this.healthInterval = setInterval(() => {
      this.runHealthChecks().catch((err) =>
        log.warn(`Health check error: ${String(err)}`),
      );
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /** Stop the background health monitor */
  stopHealthMonitor(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
      log.info('Health monitor stopped');
    }
  }

  /** Run a single health check cycle across all cached services */
  private async runHealthChecks(): Promise<void> {
    for (const [, services] of this.services) {
      for (const svc of services) {
        const key = `${svc.agentId}:${svc.name}`;

        // Skip services in restart grace period
        const restartedAt = this.recentRestarts.get(svc.name);
        if (restartedAt && Date.now() - restartedAt < RESTART_GRACE_MS) {
          continue;
        }

        // Port-based health check — resolve to host port in sandbox mode
        const checkPort = this.portResolver(svc.agentId, svc.port);
        const healthy = await isPortAlive(checkPort);

        if (healthy) {
          // Service is up — reset failure count and mark alive
          if (!svc.alive) {
            log.info(`Service "${svc.name}" (port ${svc.port}) is now alive`);
          }
          svc.alive = true;
          this.failureCounts.delete(key);
        } else {
          // Service check failed — increment failure counter
          const failures = (this.failureCounts.get(key) ?? 0) + 1;
          this.failureCounts.set(key, failures);

          if (failures >= FAILURE_THRESHOLD && svc.alive !== false) {
            log.warn(`Service "${svc.name}" (port ${svc.port}) marked dead after ${failures} consecutive failures`);
            svc.alive = false;
          }
        }
      }
    }
  }

  /** Stop all tracked services for a specific agent */
  async stopForAgent(agentId: string): Promise<void> {
    const services = this.services.get(agentId) ?? [];
    await Promise.all(services.map(svc => this.killServiceByPort(svc.agentId, svc.port, svc.name)));
    this.services.delete(agentId);
  }

  /** Stop ALL tracked services across all agents */
  async stopAll(): Promise<void> {
    this.stopHealthMonitor();
    const kills: Promise<void>[] = [];
    for (const [, services] of this.services) {
      for (const svc of services) {
        kills.push(this.killServiceByPort(svc.agentId, svc.port, svc.name));
      }
    }
    await Promise.all(kills);
    this.services.clear();
  }

  /** Kill a service — uses containerOps in sandbox mode, lsof on host in native mode */
  private async killServiceByPort(agentId: string, port: number, name: string): Promise<void> {
    if (this.containerOps) {
      await this.containerOps.killInContainer(agentId, port);
      log.info(`Stopped service "${name}" on container port ${port} via docker exec`);
      return;
    }

    const pid = await findPidByPort(port);
    if (!pid) return;

    treeKill(pid, 'SIGTERM', (err) => {
      if (err) log.warn(`tree-kill failed for "${name}" (PID ${pid}, port ${port}): ${err.message}`);
      else log.info(`Stopped service "${name}" (PID ${pid}, port ${port})`);
    });
  }
}

/** Check if a port is reachable via TCP connect (health check) */
function isPortAlive(port: number, timeoutMs = 2000): Promise<boolean> {
  const { createConnection } = require('node:net') as typeof import('node:net');
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
  });
}

/** Find the PID listening on a given port using lsof (non-blocking).
 *  Uses `-sTCP:LISTEN` to only match the server process (not clients).
 *  Excludes our own PID to prevent self-kill. */
function findPidByPort(port: number): Promise<number | null> {
  const ownPid = process.pid;
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf-8', timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const pids = stdout.trim().split('\n')
          .map((l: string) => parseInt(l.trim(), 10))
          .filter((p: number) => Number.isFinite(p) && p !== ownPid);
        resolve(pids.length > 0 ? pids[0] : null);
      },
    );
  });
}
