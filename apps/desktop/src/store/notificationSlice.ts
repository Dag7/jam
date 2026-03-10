import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type NotificationType = 'task_completed' | 'task_failed' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  agentId: string;
  title: string;
  summary: string;
  taskId: string;
  timestamp: number;
  read: boolean;
  /** Suggested recovery action for errors */
  recoveryAction?: 'retry' | 'reconfigure' | 'dismiss';
}

export interface NotificationSlice {
  notifications: Notification[];
  addNotification: (n: Notification) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearAllNotifications: () => void;
}

/** Max notifications kept in store (oldest pruned on add) */
const MAX_NOTIFICATIONS = 200;

export const createNotificationSlice: StateCreator<
  AppStore,
  [],
  [],
  NotificationSlice
> = (set) => ({
  notifications: [],

  addNotification: (n) =>
    set((state) => ({
      notifications: [n, ...state.notifications].slice(0, MAX_NOTIFICATIONS),
    })),

  markNotificationRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    })),

  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),

  clearAllNotifications: () =>
    set({ notifications: [] }),
});
