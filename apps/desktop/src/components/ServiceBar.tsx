import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store';

interface ServiceEntry {
  agentId: string;
  pid: number;
  port?: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
  command?: string;
  cwd?: string;
}

export const ServicePanel: React.FC = () => {
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState('');
  const agents = useAppStore((s) => s.agents);

  const refresh = useCallback(async () => {
    try {
      const result = await window.jam.services.list();
      setServices(result);
    } catch {
      // services API not ready yet
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!search.trim()) return services;
    const q = search.toLowerCase();
    return services.filter((svc) => {
      const agent = agents[svc.agentId];
      return (
        svc.name.toLowerCase().includes(q) ||
        (agent?.profile.name ?? '').toLowerCase().includes(q) ||
        (svc.port?.toString() ?? '').includes(q)
      );
    });
  }, [services, search, agents]);

  if (services.length === 0) return null;

  const handleStop = async (port: number) => {
    await window.jam.services.stop(port);
    refresh();
  };

  const handleRestart = async (serviceName: string) => {
    await window.jam.services.restart(serviceName);
    // Refresh quickly for immediate feedback, then again for slower services
    setTimeout(refresh, 500);
    setTimeout(refresh, 3000);
  };

  const handleOpen = (port: number) => {
    window.jam.services.openUrl(port);
  };

  const aliveCount = services.filter((s) => s.alive !== false).length;

  return (
    <div className="border-t border-zinc-800">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-[10px] uppercase tracking-wider font-medium">Services</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400">
          {aliveCount}/{services.length}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2">
          {/* Search filter */}
          <div className="relative mb-2">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter services..."
              className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-md text-[11px] text-zinc-300 placeholder-zinc-600 pl-7 pr-2 py-1.5 focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          {/* Scrollable service list */}
          <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
            {filtered.map((svc) => {
              const agent = agents[svc.agentId];
              const agentColor = agent?.profile.color ?? '#6b7280';
              const agentName = agent?.profile.name;
              const isAlive = svc.alive !== false;
              const canRestart = !isAlive && !!svc.command;

              return (
                <div
                  key={`${svc.agentId}-${svc.name}`}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-xs ${
                    isAlive
                      ? 'bg-zinc-800/50 border-zinc-700/50'
                      : 'bg-zinc-800/30 border-zinc-700/30'
                  }`}
                >
                  {/* Status dot */}
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAlive ? '' : 'opacity-50'}`}
                    style={{ backgroundColor: isAlive ? agentColor : undefined }}
                  >
                    {!isAlive && (
                      <span className="block w-1.5 h-1.5 rounded-full bg-red-400/60" />
                    )}
                  </span>

                  {/* Service info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`truncate ${isAlive ? 'text-zinc-300' : 'text-zinc-500'}`}>
                        {svc.name}
                      </span>
                      {svc.port && (
                        <span className="text-zinc-500 shrink-0">:{svc.port}</span>
                      )}
                    </div>
                    {agentName && (
                      <span className="text-[10px] text-zinc-600 truncate block">{agentName}</span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {isAlive && svc.port && (
                      <button
                        onClick={() => handleOpen(svc.port!)}
                        className="p-0.5 text-zinc-500 hover:text-blue-400 transition-colors"
                        title={`Open http://localhost:${svc.port}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    )}
                    {canRestart && (
                      <button
                        onClick={() => handleRestart(svc.name)}
                        className="p-0.5 text-zinc-500 hover:text-green-400 transition-colors"
                        title="Start service"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </button>
                    )}
                    {isAlive && svc.port && (
                      <button
                        onClick={() => handleStop(svc.port!)}
                        className="p-0.5 text-zinc-500 hover:text-red-400 transition-colors"
                        title="Stop service"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && search && (
              <div className="text-[11px] text-zinc-600 text-center py-3">
                No matching services
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
