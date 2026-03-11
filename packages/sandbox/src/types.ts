// Re-export domain types from @jam/core (single source of truth)
export type { ContainerInfo, CreateContainerOptions } from '@jam/core';

export type ContainerExitBehavior = 'stop' | 'delete' | 'keep-running';

export type NetworkPolicy = 'unrestricted' | 'host-bridge-only';

/** Where agent CLI processes run when Docker sandbox is active */
export type AgentExecution = 'host' | 'container';

/** Virtual desktop configuration for computer-use agents */
export interface ComputerUseConfig {
  /** Enable virtual desktop in Docker containers (default: false) */
  enabled: boolean;
  /** Screen resolution (default: '1920x1080') */
  resolution: string;
  /** Enable noVNC web viewer for dashboard (default: true) */
  noVncEnabled: boolean;
}

export interface SandboxConfig {
  /** Whether sandbox mode is enabled */
  enabled: boolean;
  /** CPU limit per container (Docker --cpus) */
  cpus: number;
  /** Memory limit in MB per container (Docker --memory) */
  memoryMb: number;
  /** Max number of processes per container (Docker --pids-limit) */
  pidsLimit: number;
  /** First host port in the mapped range */
  portRangeStart: number;
  /** Number of ports allocated per agent */
  portsPerAgent: number;
  /** Docker image name for agent containers */
  imageName: string;
  /** Seconds to wait for container stop before killing */
  stopTimeoutSec: number;
  /** Port for the host bridge HTTP server (agents call from containers) */
  hostBridgePort: number;
  /** What to do with containers on app exit: stop (default), delete, or keep-running */
  containerExitBehavior: ContainerExitBehavior;
  /** Enable seccomp BPF syscall filtering (default: true) */
  seccompEnabled: boolean;
  /** Network egress policy: unrestricted (default) or host-bridge-only (blocks external) */
  networkPolicy: NetworkPolicy;
  /** Disk quota per container in MB (0 = unlimited; requires overlay2 storage driver) */
  diskQuotaMb: number;
  /** Path for audit log file (JSONL). Empty string = disabled. */
  auditLogPath: string;
  /** Virtual desktop configuration for computer-use agents */
  computerUse: ComputerUseConfig;
  /** Where agent CLI runs: 'container' (full isolation via docker exec) or 'host' (native, services in container) */
  agentExecution: AgentExecution;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: false,
  cpus: 2,
  memoryMb: 4096,
  pidsLimit: 256,
  portRangeStart: 10_000,
  portsPerAgent: 20,
  imageName: 'jam-agent:latest',
  stopTimeoutSec: 10,
  hostBridgePort: 19_876,
  containerExitBehavior: 'stop',
  seccompEnabled: true,
  networkPolicy: 'unrestricted',
  diskQuotaMb: 0,
  auditLogPath: '',
  computerUse: {
    enabled: false,
    resolution: '1920x1080',
    noVncEnabled: true,
  },
  agentExecution: 'container',
};
