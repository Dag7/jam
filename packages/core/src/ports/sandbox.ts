import type { AgentProfile } from '../models/agent.js';

/** Container info returned by container manager operations */
export interface ContainerInfo {
  containerId: string;
  agentId: string;
  agentName: string;
  status: 'creating' | 'running' | 'stopping' | 'stopped';
  portMappings: Map<number, number>;
}

/** Options for creating an agent container */
export interface CreateContainerOptions {
  agentId: string;
  agentName: string;
  workspacePath: string;
  sharedSkillsPath?: string;
  credentialMounts?: Array<{ hostPath: string; containerPath: string }>;
  env?: Record<string, string>;
}

/** Manages Docker container lifecycle for agent sandboxing */
export interface IContainerManager {
  createAndStart(options: CreateContainerOptions): Promise<ContainerInfo>;
  stop(agentId: string): void;
  /** Stop all containers without removing them (fast reclaim on next startup) */
  stopAll(): void;
  /** Stop and remove all containers (full cleanup) */
  removeAll(): void;
  /** Reclaim running containers from a previous session. Returns reclaimed agent IDs. */
  reclaimExisting(): Set<string>;
  getContainerId(agentId: string): string | undefined;
  isRunning(agentId: string): boolean;
  listContainers(): ContainerInfo[];
}

/** Thin wrapper around Docker CLI for container operations */
export interface IDockerClient {
  isAvailable(): boolean;
  imageExists(tag: string): boolean;
  buildImage(contextDir: string, tag: string, onOutput?: (line: string) => void): Promise<void>;
  execInteractiveArgs(
    containerId: string,
    command: string[],
    env: Record<string, string>,
    workdir?: string,
  ): string[];
}

/** Resolves container ports to host ports for Docker sandbox mode */
export interface IPortAllocator {
  allocate(agentId: string): { hostStart: number; containerStart: number; count: number };
  /** Reclaim an allocation from an existing container's actual port mappings */
  reclaim(agentId: string, actualMappings: Map<number, number>): void;
  release(agentId: string): void;
  resolveHostPort(agentId: string, containerPort: number): number | undefined;
  buildPortMappings(agentId: string): Array<{ hostPort: number; containerPort: number }>;
}

/** Ensures the Docker image for agent containers exists */
export interface IImageManager {
  ensureImage(tag: string): Promise<void>;
}

/** Host Bridge — HTTP API for containerized agents to execute whitelisted host operations */
export interface IHostBridge {
  start(token: string): Promise<{ url: string; port: number }>;
  stop(): Promise<void>;
  readonly isListening: boolean;
}
