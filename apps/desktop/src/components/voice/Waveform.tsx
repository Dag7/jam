import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  isActive: boolean;
  audioLevelRef: React.RefObject<number>;
}

const BAR_COUNT = 5;
const BASE_HEIGHT = 4;
const MAX_HEIGHT = 24;

export const Waveform: React.FC<WaveformProps> = React.memo(({ isActive, audioLevelRef }) => {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) return;

    const animate = () => {
      const level = audioLevelRef.current ?? 0;
      const scaledLevel = Math.min(level * 500, 1);
      const levelHeight = BASE_HEIGHT + scaledLevel * (MAX_HEIGHT - BASE_HEIGHT);

      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = barsRef.current[i];
        if (!bar) continue;
        const barVariation = 0.6 + Math.sin(i * 1.2) * 0.4;
        const barHeight = Math.max(BASE_HEIGHT, levelHeight * barVariation);
        bar.style.height = `${barHeight}px`;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive, audioLevelRef]);

  if (!isActive) return null;

  return (
    <div className="flex items-center gap-0.5 h-6">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          className="w-1 bg-red-400 rounded-full transition-none"
          style={{ height: `${BASE_HEIGHT}px` }}
        />
      ))}
    </div>
  );
});

Waveform.displayName = 'Waveform';
