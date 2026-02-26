import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IContainerManager, IPortAllocator } from '@jam/core';
import type { ContainerInfo, CreateContainerOptions } from '@jam/core';
import { createLogger } from '@jam/core';
import type { DockerClient } from './docker-client.js';
import type { SandboxConfig } from './types.js';

const log = createLogger('ContainerManager');

/** Label key for agent ID — matches DockerClient.LABEL_AGENT_ID */
const LABEL_AGENT_ID = 'com.jam.agent-id';
/** Container name prefix — matches DockerClient convention */
const CONTAINER_PREFIX = 'jam-';

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
      return existing;
    }

    const containerName = sanitizeName(agentName);

    // Remove any stale container with the same name
    this.docker.removeContainer(containerName);

    // Allocate port range
    const portMappings = this.portAllocator.buildPortMappings(agentId);

    // Build volume mounts
    const volumes: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }> = [
      { hostPath: options.workspacePath, containerPath: '/workspace' },
    ];

    if (options.sharedSkillsPath) {
      volumes.push({ hostPath: options.sharedSkillsPath, containerPath: '/shared-skills', readOnly: true });
    }

    // Credential mounts (read-only)
    if (options.credentialMounts) {
      for (const mount of options.credentialMounts) {
        volumes.push({ hostPath: mount.hostPath, containerPath: mount.containerPath, readOnly: true });
      }
    }

    // Auto-detect common credential directories
    // Container runs as 'agent' user (home = /home/agent), not root
    const home = homedir();
    const agentHome = '/home/agent';
    const credentialDirs = [
      { host: join(home, '.claude'), container: `${agentHome}/.claude` },
      { host: join(home, '.claude.json'), container: `${agentHome}/.claude.json` },
      { host: join(home, '.config', 'opencode'), container: `${agentHome}/.config/opencode` },
    ];
    for (const cred of credentialDirs) {
      try {
        const { existsSync } = await import('node:fs');
        if (existsSync(cred.host)) {
          volumes.push({ hostPath: cred.host, containerPath: cred.container, readOnly: true });
        }
      } catch { /* skip if not accessible */ }
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
    ];

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
        pidsLimit: this.config.pidsLimit,
        volumes,
        namedVolumes,
        portMappings,
        workdir: '/workspace',
        env: options.env,
        command: ['sleep', 'infinity'],
      });

      info.containerId = containerId;

      // Start the container
      this.docker.startContainer(containerId);
      info.status = 'running';

      this.containers.set(agentId, info);
      log.info(`Container started for agent "${agentName}" (${containerId.slice(0, 12)})`);

      return info;
    } catch (error) {
      info.status = 'stopped';
      log.error(`Failed to create/start container for agent "${agentName}": ${String(error)}`);
      throw error;
    }
  }

  /** Stop and remove a container for an agent */
  stop(agentId: string): void {
    const info = this.containers.get(agentId);
    if (!info) return;

    info.status = 'stopping';
    log.info(`Stopping container for agent "${info.agentName}" (${info.containerId.slice(0, 12)})`);

    this.docker.stopContainer(info.containerId, this.config.stopTimeoutSec);
    this.docker.removeContainer(info.containerId);
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
  }

  /** Stop and remove all containers (full cleanup) */
  removeAll(): void {
    for (const [agentId] of this.containers) {
      this.stop(agentId);
    }
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
        // Inspect actual Docker port mappings so the port resolver matches reality
        const actualMappings = this.docker.getPortMappings(container.id);
        log.info(`Reclaiming running container "${container.name}" for agent ${container.agentId} (${actualMappings.size} port mappings)`);
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
}
