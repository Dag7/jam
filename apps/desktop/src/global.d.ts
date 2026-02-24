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
    ) => Promise<{
      persona: string;
      facts: string[];
      preferences: Record<string, string>;
      lastUpdated: string;
    } | null>;
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
      Array<{
        timestamp: string;
        level: string;
        message: string;
        agentId?: string;
      }>
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
      command?: string;
      cwd?: string;
    }>>;
    listForAgent: (agentId: string) => Promise<Array<{
      agentId: string;
      pid: number;
      port?: number;
      name: string;
      logFile?: string;
      startedAt: string;
      alive?: boolean;
      command?: string;
      cwd?: string;
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
        source?: 'text' | 'voice';
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
    onSystemNotification: (
      callback: (data: {
        taskId: string;
        agentId: string;
        title: string;
        success: boolean;
        summary: string;
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
    cancel: (taskId: string) => Promise<{ success: boolean; error?: string }>;
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

declare global {
  interface Window {
    jam: JamAPI;
  }
}
