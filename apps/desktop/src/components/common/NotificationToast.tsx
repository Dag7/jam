import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface Notification {
  id: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  body?: string;
}

interface NotificationToastProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const levelStyles = {
  info: 'border-blue-800 bg-blue-900/30',
  warning: 'border-yellow-800 bg-yellow-900/30',
  error: 'border-red-800 bg-red-900/30',
};

export const NotificationToast: React.FC<NotificationToastProps> = ({
  notifications,
  onDismiss,
}) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={`
              rounded-lg border p-3 shadow-lg backdrop-blur-sm
              ${levelStyles[n.level]}
            `}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-zinc-200">
                  {n.title}
                </div>
                {n.body && (
                  <div className="text-xs text-zinc-400 mt-0.5">{n.body}</div>
                )}
              </div>
              <button
                onClick={() => onDismiss(n.id)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="3" y1="3" x2="11" y2="11" />
                  <line x1="11" y1="3" x2="3" y2="11" />
                </svg>
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
