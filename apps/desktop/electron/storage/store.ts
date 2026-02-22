import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { AgentProfile, AgentId, SecretBinding } from '@jam/core';
import type { AgentStore } from '@jam/agent-runtime';

export interface SecretEntry {
  name: string;   // Display name: "GitHub Token"
  type: string;   // Category: "api-key" | "token" | "connection-string" | "credential"
}

interface StoreSchema {
  agentProfiles: Record<string, AgentProfile>;
  apiKeys: Record<string, string>;
  secrets: Record<string, SecretEntry>;
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
        secrets: {},
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

  // --- Secrets (encrypted values + metadata) ---
  getSecrets(): Array<{ id: string; name: string; type: string }> {
    const entries = this.store.get('secrets', {});
    return Object.entries(entries).map(([id, entry]) => ({
      id,
      name: entry.name,
      type: entry.type,
    }));
  }

  setSecret(id: string, name: string, type: string, value: string): void {
    const entries = this.store.get('secrets', {});
    entries[id] = { name, type };
    this.store.set('secrets', entries);

    // Store actual value encrypted alongside apiKeys (reuse same mechanism)
    const keys = this.store.get('apiKeys', {});
    const storageKey = `secret:${id}`;
    if (safeStorage.isEncryptionAvailable()) {
      keys[storageKey] = safeStorage.encryptString(value).toString('base64');
    } else {
      keys[storageKey] = value;
    }
    this.store.set('apiKeys', keys);
  }

  deleteSecret(id: string): void {
    const entries = this.store.get('secrets', {});
    delete entries[id];
    this.store.set('secrets', entries);

    const keys = this.store.get('apiKeys', {});
    delete keys[`secret:${id}`];
    this.store.set('apiKeys', keys);
  }

  /** Resolve secret bindings to env var map. Used at agent spawn time. */
  resolveSecretBindings(bindings: SecretBinding[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (const binding of bindings) {
      const value = this.getApiKey(`secret:${binding.secretId}`);
      if (value) {
        env[binding.envVarName] = value;
      }
    }
    return env;
  }

  /** Get all decrypted secret values (for building the output redactor). */
  getAllSecretValues(): string[] {
    const entries = this.store.get('secrets', {});
    const values: string[] = [];
    for (const id of Object.keys(entries)) {
      const value = this.getApiKey(`secret:${id}`);
      if (value) values.push(value);
    }
    return values;
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
