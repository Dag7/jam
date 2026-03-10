interface ServiceEntry {
  port: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
  command?: string;
  cwd?: string;
}

interface AgentServicesListProps {
  services: ServiceEntry[];
  onStopService: (port: number) => void;
  onRestartService: (serviceName: string) => void;
  onOpenService: (port: number) => void;
}

export function AgentServicesList({ services, onStopService, onRestartService, onOpenService }: AgentServicesListProps) {
  if (services.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No services found.</p>;
  }

  return (
    <div className="space-y-2">
      {services.map((svc) => {
        const isAlive = svc.alive !== false;
        const canRestart = !isAlive && !!svc.command;
        return (
          <div
            key={`${svc.name}-${svc.port}`}
            className={`bg-zinc-800 rounded-lg p-3 border ${
              isAlive ? 'border-zinc-700' : 'border-zinc-700/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isAlive ? 'bg-green-400' : 'bg-red-400/60'
                  }`}
                />
                <span className={`text-sm font-medium truncate ${
                  isAlive ? 'text-white' : 'text-zinc-400'
                }`}>{svc.name}</span>
                {svc.port && (
                  <span className="text-xs text-zinc-500 shrink-0">:{svc.port}</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  isAlive
                    ? 'bg-green-900/40 text-green-400'
                    : 'bg-red-900/30 text-red-400/80'
                }`}>
                  {isAlive ? 'running' : 'stopped'}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Open in browser */}
                {isAlive && svc.port && (
                  <button
                    onClick={() => onOpenService(svc.port!)}
                    className="p-1.5 text-zinc-500 hover:text-blue-400 transition-colors rounded hover:bg-zinc-700"
                    title={`Open http://localhost:${svc.port}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                )}
                {/* Start/Restart */}
                {canRestart && (
                  <button
                    onClick={() => onRestartService(svc.name)}
                    className="p-1.5 text-zinc-500 hover:text-green-400 transition-colors rounded hover:bg-zinc-700"
                    title="Start service"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                )}
                {/* Stop */}
                {isAlive && svc.port && (
                  <button
                    onClick={() => onStopService(svc.port!)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors rounded hover:bg-zinc-700"
                    title="Stop service"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
              <span>:{svc.port}</span>
              {svc.logFile && <span>{svc.logFile}</span>}
              <span>{new Date(svc.startedAt).toLocaleString()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
