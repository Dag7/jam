export { DockerClient } from './docker-client.js';
export { ContainerManager } from './container-manager.js';
export { PortAllocator } from './port-allocator.js';
export { ImageManager } from './image-manager.js';
export { SandboxedPtyManager } from './sandboxed-pty-manager.js';
export { HostBridge } from './host-bridge.js';
export { AGENT_DOCKERFILE } from './dockerfile.js';

export type { SandboxConfig, ContainerExitBehavior, ContainerInfo, CreateContainerOptions } from './types.js';
export { DEFAULT_SANDBOX_CONFIG } from './types.js';
export type { HostBridgeDeps } from './host-bridge.js';
