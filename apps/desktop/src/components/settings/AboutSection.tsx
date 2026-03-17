import React, { useState, useEffect, useCallback } from 'react';

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'available'; version: string; releaseDate: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export const AboutSection: React.FC = () => {
  const [version, setVersion] = useState<string>('');
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [autoUpdate, setAutoUpdate] = useState(true);

  useEffect(() => {
    window.jam.app.getVersion().then(setVersion);
    window.jam.updater.getAutoUpdate().then(setAutoUpdate);

    const unsubs = [
      window.jam.updater.onAvailable(({ version: v, releaseDate }) => {
        setStatus({ state: 'available', version: v, releaseDate });
      }),
      window.jam.updater.onNotAvailable(() => {
        setStatus({ state: 'up-to-date' });
      }),
      window.jam.updater.onProgress(({ percent }) => {
        setStatus({ state: 'downloading', percent });
      }),
      window.jam.updater.onDownloaded(({ version: v }) => {
        setStatus({ state: 'ready', version: v });
      }),
      window.jam.updater.onError(() => {
        // Error from background check — don't show (handled by handleCheck for manual checks)
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, []);

  const handleCheck = useCallback(async () => {
    setStatus({ state: 'checking' });
    try {
      const timeout = new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, error: 'Timed out' }), 15_000),
      );
      const result = await Promise.race([window.jam.updater.check(), timeout]);
      if (!result.success) {
        // Only show error if still in checking state (event listeners may have already transitioned)
        setStatus((prev) => prev.state === 'checking'
          ? { state: 'error', message: result.error ?? 'Check failed' }
          : prev,
        );
      }
    } catch {
      setStatus((prev) => prev.state === 'checking'
        ? { state: 'error', message: 'Check failed' }
        : prev,
      );
    }
  }, []);

  const handleDownload = useCallback(() => {
    setStatus({ state: 'downloading', percent: 0 });
    window.jam.updater.download();
  }, []);

  const handleInstall = useCallback(() => {
    window.jam.updater.install();
  }, []);

  const handleToggleAutoUpdate = useCallback(async (enabled: boolean) => {
    setAutoUpdate(enabled);
    const current = await window.jam.config.get();
    await window.jam.config.set({ ...current, autoUpdate: enabled });
  }, []);

  return (
    <section>
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
        About
      </h3>
      <div className="space-y-3">
        {/* Version row */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-zinc-200">Jam</span>
            <span className="text-sm text-zinc-500 ml-2">v{version || '...'}</span>
          </div>
          <button
            onClick={handleCheck}
            disabled={status.state === 'checking' || status.state === 'downloading'}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-700 rounded-lg transition-colors"
          >
            {status.state === 'checking' ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>

        {/* Auto-update toggle */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-400">
            Automatically check for updates on startup
          </label>
          <button
            onClick={() => handleToggleAutoUpdate(!autoUpdate)}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              autoUpdate ? 'bg-blue-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                autoUpdate ? 'translate-x-4' : ''
              }`}
            />
          </button>
        </div>

        {/* Status indicator */}
        {status.state === 'up-to-date' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-xs text-green-400">You're up to date</span>
          </div>
        )}

        {status.state === 'available' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-blue-400">
                Update available: v{status.version}
              </span>
              {status.releaseDate && (
                <span className="text-[10px] text-zinc-500">
                  Released {new Date(status.releaseDate).toLocaleDateString()}
                </span>
              )}
            </div>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
            >
              Download
            </button>
          </div>
        )}

        {status.state === 'downloading' && (
          <div className="px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-blue-400">Downloading update...</span>
              <span className="text-xs text-zinc-500">{Math.round(status.percent)}%</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${status.percent}%` }}
              />
            </div>
          </div>
        )}

        {status.state === 'ready' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/20">
            <span className="text-xs text-green-400">
              v{status.version} ready to install
            </span>
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 text-xs text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors"
            >
              Restart & Update
            </button>
          </div>
        )}

        {status.state === 'error' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
            <span className="text-xs text-red-400">Update check failed</span>
            <button
              onClick={() => setStatus({ state: 'idle' })}
              className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto"
            >
              dismiss
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
