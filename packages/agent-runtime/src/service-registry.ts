import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createLogger, IntervalTimer, TimeoutTimer } from '@jam/core';
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
const SCAN_SKIP = new Set(['node_modules', '.git', '__pycache__', 'conversations', 'venv', '.venv', 'dist', 'build', 'agents', 'team', 'shared-skills']);

export interface TrackedService {
  agentId: string;
  /** Port the service listens on inside the container (or host in native mode) — primary identifier */
  port: number;
  /** Port on the host that maps to `port` — use this for browser access.
   *  In native mode this equals `port`. In Docker mode it's the host-mapped port. */
  hostPort: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
  /** The shell command used to start this service (for restart) */
  command?: string;
  /** Working directory the service was started from */
  cwd?: string;
  /** HTTP healthcheck path (e.g. "/healthz"). When set, health checks use HTTP GET instead of TCP connect. */
  healthPath?: string;
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
  /** Health-check a port inside the container (avoids host port mapping issues) */
  healthCheckInContainer(agentId: string, port: number, healthPath?: string): Promise<boolean>;
}

/** Listener for service status changes */
export type ServiceChangeListener = (services: TrackedService[]) => void;

export class ServiceRegistry {
  /** Cached services by agentId */
  private services = new Map<string, TrackedService[]>();
  /** Track recently restarted services (name → timestamp) to avoid false-dead during startup */
  private recentRestarts = new Map<string, number>();
  /** Consecutive health check failures per service (key: "agentId:name") */
  private failureCounts = new Map<string, number>();
  /** Health monitor interval handle */
  private readonly healthTimer = new IntervalTimer();
  /** Port resolver for sandbox mode (maps container port → host port) */
  private portResolver: PortResolver = (_agentId, port) => port;
  /** Container operations for sandbox mode (stop/restart inside Docker) */
  private containerOps: ContainerOps | null = null;
  /** Change listeners — notified when any service status changes */
  private changeListeners: ServiceChangeListener[] = [];
  /** Debounce timer for change notifications — coalesces rapid-fire updates */
  private readonly notifyTimer = new TimeoutTimer();
  /** Re-entrance guard — prevents overlapping health check cycles */
  private healthCheckRunning = false;

  /** Register a listener that fires whenever any service status changes */
  onChange(listener: ServiceChangeListener): void {
    this.changeListeners.push(listener);
  }

  /** Notify all change listeners with the full service list (debounced 250ms) */
  private notifyChange(): void {
    if (this.changeListeners.length === 0) return;
    this.notifyTimer.setIfNotSet(() => {
      const all = this.list();
      for (const listener of this.changeListeners) {
        listener(all);
      }
    }, 250);
  }

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
        const serviceCwd = filePath.replace(/[/\\]\.services\.json$/, '');

        // Parse service entries — supports multiple formats:
        // 1. Full JSON: { "services": [...] }
        // 2. Single JSON object: { "port": ..., "name": ... }
        // 3. JSON array: [{ "port": ..., "name": ... }, ...]
        // 4. JSONL: one JSON object per line
        const rawEntries = parseServiceEntries(content);

        for (const raw of rawEntries) {
          if (!raw.port || !raw.name) continue;

          const containerPort = raw.port as number;
          const checkPort = this.portResolver(agentId, containerPort);
          const healthPath = (raw.healthPath as string) ?? undefined;
          let alive: boolean;
          if (this.containerOps) {
            alive = await this.containerOps.healthCheckInContainer(agentId, containerPort, healthPath);
          } else {
            alive = healthPath
              ? await isHttpHealthy(checkPort, healthPath)
              : await isPortAlive(checkPort);
          }

          const restartedAt = this.recentRestarts.get(raw.name as string);
          if (!alive && restartedAt && Date.now() - restartedAt < RESTART_GRACE_MS) {
            alive = true;
          }

          allEntries.push({
            agentId,
            port: raw.port as number,
            hostPort: checkPort,
            name: raw.name as string,
            logFile: (raw.logFile as string) ?? undefined,
            startedAt: (raw.startedAt as string) ?? new Date().toISOString(),
            alive,
            command: (raw.command as string) ?? undefined,
            cwd: (raw.cwd as string) ?? serviceCwd,
            healthPath: (raw.healthPath as string) ?? undefined,
          });
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

    // Only notify listeners when data actually changed — prevents spurious IPC events
    const prev = this.services.get(agentId) ?? [];
    this.services.set(agentId, deduped);
    if (!this.servicesEqual(prev, deduped)) {
      this.notifyChange();
    }
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
    this.notifyChange();
  }

