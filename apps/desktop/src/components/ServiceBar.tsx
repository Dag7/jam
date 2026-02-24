import React, { useEffect, useState, useCallback } from 'react';
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

export const ServiceBar: React.FC = () => {
  const [services, setServices] = useState<ServiceEntry[]>([]);
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

  if (services.length === 0) return null;

  const handleStop = async (pid: number) => {
    await window.jam.services.stop(pid);
    refresh();
  };

  const handleRestart = async (serviceName: string) => {
    await window.jam.services.restart(serviceName);
    setTimeout(refresh, 1000);
  };

  const handleOpen = (port: number) => {
    window.jam.services.openUrl(port);
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/60 px-4 py-1.5 shrink-0">
      <div className="flex items-center gap-3 overflow-x-auto">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0">
          Services
        </span>

        {services.map((svc) => {
          const agent = agents[svc.agentId];
          const agentColor = agent?.profile.color ?? '#6b7280';
          const isAlive = svc.alive !== false;
          const canRestart = !isAlive && !!svc.command;

          return (
            <div
              key={`${svc.agentId}-${svc.name}`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs shrink-0 ${
                isAlive
                  ? 'bg-zinc-800/50 border-zinc-700/50'
                  : 'bg-zinc-800/30 border-zinc-700/30'
              }`}
            >
              {/* Status dot — green when alive, red when stopped */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isAlive ? '' : 'opacity-50'
                }`}
                style={{ backgroundColor: isAlive ? agentColor : undefined }}
              >
                {!isAlive && (
                  <span className="block w-1.5 h-1.5 rounded-full bg-red-400/60" />
                )}
              </span>

              {/* Service name + port */}
              <span className={isAlive ? 'text-zinc-300' : 'text-zinc-500'}>{svc.name}</span>
              {svc.port && (
                <span className="text-zinc-500">:{svc.port}</span>
              )}

              {/* Open button — only when alive */}
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

              {/* Start button — only when stopped + has command */}
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

              {/* Stop button — only when alive */}
              {isAlive && (
                <button
                  onClick={() => handleStop(svc.pid)}
                  className="p-0.5 text-zinc-500 hover:text-red-400 transition-colors"
                  title="Stop service"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
