import { useState, useEffect, useCallback } from 'react';

interface ScheduleEntry {
  id: string;
  name: string;
  pattern: {
    cron?: string;
    intervalMs?: number;
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
  };
  taskTemplate?: {
    title: string;
    description: string;
    priority?: string;
    assignedTo?: string;
    tags?: string[];
  };
  enabled: boolean;
  lastRun: string | null;
  source: 'system' | 'user' | 'agent';
  createdAt: string;
}

type PatternType = 'interval' | 'daily' | 'cron';

interface ScheduleFormData {
  name: string;
  patternType: PatternType;
  intervalMinutes: number;
  dailyHour: number;
  dailyMinute: number;
  cronExpr: string;
  taskTitle: string;
  taskDescription: string;
  taskPriority: string;
}

const EMPTY_FORM: ScheduleFormData = {
  name: '',
  patternType: 'interval',
  intervalMinutes: 60,
  dailyHour: 9,
  dailyMinute: 0,
  cronExpr: '0 */6 * * *',
  taskTitle: '',
  taskDescription: '',
  taskPriority: 'normal',
};

function formToPattern(form: ScheduleFormData): Record<string, unknown> {
  switch (form.patternType) {
    case 'interval':
      return { intervalMs: form.intervalMinutes * 60_000 };
    case 'daily':
      return { cron: `${form.dailyMinute} ${form.dailyHour} * * *` };
    case 'cron':
      return { cron: form.cronExpr };
  }
}

function entryToForm(s: ScheduleEntry): ScheduleFormData {
  const form = { ...EMPTY_FORM, name: s.name };
  if (s.pattern.intervalMs) {
    form.patternType = 'interval';
    form.intervalMinutes = Math.round(s.pattern.intervalMs / 60_000);
  } else if (s.pattern.cron) {
    const parts = s.pattern.cron.trim().split(/\s+/);
    if (parts.length === 5 && parts[2] === '*' && parts[3] === '*' && parts[4] === '*' && !parts[0].includes('*') && !parts[1].includes('*')) {
      form.patternType = 'daily';
      form.dailyHour = parseInt(parts[1], 10);
      form.dailyMinute = parseInt(parts[0], 10);
    } else {
      form.patternType = 'cron';
      form.cronExpr = s.pattern.cron;
    }
  }
  if (s.taskTemplate) {
    form.taskTitle = s.taskTemplate.title ?? '';
    form.taskDescription = s.taskTemplate.description ?? '';
    form.taskPriority = s.taskTemplate.priority ?? 'normal';
  }
  return form;
}