  /** Recursively find .services.json files up to MAX_SCAN_DEPTH */
  private findServiceFiles(dir: string, depth: number): Promise<string[]> {
    return findFiles(dir, SERVICES_FILE, depth);
  }

  /** Find a tracked service entry by its container port */
  private findServiceByPort(port: number): TrackedService | undefined {
    for (const [, services] of this.services) {
      const svc = services.find(s => s.port === port);
      if (svc) return svc;
    }
    return undefined;
  }

  /** Shallow compare two service lists by port, name, alive status, and healthPath */
  private servicesEqual(a: TrackedService[], b: TrackedService[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].port !== b[i].port || a[i].hostPort !== b[i].hostPort || a[i].name !== b[i].name || a[i].alive !== b[i].alive || a[i].healthPath !== b[i].healthPath) return false;
    }
    return true;
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
      const record: Record<string, unknown> = {
        port: entry.port,
        name: entry.name,
        command: entry.command,
        cwd,
        logFile,
        startedAt: entry.startedAt,
      };
      if (entry.healthPath) record.healthPath = entry.healthPath;
      const line = JSON.stringify(record);
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
    this.notifyChange();
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
    log.info(`Health monitor started (interval=${HEALTH_CHECK_INTERVAL_MS}ms, threshold=${FAILURE_THRESHOLD})`);
    this.healthTimer.cancelAndSet(() => {
      this.runHealthChecks().catch((err) =>
        log.warn(`Health check error: ${String(err)}`),
      );
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /** Stop the background health monitor (can be restarted later) */
  stopHealthMonitor(): void {
    this.healthTimer.cancel();
    this.notifyTimer.cancel();
    log.info('Health monitor stopped');
  }

  /** Run a single health check cycle across all cached services */
  private async runHealthChecks(): Promise<void> {
    if (this.healthCheckRunning) return; // Prevent overlapping cycles
    this.healthCheckRunning = true;
    let changed = false;

    for (const [, services] of this.services) {
      for (const svc of services) {
        const key = `${svc.agentId}:${svc.name}`;

        // Skip services in restart grace period
        const restartedAt = this.recentRestarts.get(svc.name);
        if (restartedAt && Date.now() - restartedAt < RESTART_GRACE_MS) {
          continue;
        }

        // Health check — in sandbox mode, check INSIDE the container to avoid
        // host port mapping issues. In native mode, check from the host directly.
        let healthy: boolean;
        if (this.containerOps) {
          healthy = await this.containerOps.healthCheckInContainer(svc.agentId, svc.port, svc.healthPath);
        } else {
          const checkPort = this.portResolver(svc.agentId, svc.port);
          healthy = svc.healthPath
            ? await isHttpHealthy(checkPort, svc.healthPath)
            : await isPortAlive(checkPort);
        }

        if (healthy) {
          // Service is up — reset failure count and mark alive
          if (!svc.alive) {
            log.info(`Service "${svc.name}" (port ${svc.port}) is now alive`);
            changed = true;
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
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.notifyChange();
    }
    this.healthCheckRunning = false;
  }

  /** Stop all tracked services for a specific agent */
  async stopForAgent(agentId: string): Promise<void> {
    const services = this.services.get(agentId) ?? [];
    await Promise.all(services.map(svc => this.killServiceByPort(svc.agentId, svc.port, svc.name)));
    this.services.delete(agentId);
    this.notifyChange();
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

// ── Cron Scanner ───────────────────────────────────────────────

const CRON_FILE = '.cron.json';

/** An agent-defined cron entry read from .cron.json */
export interface AgentCronEntry {
  agentId: string;
  name: string;
  schedule: string;
  command: string;
  cwd: string;
  enabled: boolean;
  createdAt: string;
}

/** Listener for cron definition changes */
export type CronChangeListener = (entries: AgentCronEntry[]) => void;

/**
 * Scans agent workspaces for `.cron.json` files.
 * Reuses the same recursive scanning pattern as ServiceRegistry.
 */
export class CronScanner {
  private entries = new Map<string, AgentCronEntry[]>();
  private changeListeners: CronChangeListener[] = [];
  private readonly notifyTimer = new TimeoutTimer();

  onChange(listener: CronChangeListener): void {
    this.changeListeners.push(listener);
  }

  private notifyChange(): void {
    if (this.changeListeners.length === 0) return;
    this.notifyTimer.setIfNotSet(() => {
      const all = this.list();
      for (const listener of this.changeListeners) {
        listener(all);
      }
    }, 250);
  }

  /** Scan an agent's workspace for .cron.json files */
  async scan(agentId: string, cwd: string): Promise<AgentCronEntry[]> {
    const cronPaths = await findFiles(cwd, CRON_FILE, 0);

    if (cronPaths.length === 0) {
      this.entries.delete(agentId);
      return [];
    }

    const allEntries: AgentCronEntry[] = [];

    for (const filePath of cronPaths) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const cronCwd = filePath.replace(/[/\\]\.cron\.json$/, '');
        const rawEntries = parseCronEntries(content);

        for (const raw of rawEntries) {
          if (!raw.name || !raw.schedule || !raw.command) continue;

          allEntries.push({
            agentId,
            name: raw.name as string,
            schedule: raw.schedule as string,
            command: raw.command as string,
            cwd: (raw.cwd as string) ?? cronCwd,
            enabled: raw.enabled !== false,
            createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
          });
        }
      } catch (err) {
        log.warn(`Failed to read ${filePath}: ${String(err)}`);
      }
    }

    // Deduplicate by name (last wins)
    const byName = new Map<string, AgentCronEntry>();
    for (const entry of allEntries) {
      byName.set(entry.name, entry);
    }
    const deduped = Array.from(byName.values());

    const prev = this.entries.get(agentId) ?? [];
    this.entries.set(agentId, deduped);
    if (!this.cronEntriesEqual(prev, deduped)) {
      this.notifyChange();
    }
    return deduped;
  }

  /** Scan all agents' workspaces */
  async scanAll(agents: Array<{ id: string; cwd?: string }>): Promise<void> {
    await Promise.all(
      agents.filter(a => a.cwd).map(a => this.scan(a.id, a.cwd!)),
    );
  }

  /** List all cron entries across all agents */
  list(): AgentCronEntry[] {
    const all: AgentCronEntry[] = [];
    for (const entries of this.entries.values()) {
      all.push(...entries);
    }
    return all;
  }

  /** List cron entries for a specific agent */
  listForAgent(agentId: string): AgentCronEntry[] {
    return this.entries.get(agentId) ?? [];
  }

  /** Remove all entries for an agent (cleanup on delete) */
  removeForAgent(agentId: string): void {
    this.entries.delete(agentId);
  }

  private cronEntriesEqual(a: AgentCronEntry[], b: AgentCronEntry[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].name !== b[i].name || a[i].schedule !== b[i].schedule || a[i].enabled !== b[i].enabled || a[i].command !== b[i].command) return false;
    }
    return true;
  }
}

/** Parse .cron.json content — same format flexibility as services */
function parseCronEntries(content: string): Array<Record<string, unknown>> {
  const trimmed = content.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.crons)) return parsed.crons;
    if (parsed.name && parsed.schedule) return [parsed];
    return [];
  } catch {
    const entries: Array<Record<string, unknown>> = [];
    for (const line of trimmed.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try { entries.push(JSON.parse(l)); } catch { /* skip */ }
    }
    return entries;
  }
}

