import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { AgentProfile, AgentId } from '@jam/core';
import type { AgentStore } from '@jam/agent-runtime';

interface StoreSchema {
  agentProfiles: Record<string, AgentProfile>;
  apiKeys: Record<string, string>;
  uiState: {
    windowBounds?: { x: number; y: number; width: number; height: number };
    activeAgentId?: string;
    sidebarCollapsed?: boolean;
  };
  onboardingComplete: boolean;
}

export class AppStore implements AgentStore {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'jam-store',
      defaults: {
        agentProfiles: {},
        apiKeys: {},
        uiState: {},
        onboardingComplete: false,
      },
    });
  }

  // --- AgentStore interface ---
  getProfiles(): AgentProfile[] {
    return Object.values(this.store.get('agentProfiles', {}));
  }

  saveProfile(profile: AgentProfile): void {
    const profiles = this.store.get('agentProfiles', {});
    profiles[profile.id] = profile;
    this.store.set('agentProfiles', profiles);
  }

  deleteProfile(agentId: AgentId): void {
    const profiles = this.store.get('agentProfiles', {});
    delete profiles[agentId];
    this.store.set('agentProfiles', profiles);
  }

  // --- API Key management (encrypted via safeStorage) ---
  setApiKey(service: string, key: string): void {
    const keys = this.store.get('apiKeys', {});
    if (safeStorage.isEncryptionAvailable()) {
      keys[service] = safeStorage.encryptString(key).toString('base64');
    } else {
      keys[service] = key;
    }
    this.store.set('apiKeys', keys);
  }

  getApiKey(service: string): string | null {
    const keys = this.store.get('apiKeys', {});
    const stored = keys[service];
    if (!stored) return null;

    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(stored, 'base64'));
      } catch {
        return null;
      }
    }
    return stored;
  }

  // --- UI State ---
  getUIState(): StoreSchema['uiState'] {
    return this.store.get('uiState', {});
  }

  setUIState(state: Partial<StoreSchema['uiState']>): void {
    const current = this.store.get('uiState', {});
    this.store.set('uiState', { ...current, ...state });
  }

  // --- Onboarding ---
  isOnboardingComplete(): boolean {
    return this.store.get('onboardingComplete', false);
  }

  setOnboardingComplete(complete: boolean): void {
    this.store.set('onboardingComplete', complete);
  }
}
