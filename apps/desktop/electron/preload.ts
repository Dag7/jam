import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Helper to create event listener with cleanup (from whatsapp-relay pattern)
function createEventListener<T>(
  channel: string,
  callback: (data: T) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

export interface JamAPI {
  runtimes: {
    listMetadata: () => Promise<Array<{
      id: string;
      displayName: string;
      cliCommand: string;
      installHint: string;
      models: Array<{ id: string; label: string; group: string }>;
      supportsFullAccess?: boolean;
      nodeVersionRequired?: number;
      authHint: string;
    }>>;
  };

  agents: {
    create: (
      profile: Record<string, unknown>,
    ) => Promise<{ success: boolean; agentId?: string; error?: string }>;
    update: (
      agentId: string,
      updates: Record<string, unknown>,
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (
      agentId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    list: () => Promise<
      Array<{
        profile: Record<string, unknown>;
        status: string;
        visualState: string;
        pid?: number;
        startedAt?: string;
        lastActivity?: string;
      }>
    >;
    get: (
      agentId: string,
    ) => Promise<Record<string, unknown> | null>;
    start: (
      agentId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    stop: (
      agentId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    restart: (
      agentId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    stopAll: () => Promise<{ success: boolean }>;
    getTaskStatus: (agentId: string) => Promise<{
      taskId: string;
      command: string;
      startedAt: number;
      steps: Array<{ timestamp: number; type: string; summary: string }>;
      status: 'running' | 'completed' | 'failed';
    } | null>;
    onStatusChange: (
      callback: (data: { agentId: string; status: string }) => void,
    ) => () => void;
    onCreated: (
      callback: (data: { agentId: string; profile: Record<string, unknown> }) => void,
    ) => () => void;
    onDeleted: (
      callback: (data: { agentId: string }) => void,
    ) => () => void;
    onUpdated: (
      callback: (data: { agentId: string; profile: Record<string, unknown> }) => void,
    ) => () => void;
    onVisualStateChange: (
      callback: (data: { agentId: string; visualState: string }) => void,
    ) => () => void;
  };

  terminal: {
    write: (agentId: string, data: string) => void;
    resize: (agentId: string, cols: number, rows: number) => void;
    onData: (
      callback: (data: { agentId: string; output: string }) => void,
    ) => () => void;
    onExit: (
      callback: (data: { agentId: string; exitCode: number }) => void,
    ) => () => void;
    onExecuteOutput: (
      callback: (data: { agentId: string; output: string; clear: boolean }) => void,
    ) => () => void;
    getScrollback: (agentId: string) => Promise<string>;
  };

  voice: {
    sendAudioChunk: (agentId: string, chunk: ArrayBuffer) => void;
    notifyTTSState: (playing: boolean) => void;
    onTranscription: (
      callback: (data: {
        text: string;
        isFinal: boolean;
        confidence: number;
      }) => void,
    ) => () => void;
    onTTSAudio: (
      callback: (data: { agentId: string; audioData: string }) => void,
    ) => () => void;
    onStateChange: (
      callback: (data: { state: string }) => void,
    ) => () => void;
    requestTTS: (
      agentId: string,
      text: string,
    ) => Promise<{ success: boolean; audioPath?: string; error?: string }>;
    getFilterSettings: () => Promise<{ vadThreshold: number; minRecordingMs: number }>;
    checkMicPermission: () => Promise<{ granted: boolean; status?: string }>;
  };

  memory: {
    load: (
      agentId: string,
    ) => Promise<{ persona: string; facts: string[]; preferences: Record<string, string>; lastUpdated: string } | null>;
    save: (
      agentId: string,
      memory: Record<string, unknown>,
    ) => Promise<{ success: boolean; error?: string }>;
  };

  config: {
    get: () => Promise<Record<string, unknown>>;
    set: (
      config: Record<string, unknown>,
    ) => Promise<{ success: boolean }>;
  };

  apiKeys: {
    set: (service: string, key: string) => Promise<{ success: boolean }>;
    has: (service: string) => Promise<boolean>;
    delete: (service: string) => Promise<{ success: boolean }>;
  };

  secrets: {
    list: () => Promise<Array<{ id: string; name: string; type: string }>>;
    set: (id: string, name: string, type: string, value: string) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  window: {
    minimize: () => void;
    close: () => void;
    maximize: () => void;
    setCompact: (compact: boolean) => void;
  };

  setup: {
    detectRuntimes: () => Promise<Array<{
      id: string;
      name: string;
      available: boolean;
      authenticated: boolean;
      version: string;
      nodeVersion: string;
      error: string;
      authHint: string;
    }>>;
    getOnboardingStatus: () => Promise<boolean>;
    getSetupStatus: () => Promise<{
      hasRuntime: boolean;
      hasVoiceKeys: boolean;
      hasAgents: boolean;
      missing: string[];
    }>;
    completeOnboarding: () => Promise<{ success: boolean }>;
    resetOnboarding: () => Promise<{ success: boolean }>;
    openTerminal: (command: string) => Promise<{ success: boolean; error?: string }>;
    testRuntime: (runtimeId: string) => Promise<{ success: boolean; output: string }>;
  };

  app: {
    onError: (
      callback: (error: { message: string; details?: string }) => void,
    ) => () => void;
    getVersion: () => Promise<string>;
  };

  logs: {
    get: () => Promise<
      Array<{ timestamp: string; level: string; message: string; agentId?: string }>
    >;
    onEntry: (
      callback: (entry: {
        timestamp: string;
        level: string;
        message: string;
        agentId?: string;
      }) => void,
    ) => () => void;
  };

  services: {
    list: () => Promise<Array<{
      agentId: string;
      pid: number;
      port?: number;
      name: string;
      logFile?: string;
      startedAt: string;
      alive?: boolean;
    }>>;
    stop: (pid: number) => Promise<{ success: boolean }>;
    restart: (serviceName: string) => Promise<{ success: boolean; pid?: number; error?: string }>;
    openUrl: (port: number) => Promise<{ success: boolean }>;
  };

  chat: {
    sendCommand: (text: string) => Promise<{
      success: boolean;
      text?: string;
      error?: string;
      agentId?: string;
      agentName?: string;
      agentRuntime?: string;
      agentColor?: string;
    }>;
    interruptAgent: (agentId: string) => Promise<{
      success: boolean;
      text?: string;
    }>;
    loadHistory: (options?: { agentId?: string; before?: string; limit?: number }) => Promise<{
      messages: Array<{
        timestamp: string;
        role: 'user' | 'agent';
        content: string;
        agentId: string;
        agentName: string;
        agentRuntime: string;
        agentColor: string;
      }>;
      hasMore: boolean;
    }>;
    onAgentAcknowledged: (
      callback: (data: {
        agentId: string;
        agentName: string;
        agentRuntime: string;
        agentColor: string;
        ackText: string;
      }) => void,
    ) => () => void;
    onAgentResponse: (
      callback: (data: {
        agentId: string;
        agentName: string;
        agentRuntime: string;
        agentColor: string;
        text: string;
        error?: string;
      }) => void,
    ) => () => void;
    onVoiceCommand: (
      callback: (data: {
        text: string;
        agentId: string;
        agentName: string | null;
      }) => void,
    ) => () => void;
    onAgentProgress: (
      callback: (data: {
        agentId: string;
        agentName: string;
        agentRuntime: string;
        agentColor: string;
        type: string;
        summary: string;
      }) => void,
    ) => () => void;
    onMessageQueued: (
      callback: (data: {
        agentId: string;
        agentName: string;
        agentRuntime: string;
        agentColor: string;
        queuePosition: number;
        command: string;
      }) => void,
    ) => () => void;
  };

  tasks: {
    list: (filter?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    get: (taskId: string) => Promise<Record<string, unknown> | null>;
    create: (input: {
      title: string;
      description: string;
      priority?: string;
      assignedTo?: string;
      tags?: string[];
    }) => Promise<{ success: boolean; task?: Record<string, unknown>; error?: string }>;
    update: (
      taskId: string,
      updates: Record<string, unknown>,
    ) => Promise<{ success: boolean; task?: Record<string, unknown>; error?: string }>;
    delete: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    createRecurring: (input: {
      title: string;
      description: string;
      pattern: { cron?: string; intervalMs?: number };
      priority?: string;
      assignedTo?: string;
      tags?: string[];
      source?: string;
      createdBy?: string;
    }) => Promise<{ success: boolean; schedule?: Record<string, unknown>; error?: string }>;
    onCreated: (callback: (data: { task: Record<string, unknown> }) => void) => () => void;
    onUpdated: (callback: (data: { task: Record<string, unknown> }) => void) => () => void;
    onCompleted: (callback: (data: { task: Record<string, unknown>; durationMs: number }) => void) => () => void;
  };

  team: {
    channels: {
      list: (agentId?: string) => Promise<Array<Record<string, unknown>>>;
      create: (
        name: string,
        type: string,
        participants: string[],
      ) => Promise<{ success: boolean; channel?: Record<string, unknown>; error?: string }>;
      getMessages: (
        channelId: string,
        limit?: number,
        before?: string,
      ) => Promise<Array<Record<string, unknown>>>;
      sendMessage: (
        channelId: string,
        senderId: string,
        content: string,
        replyTo?: string,
      ) => Promise<{ success: boolean; message?: Record<string, unknown>; error?: string }>;
      onMessageReceived: (
        callback: (data: { message: Record<string, unknown>; channel: Record<string, unknown> }) => void,
      ) => () => void;
    };
    relationships: {
      get: (sourceAgentId: string, targetAgentId: string) => Promise<Record<string, unknown> | null>;
      getAll: (agentId: string) => Promise<Array<Record<string, unknown>>>;
      onTrustUpdated: (
        callback: (data: { relationship: Record<string, unknown> }) => void,
      ) => () => void;
    };
    stats: {
      get: (agentId: string) => Promise<Record<string, unknown> | null>;
      onUpdated: (
        callback: (data: { agentId: string; stats: Record<string, unknown> }) => void,
      ) => () => void;
    };
    soul: {
      get: (agentId: string) => Promise<Record<string, unknown>>;
      evolve: (agentId: string) => Promise<{ success: boolean; prompt?: string; error?: string }>;
      onEvolved: (
        callback: (data: { agentId: string; soul: Record<string, unknown>; version: number }) => void,
      ) => () => void;
    };
    schedules: {
      list: () => Promise<Array<Record<string, unknown>>>;
      create: (schedule: {
        name: string;
        pattern: Record<string, unknown>;
        taskTemplate: Record<string, unknown>;
      }) => Promise<{ success: boolean; schedule?: Record<string, unknown>; error?: string }>;
      update: (id: string, updates: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
      delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    };
    improvements: {
      list: (filter?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
      propose: (agentId: string, title: string, description: string) => Promise<{
        success: boolean;
        improvement?: Record<string, unknown>;
        error?: string;
      }>;
      execute: (improvementId: string) => Promise<{
        success: boolean;
        improvement?: Record<string, unknown>;
        error?: string;
      }>;
      rollback: (improvementId: string) => Promise<{ success: boolean; error?: string }>;
      health: () => Promise<{ healthy: boolean; lastCheck: string; issues: string[] }>;
    };
  };
}

contextBridge.exposeInMainWorld('jam', {
  runtimes: {
    listMetadata: () => ipcRenderer.invoke('runtimes:listMetadata'),
  },

  agents: {
    create: (profile) => ipcRenderer.invoke('agents:create', profile),
    update: (agentId, updates) =>
      ipcRenderer.invoke('agents:update', agentId, updates),
    delete: (agentId) => ipcRenderer.invoke('agents:delete', agentId),
    list: () => ipcRenderer.invoke('agents:list'),
    get: (agentId) => ipcRenderer.invoke('agents:get', agentId),
    start: (agentId) => ipcRenderer.invoke('agents:start', agentId),
    stop: (agentId) => ipcRenderer.invoke('agents:stop', agentId),
    restart: (agentId) => ipcRenderer.invoke('agents:restart', agentId),
    stopAll: () => ipcRenderer.invoke('agents:stopAll'),
    getTaskStatus: (agentId) => ipcRenderer.invoke('agents:getTaskStatus', agentId),
    onStatusChange: (cb) =>
      createEventListener('agents:statusChange', cb),
    onCreated: (cb) => createEventListener('agents:created', cb),
    onDeleted: (cb) => createEventListener('agents:deleted', cb),
    onUpdated: (cb) => createEventListener('agents:updated', cb),
    onVisualStateChange: (cb) =>
      createEventListener('agents:visualStateChange', cb),
  },

  terminal: {
    write: (agentId, data) =>
      ipcRenderer.send('terminal:write', agentId, data),
    resize: (agentId, cols, rows) =>
      ipcRenderer.send('terminal:resize', agentId, cols, rows),
    onData: (cb) => createEventListener('terminal:data', cb),
    onExit: (cb) => createEventListener('terminal:exit', cb),
    onExecuteOutput: (cb) =>
      createEventListener('terminal:executeOutput', cb),
    getScrollback: (agentId) =>
      ipcRenderer.invoke('terminal:getScrollback', agentId),
  },

  voice: {
    sendAudioChunk: (agentId, chunk) =>
      ipcRenderer.send('voice:audioChunk', agentId, chunk),
    notifyTTSState: (playing) =>
      ipcRenderer.send('voice:ttsState', playing),
    onTranscription: (cb) =>
      createEventListener('voice:transcription', cb),
    onTTSAudio: (cb) => createEventListener('voice:ttsAudio', cb),
    onStateChange: (cb) => createEventListener('voice:stateChanged', cb),
    requestTTS: (agentId, text) =>
      ipcRenderer.invoke('voice:requestTTS', agentId, text),
    getFilterSettings: () =>
      ipcRenderer.invoke('voice:getFilterSettings'),
    checkMicPermission: () =>
      ipcRenderer.invoke('voice:checkMicPermission'),
  },

  memory: {
    load: (agentId) => ipcRenderer.invoke('memory:load', agentId),
    save: (agentId, memory) =>
      ipcRenderer.invoke('memory:save', agentId, memory),
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config) => ipcRenderer.invoke('config:set', config),
  },

  apiKeys: {
    set: (service, key) => ipcRenderer.invoke('apiKeys:set', service, key),
    has: (service) => ipcRenderer.invoke('apiKeys:has', service),
    delete: (service) => ipcRenderer.invoke('apiKeys:delete', service),
  },

  secrets: {
    list: () => ipcRenderer.invoke('secrets:list'),
    set: (id, name, type, value) => ipcRenderer.invoke('secrets:set', id, name, type, value),
    delete: (id) => ipcRenderer.invoke('secrets:delete', id),
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    setCompact: (compact: boolean) => ipcRenderer.invoke('window:setCompact', compact),
  },

  setup: {
    detectRuntimes: () => ipcRenderer.invoke('setup:detectRuntimes'),
    getOnboardingStatus: () => ipcRenderer.invoke('setup:getOnboardingStatus'),
    getSetupStatus: () => ipcRenderer.invoke('setup:getSetupStatus'),
    completeOnboarding: () => ipcRenderer.invoke('setup:completeOnboarding'),
    resetOnboarding: () => ipcRenderer.invoke('setup:resetOnboarding'),
    openTerminal: (command: string) => ipcRenderer.invoke('setup:openTerminal', command),
    testRuntime: (runtimeId: string) => ipcRenderer.invoke('setup:testRuntime', runtimeId),
  },

  app: {
    onError: (cb) => createEventListener('app:error', cb),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  logs: {
    get: () => ipcRenderer.invoke('logs:get'),
    onEntry: (cb) => createEventListener('logs:entry', cb),
  },

  services: {
    list: () => ipcRenderer.invoke('services:list'),
    listForAgent: (agentId) => ipcRenderer.invoke('services:listForAgent', agentId),
    stop: (pid) => ipcRenderer.invoke('services:stop', pid),
    restart: (serviceName) => ipcRenderer.invoke('services:restart', serviceName),
    openUrl: (port) => ipcRenderer.invoke('services:openUrl', port),
  },

  chat: {
    sendCommand: (text) => ipcRenderer.invoke('chat:sendCommand', text),
    interruptAgent: (agentId) => ipcRenderer.invoke('chat:interruptAgent', agentId),
    loadHistory: (options) => ipcRenderer.invoke('chat:loadHistory', options),
    onAgentAcknowledged: (cb) => createEventListener('chat:agentAcknowledged', cb),
    onAgentResponse: (cb) => createEventListener('chat:agentResponse', cb),
    onVoiceCommand: (cb) => createEventListener('chat:voiceCommand', cb),
    onAgentProgress: (cb) => createEventListener('chat:agentProgress', cb),
    onMessageQueued: (cb) => createEventListener('chat:messageQueued', cb),
    onSystemNotification: (cb) => createEventListener('chat:systemNotification', cb),
  },

  tasks: {
    list: (filter) => ipcRenderer.invoke('tasks:list', filter),
    get: (taskId) => ipcRenderer.invoke('tasks:get', taskId),
    create: (input) => ipcRenderer.invoke('tasks:create', input),
    update: (taskId, updates) => ipcRenderer.invoke('tasks:update', taskId, updates),
    delete: (taskId) => ipcRenderer.invoke('tasks:delete', taskId),
    cancel: (taskId) => ipcRenderer.invoke('tasks:cancel', taskId),
    createRecurring: (input) => ipcRenderer.invoke('tasks:createRecurring', input),
    onCreated: (cb) => createEventListener('tasks:created', cb),
    onUpdated: (cb) => createEventListener('tasks:updated', cb),
    onCompleted: (cb) => createEventListener('tasks:completed', cb),
  },

  team: {
    channels: {
      list: (agentId) => ipcRenderer.invoke('channels:list', agentId),
      create: (name, type, participants) =>
        ipcRenderer.invoke('channels:create', name, type, participants),
      getMessages: (channelId, limit, before) =>
        ipcRenderer.invoke('channels:getMessages', channelId, limit, before),
      sendMessage: (channelId, senderId, content, replyTo) =>
        ipcRenderer.invoke('channels:sendMessage', channelId, senderId, content, replyTo),
      onMessageReceived: (cb) => createEventListener('message:received', cb),
    },
    relationships: {
      get: (sourceAgentId, targetAgentId) =>
        ipcRenderer.invoke('relationships:get', sourceAgentId, targetAgentId),
      getAll: (agentId) => ipcRenderer.invoke('relationships:getAll', agentId),
      onTrustUpdated: (cb) => createEventListener('trust:updated', cb),
    },
    stats: {
      get: (agentId) => ipcRenderer.invoke('stats:get', agentId),
      onUpdated: (cb) => createEventListener('stats:updated', cb),
    },
    soul: {
      get: (agentId) => ipcRenderer.invoke('soul:get', agentId),
      evolve: (agentId) => ipcRenderer.invoke('soul:evolve', agentId),
      onEvolved: (cb) => createEventListener('soul:evolved', cb),
    },
    schedules: {
      list: () => ipcRenderer.invoke('schedules:list'),
      create: (schedule) => ipcRenderer.invoke('schedules:create', schedule),
      update: (id, updates) => ipcRenderer.invoke('schedules:update', id, updates),
      delete: (id) => ipcRenderer.invoke('schedules:delete', id),
    },
    improvements: {
      list: (filter) => ipcRenderer.invoke('improvements:list', filter),
      propose: (agentId, title, description) =>
        ipcRenderer.invoke('improvements:propose', agentId, title, description),
      execute: (improvementId) => ipcRenderer.invoke('improvements:execute', improvementId),
      rollback: (improvementId) => ipcRenderer.invoke('improvements:rollback', improvementId),
      health: () => ipcRenderer.invoke('improvements:health'),
    },
  },
} as JamAPI);

declare global {
  interface Window {
    jam: JamAPI;
  }
}