function patternToHuman(pattern: ScheduleEntry['pattern']): string {
  if (pattern.cron) {
    const parts = pattern.cron.trim().split(/\s+/);
    if (parts.length !== 5) return pattern.cron;
    const [min, hr, , , dow] = parts;
    if (min !== '*' && hr !== '*' && dow === '*') {
      return `Daily at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (min !== '*' && hr !== '*' && dow !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `${days[parseInt(dow, 10)] ?? dow} at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (min === '0' && hr.startsWith('*/')) return `Every ${hr.slice(2)} hours`;
    if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
    return pattern.cron;
  }
  if (pattern.intervalMs) {
    const mins = Math.round(pattern.intervalMs / 60_000);
    if (mins >= 60) return `Every ${Math.round(mins / 60)}h`;
    return `Every ${mins}m`;
  }
  if (pattern.hour !== undefined && pattern.minute !== undefined) {
    const time = `${String(pattern.hour).padStart(2, '0')}:${String(pattern.minute).padStart(2, '0')}`;
    if (pattern.dayOfWeek !== undefined) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `${days[pattern.dayOfWeek]} at ${time}`;
    }
    return `Daily at ${time}`;
  }
  return 'Unknown';
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeUntil(date: Date): string {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'Now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return remainMins > 0 ? `in ${hours}h ${remainMins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

function computeNextRun(pattern: ScheduleEntry['pattern'], lastRun: string | null, enabled: boolean): string {
  if (!enabled) return '—';

  // Interval-based: next = lastRun + interval (or now if never run)
  if (pattern.intervalMs) {
    const base = lastRun ? new Date(lastRun).getTime() : Date.now();
    const next = new Date(base + pattern.intervalMs);
    if (next.getTime() <= Date.now()) return 'Due now';
    return timeUntil(next);
  }

  // Cron-based: brute-force find next matching minute
  if (pattern.cron) {
    const next = nextCronMatch(pattern.cron);
    return next ? timeUntil(next) : '—';
  }

  // Legacy hour/minute pattern
  if (pattern.hour !== undefined && pattern.minute !== undefined) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(pattern.hour, pattern.minute, 0, 0);
    if (pattern.dayOfWeek !== undefined) {
      const daysUntil = (pattern.dayOfWeek - now.getDay() + 7) % 7 || (next <= now ? 7 : 0);
      next.setDate(next.getDate() + daysUntil);
    } else if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return timeUntil(next);
  }

  return '—';
}

/** Minimal cron next-match: scans forward minute-by-minute (max 7 days) */
function nextCronMatch(expression: string): Date | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const parseField = (field: string, min: number, max: number): Set<number> => {
    const result = new Set<number>();
    for (const part of field.split(',')) {
      const stepMatch = part.match(/^(.+)\/(\d+)$/);
      const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
      const range = stepMatch ? stepMatch[1] : part;
      if (range === '*') {
        for (let i = min; i <= max; i += step) result.add(i);
      } else if (range.includes('-')) {
        const [lo, hi] = range.split('-').map(Number);
        for (let i = lo; i <= hi; i += step) result.add(i);
      } else {
        result.add(parseInt(range, 10));
      }
    }
    return result;
  };

  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dayOfMonth = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dayOfWeek = parseField(parts[4], 0, 6);

  const candidate = new Date();
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = Date.now() + 7 * 24 * 60 * 60 * 1000;
  while (candidate.getTime() <= limit) {
    if (
      month.has(candidate.getMonth() + 1) &&
      dayOfMonth.has(candidate.getDate()) &&
      dayOfWeek.has(candidate.getDay()) &&
      hour.has(candidate.getHours()) &&
      minute.has(candidate.getMinutes())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

function ScheduleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ScheduleFormData;
  onSave: (form: ScheduleFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = <K extends keyof ScheduleFormData>(key: K, value: ScheduleFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const valid = form.name.trim() && form.taskTitle.trim();

  return (
    <div className="border border-zinc-700 rounded-lg p-4 space-y-3 bg-zinc-900/50">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Schedule Name</span>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            placeholder="e.g. Daily Code Review"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Pattern Type</span>
          <select
            value={form.patternType}
            onChange={(e) => set('patternType', e.target.value as PatternType)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
          >
            <option value="interval">Interval</option>
            <option value="daily">Daily at time</option>
            <option value="cron">Cron expression</option>
          </select>
        </label>
      </div>

      {form.patternType === 'interval' && (
        <label className="space-y-1 block">
          <span className="text-xs text-zinc-400">Interval (minutes)</span>
          <input
            type="number"
            min={1}
            value={form.intervalMinutes}
            onChange={(e) => set('intervalMinutes', Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-32 px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
          />
        </label>
      )}

      {form.patternType === 'daily' && (
        <div className="flex gap-2 items-end">
          <label className="space-y-1">
            <span className="text-xs text-zinc-400">Hour (0-23)</span>
            <input
              type="number"
              min={0}
              max={23}
              value={form.dailyHour}
              onChange={(e) => set('dailyHour', Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
              className="w-20 px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-zinc-400">Minute (0-59)</span>
            <input
              type="number"
              min={0}
              max={59}
              value={form.dailyMinute}
              onChange={(e) => set('dailyMinute', Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
              className="w-20 px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </label>
        </div>
      )}

      {form.patternType === 'cron' && (
        <label className="space-y-1 block">
          <span className="text-xs text-zinc-400">Cron Expression (min hr dom mon dow)</span>
          <input
            value={form.cronExpr}
            onChange={(e) => set('cronExpr', e.target.value)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
            placeholder="0 */6 * * *"
          />
        </label>
      )}

      <hr className="border-zinc-800" />

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Task Title</span>
          <input
            value={form.taskTitle}
            onChange={(e) => set('taskTitle', e.target.value)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            placeholder="e.g. Review open PRs"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Priority</span>
          <select
            value={form.taskPriority}
            onChange={(e) => set('taskPriority', e.target.value)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-xs text-zinc-400">Task Description</span>
        <textarea
          value={form.taskDescription}
          onChange={(e) => set('taskDescription', e.target.value)}
          rows={2}
          className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 resize-none"
          placeholder="What should the agent do?"
        />
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => valid && onSave(form)}
          disabled={!valid}
          className="px-3 py-1.5 rounded text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function ScheduleList() {
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await window.jam.team.schedules.list();
    setSchedules(result as unknown as ScheduleEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (id: string, currentEnabled: boolean) => {
    await window.jam.team.schedules.update(id, { enabled: !currentEnabled });
    load();
  };

  const deleteSchedule = async (id: string) => {
    const result = await window.jam.team.schedules.delete(id);
    if (result.success) load();
  };

  const handleCreate = async (form: ScheduleFormData) => {
    const result = await window.jam.team.schedules.create({
      name: form.name,
      pattern: formToPattern(form),
      taskTemplate: {
        title: form.taskTitle,
        description: form.taskDescription,
        priority: form.taskPriority,
        source: 'user',
        createdBy: 'user',
        tags: [],
      },
    });
    if (result.success) {
      setShowCreate(false);
      load();
    }
  };

  const handleEdit = async (id: string, form: ScheduleFormData) => {
    const result = await window.jam.team.schedules.update(id, {
      name: form.name,
      pattern: formToPattern(form),
      taskTemplate: {
        title: form.taskTitle,
        description: form.taskDescription,
        priority: form.taskPriority,
        source: 'user',
        createdBy: 'user',
        tags: [],
      },
    });
    if (result.success) {
      setEditingId(null);
      load();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
        Loading schedules...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with add button */}
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-xs text-zinc-500">{schedules.length} schedule{schedules.length !== 1 ? 's' : ''}</span>
        {!showCreate && (
          <button
            onClick={() => { setShowCreate(true); setEditingId(null); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Schedule
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-3">
          <ScheduleForm
            initial={EMPTY_FORM}
            onSave={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {schedules.length === 0 && !showCreate && (
        <div className="flex items-center justify-center py-8 text-zinc-500 text-sm">
          No schedules configured
        </div>
      )}

      {schedules.length > 0 && (
        <>
          <div className="grid grid-cols-[1fr_140px_80px_80px_80px_80px] gap-2 px-3 py-2 text-xs text-zinc-500 font-medium border-b border-zinc-800">
            <span>Schedule</span>
            <span>Pattern</span>
            <span>Last Run</span>
            <span>Next Run</span>
            <span>Source</span>
            <span>Actions</span>
          </div>
          {schedules.map((s) =>
            editingId === s.id ? (
              <div key={s.id} className="px-3">
                <ScheduleForm
                  initial={entryToForm(s)}
                  onSave={(form) => handleEdit(s.id, form)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div
                key={s.id}
                className={`grid grid-cols-[1fr_140px_80px_80px_80px_80px] gap-2 px-3 py-2 text-xs rounded hover:bg-zinc-800/50 ${
                  s.enabled ? 'text-zinc-200' : 'text-zinc-500'
                }`}
              >
                <span className="truncate font-medium">{s.name}</span>
                <span className="text-zinc-400">{patternToHuman(s.pattern)}</span>
                <span className="text-zinc-500">{timeAgo(s.lastRun)}</span>
                <span className="text-zinc-400">{computeNextRun(s.pattern, s.lastRun, s.enabled)}</span>
                <span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      s.source === 'system'
                        ? 'bg-blue-500/20 text-blue-400'
                        : s.source === 'agent'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {s.source}
                  </span>
                </span>
                <span className="flex gap-1">
                  <button
                    onClick={() => toggleEnabled(s.id, s.enabled)}
                    className={`p-1 rounded transition-colors ${
                      s.enabled
                        ? 'text-green-400 hover:bg-green-500/20'
                        : 'text-zinc-500 hover:bg-zinc-700'
                    }`}
                    title={s.enabled ? 'Disable' : 'Enable'}
                  >
                    {s.enabled ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M4.93 4.93l14.14 14.14" /></svg>
                    )}
                  </button>
                  <button
                    onClick={() => { setEditingId(s.id); setShowCreate(false); }}
                    className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                    title="Edit"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                  {s.source !== 'system' && (
                    <button
                      onClick={() => deleteSchedule(s.id)}
                      className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Delete"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  )}
                </span>
              </div>
            ),
          )}
        </>
      )}
    </div>
  );
}
