/**
 * Minimal 5-field cron expression parser (zero dependencies).
 * Format: minute hour day-of-month month day-of-week
 *
 * Supports: *, numbers, ranges (1-5), steps (∗/15), lists (1,3,5)
 * Does NOT support @yearly aliases or complex extensions — KISS.
 */

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
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
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

/** Check if a cron expression is due at the given date */
export function isCronDue(expression: string, date: Date): boolean {
  const fields = parseCron(expression);

  return (
    fields.minute.has(date.getMinutes()) &&
    fields.hour.has(date.getHours()) &&
    fields.dayOfMonth.has(date.getDate()) &&
    fields.month.has(date.getMonth() + 1) &&
    fields.dayOfWeek.has(date.getDay())
  );
}

/** Compute the next time a cron expression will fire after `from` (within `maxDays` days) */
export function nextCronRun(expression: string, from: Date = new Date(), maxDays = 7): Date | null {
  const fields = parseCron(expression);
  const candidate = new Date(from);
  // Start from the next minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = from.getTime() + maxDays * 24 * 60 * 60 * 1000;

  while (candidate.getTime() <= limit) {
    if (
      fields.month.has(candidate.getMonth() + 1) &&
      fields.dayOfMonth.has(candidate.getDate()) &&
      fields.dayOfWeek.has(candidate.getDay()) &&
      fields.hour.has(candidate.getHours()) &&
      fields.minute.has(candidate.getMinutes())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

/** Convert a cron expression to a human-readable string */
export function cronToHuman(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hr, dom, mon, dow] = parts;

  // Common patterns
  if (min !== '*' && hr !== '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (min !== '*' && hr !== '*' && dom === '*' && mon === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = days[parseInt(dow, 10)] ?? dow;
    return `${dayName} at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (min === '0' && hr.startsWith('*/')) {
    return `Every ${hr.slice(2)} hours`;
  }
  if (min.startsWith('*/') && hr === '*') {
    return `Every ${min.slice(2)} minutes`;
  }

  return expression;
}
