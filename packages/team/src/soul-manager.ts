import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { SoulStructure, IEventBus } from '@jam/core';
import { Events } from '@jam/core';

function defaultSoul(): SoulStructure {
  return {
    persona: '',
    role: '',
    traits: {},
    goals: [],
    strengths: [],
    weaknesses: [],
    learnings: [],
    lastReflection: new Date().toISOString(),
    version: 1,
  };
}

/** Parse YAML-like frontmatter from SOUL.md into SoulStructure. */
function parseSoulMd(content: string): SoulStructure {
  const soul = defaultSoul();

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    for (const line of frontmatter.split('\n')) {
      const [key, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (!key || !value) continue;

      const k = key.trim();
      if (k === 'version') soul.version = parseInt(value, 10) || 1;
      else if (k === 'lastReflection') soul.lastReflection = value;
      else if (k === 'persona') soul.persona = value;
      else if (k === 'role') soul.role = value;
    }
  }

  // Parse markdown sections
  const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content;
  let currentSection = '';

  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      currentSection = heading[1].toLowerCase();
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)/);
    if (!bullet) continue;
    const item = bullet[1].trim();

    switch (currentSection) {
      case 'goals':
        soul.goals.push(item);
        break;
      case 'strengths':
        soul.strengths.push(item);
        break;
      case 'weaknesses':
        soul.weaknesses.push(item);
        break;
      case 'learnings':
        soul.learnings.push(item);
        break;
      case 'traits': {
        const traitMatch = item.match(/^(.+?):\s*([\d.]+)/);
        if (traitMatch) {
          soul.traits[traitMatch[1].trim()] = parseFloat(traitMatch[2]);
        }
        break;
      }
    }
  }

  // If no persona in frontmatter, try to extract from body
  if (!soul.persona) {
    const personaSection = body.match(/##\s+Persona\n([\s\S]*?)(?=\n##|$)/);
    if (personaSection) {
      soul.persona = personaSection[1].trim();
    }
  }

  // If no role in frontmatter, try to extract from body
  if (!soul.role) {
    const roleSection = body.match(/##\s+Role\n([\s\S]*?)(?=\n##|$)/);
    if (roleSection) {
      soul.role = roleSection[1].trim();
    }
  }

  return soul;
}

/** Serialize SoulStructure to SOUL.md format. */
function serializeSoulMd(soul: SoulStructure): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`version: ${soul.version}`);
  lines.push(`lastReflection: ${soul.lastReflection}`);
  if (soul.persona) lines.push(`persona: ${soul.persona}`);
  if (soul.role) lines.push(`role: ${soul.role}`);
  lines.push('---');
  lines.push('');

  if (soul.role) {
    lines.push('## Role');
    lines.push(soul.role);
    lines.push('');
  }

  if (soul.persona) {
    lines.push('## Persona');
    lines.push(soul.persona);
    lines.push('');
  }

  if (Object.keys(soul.traits).length > 0) {
    lines.push('## Traits');
    for (const [name, value] of Object.entries(soul.traits)) {
      lines.push(`- ${name}: ${value}`);
    }
    lines.push('');
  }

  if (soul.goals.length > 0) {
    lines.push('## Goals');
    for (const g of soul.goals) lines.push(`- ${g}`);
    lines.push('');
  }

  if (soul.strengths.length > 0) {
    lines.push('## Strengths');
    for (const s of soul.strengths) lines.push(`- ${s}`);
    lines.push('');
  }

  if (soul.weaknesses.length > 0) {
    lines.push('## Weaknesses');
    for (const w of soul.weaknesses) lines.push(`- ${w}`);
    lines.push('');
  }

  if (soul.learnings.length > 0) {
    lines.push('## Learnings');
    for (const l of soul.learnings) lines.push(`- ${l}`);
    lines.push('');
  }

  return lines.join('\n');
}

export class SoulManager {
  constructor(
    private readonly baseDir: string,
    private readonly eventBus: IEventBus,
  ) {}

  async load(agentId: string): Promise<SoulStructure> {
    const filePath = join(this.baseDir, agentId, 'SOUL.md');
    try {
      const content = await readFile(filePath, 'utf-8');
      return parseSoulMd(content);
    } catch {
      return defaultSoul();
    }
  }

  async save(agentId: string, soul: SoulStructure): Promise<void> {
    const filePath = join(this.baseDir, agentId, 'SOUL.md');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, serializeSoulMd(soul), 'utf-8');
  }

  async evolve(
    agentId: string,
    reflections: {
      newLearnings?: string[];
      traitAdjustments?: Record<string, number>;
      newGoals?: string[];
      newStrengths?: string[];
      newWeaknesses?: string[];
      role?: string;
    },
  ): Promise<SoulStructure> {
    const soul = await this.load(agentId);

    if (reflections.role) {
      soul.role = reflections.role;
    }
    if (reflections.newLearnings) {
      soul.learnings.push(...reflections.newLearnings);
    }
    if (reflections.traitAdjustments) {
      for (const [trait, delta] of Object.entries(reflections.traitAdjustments)) {
        const current = soul.traits[trait] ?? 0.5;
        soul.traits[trait] = Math.max(0, Math.min(1, current + delta));
      }
    }
    if (reflections.newGoals) {
      soul.goals.push(...reflections.newGoals);
    }
    if (reflections.newStrengths) {
      soul.strengths.push(...reflections.newStrengths);
    }
    if (reflections.newWeaknesses) {
      soul.weaknesses.push(...reflections.newWeaknesses);
    }

    soul.version++;
    soul.lastReflection = new Date().toISOString();

    await this.save(agentId, soul);

    this.eventBus.emit(Events.SOUL_EVOLVED, {
      agentId,
      soul,
      version: soul.version,
    });

    return soul;
  }
}
