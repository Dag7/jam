import React from 'react';
import { motion } from 'motion/react';

interface WaveformProps {
  isActive: boolean;
}

const BAR_COUNT = 5;

export const Waveform: React.FC<WaveformProps> = ({ isActive }) => {
  if (!isActive) return null;

  return (
    <div className="flex items-center gap-0.5 h-6">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <motion.div
          key={i}
          className="w-1 bg-red-400 rounded-full"
          animate={{
            height: isActive ? [4, 16, 8, 20, 4] : 4,
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.1,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
};
