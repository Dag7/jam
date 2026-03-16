import fs from 'node:fs';
import path from 'node:path';

export function readJsonFile(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.services)) return parsed.services;
      if (Array.isArray(parsed.crons)) return parsed.crons;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
      return [];
    } catch {
      // Try line-delimited JSON
      const entries: Record<string, unknown>[] = [];
      for (const line of content.split('\n')) {
        const l = line.trim();
        if (!l) continue;
        try { entries.push(JSON.parse(l)); } catch { /* skip malformed lines */ }
      }
      return entries;
    }
  } catch {
    return [];
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
