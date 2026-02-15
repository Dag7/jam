import React from 'react';
import { motion } from 'motion/react';
import { avatarVariants, ringVariants } from '@/animations/agentVariants';
import type { AgentVisualState } from '@/store/agentSlice';

interface AgentAvatarProps {
  visualState: AgentVisualState;
  name: string;
  color: string;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: 48, md: 80, lg: 120 } as const;

export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  visualState,
  name,
  color,
  avatarUrl,
  size = 'md',
}) => {
  const px = sizeMap[size];

  return (
    <motion.div
      className="relative flex items-center justify-center"
      style={{ width: px, height: px }}
      variants={avatarVariants}
      animate={visualState}
      aria-label={`${name} - ${visualState}`}
    >
      {/* Glow ring */}
      <motion.div
        className="absolute inset-0 rounded-full border-2"
        style={{ borderColor: color, boxShadow: `0 0 12px ${color}40` }}
        variants={ringVariants}
        animate={visualState}
      />

      {/* Avatar */}
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="rounded-full object-cover"
          style={{ width: px - 8, height: px - 8 }}
        />
      ) : (
        <div
          className="rounded-full flex items-center justify-center text-white font-bold"
          style={{
            width: px - 8,
            height: px - 8,
            backgroundColor: `${color}30`,
            fontSize: px / 3,
          }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
    </motion.div>
  );
};
