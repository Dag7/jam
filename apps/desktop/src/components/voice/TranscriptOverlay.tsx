import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface TranscriptOverlayProps {
  text: string | null;
  isFinal: boolean;
}

export const TranscriptOverlay: React.FC<TranscriptOverlayProps> = ({
  text,
  isFinal,
}) => {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className={`
            mb-2 px-3 py-2 rounded-lg text-sm
            ${isFinal
              ? 'bg-blue-900/30 text-blue-200 border border-blue-800/50'
              : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700/50'
            }
          `}
        >
          {text}
          {!isFinal && (
            <span className="inline-block w-1.5 h-4 bg-zinc-400 ml-1 animate-pulse" />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
