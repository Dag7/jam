import React, { useState, useEffect, useCallback } from 'react';

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

export const UpdateBanner: React.FC = () => {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsubs = [
      window.jam.updater.onAvailable(({ version }) => {
        setState({ status: 'available', version });
        setDismissed(false);
      }),
      window.jam.updater.onNotAvailable(() => {
        setState({ status: 'idle' });
      }),
      window.jam.updater.onProgress(({ percent }) => {
        setState({ status: 'downloading', percent });
      }),
      window.jam.updater.onDownloaded(({ version }) => {
        setState({ status: 'ready', version });
        setDismissed(false);
      }),
      window.jam.updater.onError(({ message }) => {
        setState({ status: 'error', message });
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, []);

  const handleDownload = useCallback(() => {
    setState({ status: 'downloading', percent: 0 });
    window.jam.updater.download();
  }, []);

  const handleInstall = useCallback(() => {
    window.jam.updater.install();
  }, []);

  if (dismissed || state.status === 'idle' || state.status === 'checking') {
    return null;
  }

  if (state.status === 'error') {
    return null; // Don't show errors as banner — they're logged
  }

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <div className="flex items-center gap-2 text-xs">
          {state.status === 'available' && (
            <>
              <span className="text-blue-400">
                Update available: v{state.version}
              </span>
              <button
                onClick={handleDownload}
                className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
              >
                Download
              </button>
            </>
          )}
          {state.status === 'downloading' && (
            <>
              <span className="text-blue-400">
                Downloading update... {Math.round(state.percent)}%
              </span>
              <div className="w-24 h-1 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${state.percent}%` }}
                />
              </div>
            </>
          )}
          {state.status === 'ready' && (
            <>
              <span className="text-green-400">
                Update v{state.version} ready to install
              </span>
              <button
                onClick={handleInstall}
                className="text-green-400 hover:text-green-300 underline underline-offset-2"
              >
                Restart Now
              </button>
            </>
          )}
        </div>
        {state.status !== 'downloading' && (
          <button
            onClick={() => setDismissed(true)}
            className="text-zinc-600 hover:text-zinc-400 text-xs ml-2"
          >
            dismiss
          </button>
        )}
      </div>
    </div>
  );
};
