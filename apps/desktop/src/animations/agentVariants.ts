import type { Variants } from 'motion/react';

export const avatarVariants: Variants = {
  idle: {
    scale: 1,
    opacity: 1,
    filter: 'brightness(0.8)',
    transition: { duration: 0.6, ease: 'easeOut' },
  },
  listening: {
    scale: 1.05,
    opacity: 1,
    filter: 'brightness(1)',
    transition: {
      scale: {
        duration: 0.8,
        repeat: Infinity,
        repeatType: 'reverse',
        ease: 'easeInOut',
      },
    },
  },
  thinking: {
    scale: 1,
    opacity: 1,
    filter: 'brightness(1)',
    transition: {
      opacity: {
        duration: 1.5,
        repeat: Infinity,
        repeatType: 'reverse',
        ease: 'easeInOut',
      },
    },
  },
  speaking: {
    scale: [1, 1.03, 1],
    opacity: 1,
    filter: 'brightness(1.1)',
    transition: {
      scale: {
        duration: 0.3,
        repeat: Infinity,
        repeatType: 'reverse',
        ease: 'easeInOut',
      },
    },
  },
  working: {
    scale: 1,
    opacity: 1,
    filter: 'brightness(1) saturate(1.2)',
    transition: { duration: 0.3 },
  },
  error: {
    scale: 1,
    opacity: 1,
    filter: 'brightness(1)',
    x: [0, -3, 3, -3, 0],
    transition: { x: { duration: 0.4 } },
  },
  offline: {
    scale: 0.95,
    opacity: 0.4,
    filter: 'brightness(0.5) grayscale(0.8)',
    transition: { duration: 0.8 },
  },
};

export const ringVariants: Variants = {
  idle: {
    opacity: 0.3,
    scale: 1,
  },
  listening: {
    opacity: 0.8,
    scale: 1.1,
    transition: {
      scale: { duration: 1, repeat: Infinity, repeatType: 'reverse' },
    },
  },
  thinking: {
    opacity: 0.6,
    scale: 1,
    transition: {
      opacity: { duration: 1.5, repeat: Infinity, repeatType: 'reverse' },
    },
  },
  speaking: {
    opacity: 1,
    scale: 1.05,
    transition: {
      scale: { duration: 0.25, repeat: Infinity, repeatType: 'reverse' },
    },
  },
  working: {
    opacity: 0.7,
    scale: 1,
  },
  error: {
    opacity: 1,
    scale: 1,
  },
  offline: {
    opacity: 0.1,
    scale: 1,
  },
};
