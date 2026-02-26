import { useState, useEffect } from 'react';

export interface RuntimeMetadataInfo {
  id: string;
  displayName: string;
  models: Array<{ id: string; label: string; group: string }>;
}

/**
 * Loads runtime metadata from the main process — shared by
 * AgentPanelContainer, AgentsOverviewContainer, and OnboardingContainer.
 */
export function useRuntimeMetadata() {
  const [runtimes, setRuntimes] = useState<RuntimeMetadataInfo[]>([]);

  useEffect(() => {
    window.jam.runtimes.listMetadata().then((data) => {
      setRuntimes(data.map((r) => ({ id: r.id, displayName: r.displayName, models: r.models })));
    }).catch(() => {
      // Runtimes will remain empty — UI shows no runtime options
    });
  }, []);

  return runtimes;
}