/** Recursively find files by name up to MAX_SCAN_DEPTH */
async function findFiles(dir: string, fileName: string, depth: number): Promise<string[]> {
  const results: string[] = [];
  const filePath = join(dir, fileName);
  try { await access(filePath); results.push(filePath); } catch { /* not found */ }
  if (depth >= MAX_SCAN_DEPTH) return results;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SCAN_SKIP.has(entry.name)) continue;
      const subResults = await findFiles(join(dir, entry.name), fileName, depth + 1);
      results.push(...subResults);
    }
  } catch { /* dir might not exist or be unreadable */ }
  return results;
}

// ── Parsing Helpers ────────────────────────────────────────────

/** Parse .services.json content into an array of service entries.
 *  Handles: JSON object with `services` array, plain JSON array,
 *  single JSON object, or JSONL (one JSON object per line). */
function parseServiceEntries(content: string): Array<Record<string, unknown>> {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Try parsing as a single JSON document first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.services)) return parsed.services;
    if (parsed.port && parsed.name) return [parsed];
    return [];
  } catch {
    // Not valid JSON as a whole — fall back to JSONL (line-by-line)
    const entries: Array<Record<string, unknown>> = [];
    for (const line of trimmed.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try { entries.push(JSON.parse(l)); } catch { /* skip */ }
    }
    return entries;
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

/** Check service health via HTTP GET — returns true if status 2xx/3xx */
function isHttpHealthy(port: number, path: string, timeoutMs = 3000): Promise<boolean> {
  const http = require('node:http') as typeof import('node:http');
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, timeout: timeoutMs }, (res) => {
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400);
      res.resume(); // drain response body
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
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
