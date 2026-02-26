import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import type { IDockerClient } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('DockerClient');

/** Container name prefix for all Jam containers */
const CONTAINER_PREFIX = 'jam-';
/** Label key for agent ID (used for cleanup queries) */
const LABEL_AGENT_ID = 'com.jam.agent-id';
/** Label to identify all Jam containers */
const LABEL_APP = 'com.jam.app';

export interface CreateContainerArgs {
  name: string;
  image: string;
  labels: Record<string, string>;
  cpus: number;
  memoryMb: number;
  pidsLimit: number;
  volumes: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  /** Named Docker volumes (persist across container recreations) */
  namedVolumes?: Array<{ volumeName: string; containerPath: string }>;
  portMappings: Array<{ hostPort: number; containerPort: number }>;
  workdir: string;
  env?: Record<string, string>;
  command: string[];
}

export interface ContainerListEntry {
  id: string;
  name: string;
  status: string;
  agentId: string;
}

export class DockerClient implements IDockerClient {
  private readonly docker: string;

  constructor(dockerPath = 'docker') {
    this.docker = dockerPath;
  }

  /** Check if Docker daemon is available */
  isAvailable(): boolean {
    try {
      execFileSync(this.docker, ['info', '--format', '{{.ID}}'], {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if a Docker image exists locally */
  imageExists(tag: string): boolean {
    try {
      execFileSync(this.docker, ['image', 'inspect', tag], {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Build a Docker image from a context directory (async — does NOT block the event loop) */
  buildImage(contextDir: string, tag: string, onOutput?: (line: string) => void): Promise<void> {
    log.info(`Building Docker image ${tag} from ${contextDir}`);
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(this.docker, ['build', '-t', tag, contextDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Stream build output for progress feedback
      const handleData = (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.trim());
        for (const line of lines) {
          log.info(`[docker build] ${line}`);
          onOutput?.(line);
        }
      };
      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', handleData);

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Docker image build timed out after 10 minutes'));
      }, 600_000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          log.info(`Image ${tag} built successfully`);
          resolve();
        } else {
          reject(new Error(`Docker build exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Create a container (does not start it). Returns container ID. */
  createContainer(args: CreateContainerArgs): string {
    const cmdArgs: string[] = ['create'];

    // Name
    cmdArgs.push('--name', args.name);

    // Use tini as PID 1 — proper signal forwarding + zombie reaping
    cmdArgs.push('--init');

    // On Linux, host.docker.internal doesn't resolve by default —
    // add explicit host gateway alias so containers can reach the host bridge
    if (process.platform === 'linux') {
      cmdArgs.push('--add-host', 'host.docker.internal:host-gateway');
    }

    // Labels
    cmdArgs.push('--label', `${LABEL_APP}=true`);
    for (const [key, value] of Object.entries(args.labels)) {
      cmdArgs.push('--label', `${key}=${value}`);
    }

    // Resource limits
    cmdArgs.push('--cpus', String(args.cpus));
    cmdArgs.push('--memory', `${args.memoryMb}m`);
    cmdArgs.push('--pids-limit', String(args.pidsLimit));

    // Bind-mount volumes
    for (const vol of args.volumes) {
      const mode = vol.readOnly ? ':ro' : '';
      cmdArgs.push('-v', `${vol.hostPath}:${vol.containerPath}${mode}`);
    }

    // Named volumes (persist across container recreations)
    if (args.namedVolumes) {
      for (const vol of args.namedVolumes) {
        cmdArgs.push('-v', `${vol.volumeName}:${vol.containerPath}`);
      }
    }

    // Port mappings
    for (const pm of args.portMappings) {
      cmdArgs.push('-p', `${pm.hostPort}:${pm.containerPort}`);
    }

    // Working directory
    cmdArgs.push('-w', args.workdir);

    // Environment variables
    if (args.env) {
      for (const [key, value] of Object.entries(args.env)) {
        cmdArgs.push('-e', `${key}=${value}`);
      }
    }

    // Image and command
    cmdArgs.push(args.image, ...args.command);

    const output = execFileSync(this.docker, cmdArgs, {
      timeout: 30_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const containerId = output.trim();
    log.info(`Created container ${args.name} (${containerId.slice(0, 12)})`);
    return containerId;
  }

  /** Start an existing container */
  startContainer(id: string): void {
    execFileSync(this.docker, ['start', id], {
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /** Stop a running container */
  stopContainer(id: string, timeoutSec = 10): void {
    try {
      execFileSync(this.docker, ['stop', '--time', String(timeoutSec), id], {
        timeout: (timeoutSec + 5) * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      log.warn(`Failed to stop container ${id.slice(0, 12)} gracefully`);
    }
  }

  /** Force-remove a container (running or stopped) */
  removeContainer(id: string): void {
    try {
      execFileSync(this.docker, ['rm', '-f', id], {
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      log.warn(`Failed to remove container ${id.slice(0, 12)}`);
    }
  }

  /** Get container status */
  getContainerStatus(id: string): 'running' | 'stopped' | 'not-found' {
    try {
      const output = execFileSync(
        this.docker,
        ['inspect', '--format', '{{.State.Status}}', id],
        { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const status = output.trim();
      return status === 'running' ? 'running' : 'stopped';
    } catch {
      return 'not-found';
    }
  }

  /**
   * Build the argument array for `docker exec -it`.
   * Designed to be passed to node-pty: `nodePty.spawn('docker', execInteractiveArgs(...))`.
   */
  execInteractiveArgs(
    containerId: string,
    command: string[],
    env: Record<string, string>,
    workdir = '/workspace',
  ): string[] {
    const args: string[] = ['exec', '-it', '-w', workdir];

    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(containerId, ...command);
    return args;
  }

  /**
   * Build the argument array for `docker exec -i` (non-interactive, piped stdio).
   * Designed for one-shot execution via child_process.spawn.
   */
  execPipedArgs(
    containerId: string,
    command: string[],
    env: Record<string, string>,
    workdir = '/workspace',
  ): string[] {
    const args: string[] = ['exec', '-i', '-w', workdir];

    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(containerId, ...command);
    return args;
  }

  /**
   * Spawn a `docker exec` as a child process (for one-shot execution).
   * Returns the ChildProcess so the caller can pipe stdin/stdout/stderr.
   */
  execSpawn(
    containerId: string,
    command: string[],
    env: Record<string, string>,
    workdir = '/workspace',
  ): ChildProcess {
    const args = this.execPipedArgs(containerId, command, env, workdir);
    return spawn(this.docker, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  /** Inspect actual port mappings from a running container.
   *  Returns a map of containerPort → hostPort parsed from `docker port`. */
  getPortMappings(containerId: string): Map<number, number> {
    const mappings = new Map<number, number>();
    try {
      const output = execFileSync(
        this.docker,
        ['port', containerId],
        { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      // Each line: "3000/tcp -> 0.0.0.0:10000"
      for (const line of output.trim().split('\n')) {
        const match = line.match(/^(\d+)\/\w+\s+->\s+[\d.]+:(\d+)/);
        if (match) {
          mappings.set(parseInt(match[1], 10), parseInt(match[2], 10));
        }
      }
    } catch {
      // Container might not have port mappings or might be stopped
    }
    return mappings;
  }

  /** List all Jam-managed containers (running or stopped) */
  listJamContainers(): ContainerListEntry[] {
    try {
      const output = execFileSync(
        this.docker,
        [
          'ps', '-a',
          '--filter', `label=${LABEL_APP}=true`,
          '--format', `{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Label "${LABEL_AGENT_ID}"}}`,
        ],
        { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );

      return output
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [id, name, ...rest] = line.split('\t');
          const agentId = rest.pop() ?? '';
          const status = rest.join('\t');
          return { id, name, status, agentId };
        });
    } catch {
      return [];
    }
  }

  /** Sanitize an agent name for use as a Docker container name */
  static sanitizeName(agentName: string): string {
    return (
      CONTAINER_PREFIX +
      agentName
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    );
  }

  /** The label key used to store agent IDs on containers */
  static get LABEL_AGENT_ID(): string {
    return LABEL_AGENT_ID;
  }
}
