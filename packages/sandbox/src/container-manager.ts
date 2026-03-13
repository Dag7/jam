import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { IContainerManager, IPortAllocator } from '@jam/core';
import type { ContainerInfo, CreateContainerOptions } from '@jam/core';
import { createLogger } from '@jam/core';
import type { DockerClient } from './docker-client.js';
import type { SandboxConfig } from './types.js';
import { serializeSeccompProfile } from './seccomp-profile.js';

const log = createLogger('ContainerManager');

/** Label key for agent ID — matches DockerClient.LABEL_AGENT_ID */
const LABEL_AGENT_ID = 'com.jam.agent-id';
/** Container name prefix — matches DockerClient convention */
const CONTAINER_PREFIX = 'jam-';

/** Well-known container ports for desktop services */
const COMPUTER_USE_CONTAINER_PORT = 3100;
const NOVNC_CONTAINER_PORT = 6080;

/** Sanitize agent name for use as a Docker container name */
function sanitizeName(agentName: string): string {
  return (
    CONTAINER_PREFIX +
    agentName
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

/**
 * Manages Docker container lifecycle for agent sandboxing.
 * One long-lived container per agent — created on start, removed on stop.
 */
export class ContainerManager implements IContainerManager {
  private containers = new Map<string, ContainerInfo>();
  /** Track named volumes per agent so we can clean them up on removal */
  private volumeNames = new Map<string, string[]>();

  constructor(
    private readonly docker: DockerClient,
    private readonly portAllocator: IPortAllocator,
    private readonly config: SandboxConfig,
  ) {}

  /** Create and start a container for an agent */
  async createAndStart(options: CreateContainerOptions): Promise<ContainerInfo> {
    const { agentId, agentName } = options;

    // If container already exists, return it
    const existing = this.containers.get(agentId);
    if (existing && existing.status === 'running') {
      // For desktop containers (reclaimed or reused), verify the computer-use
      // server is still reachable — it may have crashed or not yet started after
      // a container reclaim (hot-reload).
      if (existing.portMappings.has(COMPUTER_USE_CONTAINER_PORT)) {
        await this.waitForComputerUse(existing.containerId, COMPUTER_USE_CONTAINER_PORT);
      }
      return existing;
    }

    const containerName = sanitizeName(agentName);

    // Remove any stale container with the same name
    this.docker.removeContainer(containerName);

    // Allocate port range
    const portMappings = this.portAllocator.buildPortMappings(agentId);

    // Determine if this is a desktop container (computer-use enabled)
    const isDesktop = options.computerUse && this.config.computerUse.enabled;

    // Build volume mounts
    const volumes: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }> = [
      { hostPath: options.workspacePath, containerPath: '/workspace' },
    ];

    if (options.sharedSkillsPath) {
      volumes.push({ hostPath: options.sharedSkillsPath, containerPath: '/shared-skills', readOnly: true });
    }

    // Shared team directory — inter-agent communication (blackboard, channels)
    if (options.teamDirPath) {
      if (!existsSync(options.teamDirPath)) {
        mkdirSync(options.teamDirPath, { recursive: true });
      }
      volumes.push({ hostPath: options.teamDirPath, containerPath: '/team' });
    }

    // Credential mounts (read-only)
    if (options.credentialMounts) {
      for (const mount of options.credentialMounts) {
        volumes.push({ hostPath: mount.hostPath, containerPath: mount.containerPath, readOnly: true });
      }
    }

    // Auto-detect common credential directories
    // Container runs as 'agent' user (home = /home/agent), not root
    // These are read-write so agent CLIs can refresh tokens, save sessions, etc.
    const home = homedir();
    const agentHome = '/home/agent';
    // Note: ~/.claude.json is NOT mounted — single-file Docker bind mounts get stale
    // when the host atomically rewrites the file (new inode). Claude Code recreates it.
    const credentialDirs = [
      { host: join(home, '.claude'), container: `${agentHome}/.claude` },
      { host: join(home, '.config', 'opencode'), container: `${agentHome}/.config/opencode` },
      { host: join(home, '.codex'), container: `${agentHome}/.codex` },
      { host: join(home, '.cursor-agent'), container: `${agentHome}/.cursor-agent` },
    ];
    for (const cred of credentialDirs) {
      try {
        const { existsSync } = await import('node:fs');
        if (existsSync(cred.host)) {
          volumes.push({ hostPath: cred.host, containerPath: cred.container });
        }
      } catch { /* skip if not accessible */ }
    }

    // Desktop containers: replace standard port slots with well-known desktop ports
    // Must happen BEFORE creating the ContainerInfo Map snapshot
    if (isDesktop) {
      // Computer-use API (3100) — replace second-to-last slot
      if (portMappings.length >= 2) {
        portMappings[portMappings.length - 2].containerPort = COMPUTER_USE_CONTAINER_PORT;
      }
      // noVNC viewer (6080) — replace last slot
      if (this.config.computerUse.noVncEnabled && portMappings.length >= 1) {
        portMappings[portMappings.length - 1].containerPort = NOVNC_CONTAINER_PORT;
      }
    }

    const info: ContainerInfo = {
      containerId: '',
      agentId,
      agentName,
      status: 'creating',
      portMappings: new Map(portMappings.map((pm) => [pm.containerPort, pm.hostPort])),
    };

    // Named volumes — persist agent-installed packages/tools across container restarts
    const safeName = containerName.replace(/[^a-z0-9_-]/g, '-');
    const namedVolumes = [
      { volumeName: `${safeName}-local`, containerPath: `${agentHome}/.local` },
      { volumeName: `${safeName}-cache`, containerPath: `${agentHome}/.cache` },
      { volumeName: `${safeName}-config`, containerPath: `${agentHome}/.config` },
    ];

    // Write seccomp profile to disk if enabled
    let seccompProfile: string | undefined;
    if (this.config.seccompEnabled) {
      const seccompDir = join(homedir(), '.jam');
      if (!existsSync(seccompDir)) mkdirSync(seccompDir, { recursive: true });
      const seccompPath = join(seccompDir, 'seccomp-default.json');
      if (!existsSync(seccompPath)) {
        writeFileSync(seccompPath, serializeSeccompProfile(), 'utf-8');
        log.info(`Wrote seccomp profile to ${seccompPath}`);
      }
      seccompProfile = seccompPath;
    }

    // Desktop containers: inject environment and change entrypoint
    const containerEnv = { ...options.env };
    let command: string[];
    let pidsLimit = this.config.pidsLimit;

    if (isDesktop) {
      containerEnv.DISPLAY = ':99';
      containerEnv.JAM_COMPUTER_USE = '1';
      containerEnv.COMPUTER_USE_PORT = String(COMPUTER_USE_CONTAINER_PORT);
      containerEnv.SCREEN_RESOLUTION = this.config.computerUse.resolution;
      command = ['/usr/local/bin/start-desktop.sh'];
      // Desktop needs more processes (Xvfb, fluxbox, x11vnc, noVNC, computer-use server)
      pidsLimit = Math.max(pidsLimit, 512);
      log.info(`Desktop container for "${agentName}" — resolution ${this.config.computerUse.resolution}`);
    } else {
      command = ['sleep', 'infinity'];
    }

    // Track named volumes for cleanup
    this.volumeNames.set(agentId, namedVolumes.map(v => v.volumeName));

    try {
      // Create the container
      const containerId = this.docker.createContainer({
        name: containerName,
        image: this.config.imageName,
        labels: {
          [LABEL_AGENT_ID]: agentId,
        },
        cpus: this.config.cpus,
        memoryMb: this.config.memoryMb,
        pidsLimit,
        volumes,
        namedVolumes,
        portMappings,
        workdir: '/workspace',
        env: containerEnv,
        command,
        seccompProfile,
        diskQuotaMb: this.config.diskQuotaMb || undefined,
        // Desktop containers need larger shared memory for Chromium/Playwright
        shmSizeMb: isDesktop ? 512 : undefined,
      });

      info.containerId = containerId;

      // Start the container
      this.docker.startContainer(containerId);
      info.status = 'running';

      this.containers.set(agentId, info);
      log.info(`Container started for agent "${agentName}" (${containerId.slice(0, 12)})`);

      // Desktop containers: wait for computer-use server to be ready before returning
      // This prevents the agent PTY from starting before the desktop services are up
      if (isDesktop) {
        await this.waitForComputerUse(containerId, COMPUTER_USE_CONTAINER_PORT);
      }

      return info;
    } catch (error) {
      info.status = 'stopped';
      // Clean up partially-created container so nothing is orphaned
      if (info.containerId) {
        log.warn(`Cleaning up partially-created container for "${agentName}"`);
        this.docker.removeContainer(info.containerId);
      }
      this.portAllocator.release(agentId);
      this.volumeNames.delete(agentId);
      log.error(`Failed to create/start container for agent "${agentName}": ${String(error)}`);
      throw error;
    }
  }

  /** Stop and remove a container for an agent (full cleanup including volumes) */
  stop(agentId: string): void {
    const info = this.containers.get(agentId);
    if (!info) return;

    info.status = 'stopping';
    log.info(`Stopping container for agent "${info.agentName}" (${info.containerId.slice(0, 12)})`);

    this.docker.stopContainer(info.containerId, this.config.stopTimeoutSec);
    this.docker.removeContainer(info.containerId);
    this.cleanupVolumes(agentId);
    this.portAllocator.release(agentId);
    this.containers.delete(agentId);

    log.info(`Container removed for agent "${info.agentName}"`);
  }

  /** Stop all containers without removing them (fast reclaim on next startup) */
  stopAll(): void {
    for (const [agentId, info] of this.containers) {
      info.status = 'stopping';
      log.info(`Stopping container for agent "${info.agentName}" (${info.containerId.slice(0, 12)})`);
      this.docker.stopContainer(info.containerId, this.config.stopTimeoutSec);
      this.portAllocator.release(agentId);
    }
    this.containers.clear();
    // Note: volumes are NOT cleaned on stopAll — containers may be reclaimed on restart
  }

  /** Stop and remove all containers (full cleanup including volumes) */
  removeAll(): void {
    for (const [agentId] of this.containers) {
      this.stop(agentId);
    }
  }

  /** Wait for the computer-use HTTP server inside a desktop container to be ready.
   *  If the server is not responding, attempt to restart it (handles reclaimed
   *  containers where the server may have crashed). */
  private async waitForComputerUse(containerId: string, port: number): Promise<void> {
    const ready = await this.pollComputerUse(containerId, port, 10);
    if (ready) return;

    // Server not responding — try restarting it (e.g. reclaimed container where it crashed)
    log.warn('Computer-use server not responding — attempting restart');
    try {
      execFileSync('docker', [
        'exec', '-d', containerId, 'sh', '-c',
        `cd /opt/computer-use && npx tsx src/cli.ts --port ${port} --display 99 &`,
      ], { timeout: 5000, stdio: 'ignore' });
    } catch {
      log.warn('Failed to restart computer-use server');
    }

    // Wait again after restart attempt
    const readyAfterRestart = await this.pollComputerUse(containerId, port, 20);
    if (!readyAfterRestart) {
      log.warn('Computer-use server did not become ready after restart — agent will start anyway');
    }
  }

  /** Poll the computer-use server inside a container. Returns true if it responds. */
  private pollComputerUse(containerId: string, port: number, attempts: number): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('docker', [
        'exec', containerId, 'sh', '-c',
        `for i in $(seq 1 ${attempts}); do curl -sf http://127.0.0.1:${port}/status >/dev/null 2>&1 && exit 0; sleep 0.5; done; exit 1`,
      ], { stdio: 'ignore' });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve(false);
      }, (attempts + 2) * 500);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          log.info('Computer-use server ready');
        }
        resolve(code === 0);
      });
    });
  }

  /** Remove named Docker volumes associated with an agent */
  private cleanupVolumes(agentId: string): void {
    const volumes = this.volumeNames.get(agentId);
    if (!volumes) return;
    for (const name of volumes) {
      this.docker.removeVolume(name);
    }
    this.volumeNames.delete(agentId);
    log.info(`Cleaned up ${volumes.length} named volume(s) for agent ${agentId}`);
  }

  /**
   * Reclaim running containers from a previous session (e.g. after hot reload).
   * Instead of destroying and recreating, re-adopt existing containers into
   * the in-memory map so they can be reused immediately.
   *
   * Stopped/exited containers are removed (crash recovery).
   * Returns the set of agent IDs whose containers were reclaimed.
   */
  reclaimExisting(): Set<string> {
    const existing = this.docker.listJamContainers();
    if (existing.length === 0) return new Set();

    const reclaimed = new Set<string>();
    for (const container of existing) {
      const isRunning = container.status.startsWith('Up');

      if (isRunning && container.agentId) {
        // Kill orphaned agent processes from the crashed session — prevents
        // double-process issues when new PTYs are spawned into reclaimed containers.
        this.docker.killOrphanedProcesses(container.id);

        // Inspect actual Docker port mappings so the port resolver matches reality
        const actualMappings = this.docker.getPortMappings(container.id);
        log.info(`Reclaiming running container "${container.name}" for agent ${container.agentId} (${actualMappings.size} port mappings, orphans killed)`);
        this.containers.set(container.agentId, {
          containerId: container.id,
          agentId: container.agentId,
          agentName: container.name.replace(/^jam-/, ''),
          status: 'running',
          portMappings: actualMappings,
        });
        // Re-register the port allocation using actual mappings (not computed)
        this.portAllocator.reclaim(container.agentId, actualMappings);
        reclaimed.add(container.agentId);
      } else {
        log.info(`Removing stopped container "${container.name}"`);
        this.docker.removeContainer(container.id);
      }
    }

    if (reclaimed.size > 0) {
      log.info(`Reclaimed ${reclaimed.size} running container(s) from previous session`);
    }
    return reclaimed;
  }

  /** Get the container ID for an agent */
  getContainerId(agentId: string): string | undefined {
    return this.containers.get(agentId)?.containerId;
  }

  /** Check if an agent has a running container */
  isRunning(agentId: string): boolean {
    const info = this.containers.get(agentId);
    return info?.status === 'running';
  }

  /** Get info about all managed containers */
  listContainers(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /** Get the host port for the noVNC viewer (if desktop container) */
  getNoVncPort(agentId: string): number | undefined {
    const info = this.containers.get(agentId);
    if (!info) return undefined;
    return info.portMappings.get(NOVNC_CONTAINER_PORT);
  }

  /** Get the host port for the computer-use API (if desktop container) */
  getComputerUsePort(agentId: string): number | undefined {
    const info = this.containers.get(agentId);
    if (!info) return undefined;
    return info.portMappings.get(COMPUTER_USE_CONTAINER_PORT);
  }
}
