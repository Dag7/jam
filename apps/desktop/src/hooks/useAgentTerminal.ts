import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useAppStore } from '@/store';

export function useAgentTerminal(agentId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const pendingData = useAppStore(
    (s) => s.terminalBuffers[agentId]?.pendingData ?? [],
  );
  const flushTerminalData = useAppStore((s) => s.flushTerminalData);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      theme: {
        background: '#09090b',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    // Forward user input to main process
    terminal.onData((data) => {
      window.jam.terminal.write(agentId, data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [agentId]);

  // Write pending data
  useEffect(() => {
    if (!terminalRef.current || pendingData.length === 0) return;

    for (const data of pendingData) {
      terminalRef.current.write(data);
    }
    flushTerminalData(agentId);
  }, [agentId, pendingData, flushTerminalData]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();

      if (terminalRef.current) {
        const { cols, rows } = terminalRef.current;
        window.jam.terminal.resize(agentId, cols, rows);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [agentId]);

  return {
    containerRef,
  };
}
