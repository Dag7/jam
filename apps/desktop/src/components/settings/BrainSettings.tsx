import React from 'react';

interface BrainConfig {
  enabled: boolean;
  url: string;
}

interface BrainSettingsProps {
  config: BrainConfig;
  brainKey: string;
  hasBrainKey: boolean;
  brainHealth: boolean | null;
  onConfigChange: (updates: Partial<BrainConfig>) => void;
  onBrainKeyChange: (key: string) => void;
  onDeleteBrainKey: () => void;
  onTestConnection: () => void;
}

export const BrainSettings: React.FC<BrainSettingsProps> = ({
  config,
  brainKey,
  hasBrainKey,
  brainHealth,
  onConfigChange,
  onBrainKeyChange,
  onDeleteBrainKey,
  onTestConnection,
}) => {
  return (
    <section>
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
        Kalanu Brain
      </h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-xs text-zinc-300">Enable Brain Memory</label>
            <p className="text-xs text-zinc-600">Semantic memory via Kalanu Brain server (requires restart)</p>
          </div>
          <button
            onClick={() => onConfigChange({ enabled: !config.enabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              config.enabled ? 'bg-blue-600' : 'bg-zinc-700'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              config.enabled ? 'translate-x-5' : ''
            }`} />
          </button>
        </div>

        {config.enabled && (
          <>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Server URL</label>
              <input
                type="text"
                value={config.url}
                onChange={(e) => onConfigChange({ url: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-blue-500"
                placeholder="http://localhost:8080"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                API Key {hasBrainKey && <span className="text-green-500 ml-1">saved</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={brainKey}
                  onChange={(e) => onBrainKeyChange(e.target.value)}
                  placeholder={hasBrainKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Optional'}
                  className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-blue-500"
                />
                {hasBrainKey && (
                  <button
                    onClick={onDeleteBrainKey}
                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={onTestConnection}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
            >
              Test Connection
              {brainHealth === true && <span className="ml-2 text-green-500">Connected</span>}
              {brainHealth === false && <span className="ml-2 text-red-500">Failed</span>}
            </button>
          </>
        )}
      </div>
    </section>
  );
};
