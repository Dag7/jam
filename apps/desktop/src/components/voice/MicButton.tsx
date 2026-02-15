import React from 'react';
import { motion } from 'motion/react';

interface MicButtonProps {
  isRecording: boolean;
  isProcessing: boolean;
  disabled?: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
}

export const MicButton: React.FC<MicButtonProps> = ({
  isRecording,
  isProcessing,
  disabled,
  onPressStart,
  onPressEnd,
}) => {
  return (
    <motion.button
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressEnd}
      disabled={disabled || isProcessing}
      className={`
        relative w-12 h-12 rounded-full flex items-center justify-center
        transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
        ${isRecording
          ? 'bg-red-600 text-white'
          : isProcessing
            ? 'bg-yellow-600 text-white'
            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      whileHover={!disabled ? { scale: 1.05 } : undefined}
      whileTap={!disabled ? { scale: 0.95 } : undefined}
      aria-label={
        isRecording ? 'Recording...' : isProcessing ? 'Processing...' : 'Hold to talk'
      }
    >
      {/* Pulse ring when recording */}
      {isRecording && (
        <motion.div
          className="absolute inset-0 rounded-full bg-red-600"
          animate={{
            scale: [1, 1.3],
            opacity: [0.5, 0],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        />
      )}

      {/* Mic icon */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    </motion.button>
  );
};
