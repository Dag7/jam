import { useMemo } from 'react';
import { useAppStore } from '@/store';
import type { Notification } from '@/store/notificationSlice';
import { formatTimeAgo } from '@/utils/format';

function NotificationItem({
  notification,
  agentName,
  agentColor,
  onMarkRead,
}: {
  notification: Notification;
  agentName?: string;
  agentColor?: string;
  onMarkRead: (id: string) => void;
}) {
  const isSuccess = notification.type === 'task_completed';

  return (
    <button
      onClick={() => onMarkRead(notification.id)}
      className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-zinc-800/50 border-l-2 ${
        notification.read ? 'border-transparent' : 'border-amber-500'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Agent avatar */}
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5"
          style={{ backgroundColor: agentColor ?? '#8b5cf6' }}
        >
          {(agentName ?? 'J').charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title + status badge */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-xs font-medium truncate ${notification.read ? 'text-zinc-400' : 'text-zinc-200'}`}>
              {notification.title}
            </span>
            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
              isSuccess
                ? 'bg-green-900/50 text-green-400'
                : 'bg-red-900/50 text-red-400'
            }`}>
              {isSuccess ? 'done' : 'failed'}
            </span>
          </div>

          {/* Summary preview */}
          {notification.summary && (
            <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
              {notification.summary}
            </p>
          )}

          {/* Agent name + timestamp */}
          <div className="flex items-center gap-2 mt-1">
            {agentName && (
              <span className="text-[10px] text-zinc-600">{agentName}</span>
            )}
            <span className="text-[10px] text-zinc-600">
              {formatTimeAgo(notification.timestamp)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const notifications = useAppStore((s) => s.notifications);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);
  const clearAllNotifications = useAppStore((s) => s.clearAllNotifications);
  const agents = useAppStore((s) => s.agents);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        className="absolute top-[42px] right-16 w-80 max-h-[70vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={markAllNotificationsRead}
                className="text-[11px] px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clearAllNotifications}
                className="text-[11px] px-2 py-1 rounded text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2 opacity-50">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="text-xs">No notifications</span>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {notifications.map((n) => {
                const agentEntry = agents[n.agentId];
                return (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    agentName={agentEntry?.profile.name}
                    agentColor={agentEntry?.profile.color}
                    onMarkRead={markNotificationRead}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
