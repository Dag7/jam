import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { SoulStructure, IEventBus } from '@jam/core';
import { Events } from '@jam/core';

/** Maximum entries retained per soul array — oldest are pruned on evolve() */
const MAX_LEARNINGS = 50;
const MAX_GOALS = 20;
const MAX_TRAITS = 15;

/** Normalize a trait name to a canonical stem for fuzzy matching.
 *  Strips common suffixes (-ness, -ity, -ive, -tion) and normalizes separators. */
function traitStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_\s]+/g, '_')
    .replace(/(ness|ity|ive|tion|ment)$/, '')
    .replace(/_$/, '');
}

/** Find the existing trait key that matches `incoming`, or return `incoming` as-is if no match. */
function findCanonicalTrait(incoming: string, existing: Record<string, number>): string {
  // Exact match first
  if (incoming in existing) return incoming;

  // Fuzzy match: compare stems
  const incomingStem = traitStem(incoming);
  for (const key of Object.keys(existing)) {
    if (traitStem(key) === incomingStem) return key;
  }

  // No match — this is a genuinely new trait
  return incoming;
}

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

const KNOWN_SECTIONS = new Set(['role', 'persona', 'traits', 'goals', 'strengths', 'weaknesses', 'learnings']);

/** Parse YAML-like frontmatter from SOUL.md into SoulStructure. */
function parseSoulMd(content: string): SoulStructure {
  const soul = defaultSoul();

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    const extraFm: Record<string, string> = {};

    for (const line of frontmatter.split('\n')) {
      const [key, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (!key || !value) continue;

      const k = key.trim();
      if (k === 'version') soul.version = parseInt(value, 10) || 1;
      else if (k === 'lastReflection') soul.lastReflection = value;
      else if (k === 'persona') soul.persona = value;
      else if (k === 'role') soul.role = value;
      else extraFm[k] = value;
    }

    if (Object.keys(extraFm).length > 0) {
      soul.extraFrontmatter = extraFm;
    }
  }

  // Parse markdown sections — split body into heading+content blocks
  const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content;
  const sections: Array<{ heading: string; key: string; content: string }> = [];
  let currentHeading = '';
  let currentKey = '';
  let currentLines: string[] = [];

  for (const line of body.split('\n')) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      // Flush previous section
      if (currentHeading) {
        sections.push({ heading: currentHeading, key: currentKey, content: currentLines.join('\n') });
      }
      currentHeading = line;
      currentKey = headingMatch[1].toLowerCase().trim();
      currentLines = [];
      continue;
    }
    if (currentHeading) {
      currentLines.push(line);
    }
  }
  // Flush last section
  if (currentHeading) {
    sections.push({ heading: currentHeading, key: currentKey, content: currentLines.join('\n') });
  }

  const extraSections: Array<{ heading: string; content: string }> = [];

  for (const section of sections) {
    if (!KNOWN_SECTIONS.has(section.key)) {
      extraSections.push({ heading: section.heading, content: section.content });
      continue;
    }

    // Parse known sections from their content lines
    for (const line of section.content.split('\n')) {
      const bullet = line.match(/^[-*]\s+(.+)/);

      switch (section.key) {
        case 'goals':
          if (bullet) soul.goals.push(bullet[1].trim());
          break;
        case 'strengths':
          if (bullet) soul.strengths.push(bullet[1].trim());
          break;
        case 'weaknesses':
          if (bullet) soul.weaknesses.push(bullet[1].trim());
          break;
        case 'learnings':
          if (bullet) soul.learnings.push(bullet[1].trim());
          break;
        case 'traits': {
          if (!bullet) break;
          const traitMatch = bullet[1].match(/^(.+?):\s*([\d.]+)/);
          if (traitMatch) {
            soul.traits[traitMatch[1].trim()] = parseFloat(traitMatch[2]);
          }
          break;
        }
        case 'persona':
          if (!soul.persona && line.trim()) {
            soul.persona = line.trim();
          }
          break;
        case 'role':
          if (!soul.role && line.trim()) {
            soul.role = line.trim();
          }
          break;
      }
    }
  }

  if (extraSections.length > 0) {
    soul.extraSections = extraSections;
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
  if (soul.role) lines.push(`role: ${soul.role}`);
  if (soul.persona) lines.push(`persona: ${soul.persona}`);
  if (soul.extraFrontmatter) {
    for (const [key, value] of Object.entries(soul.extraFrontmatter)) {
      lines.push(`${key}: ${value}`);
    }
  }
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

  // Preserve unknown sections through round-trips
  if (soul.extraSections) {
    for (const section of soul.extraSections) {
      lines.push(section.heading);
      lines.push(section.content);
      if (!section.content.endsWith('\n')) lines.push('');
    }
  }

  return lines.join('\n');
}

export class SoulManager {
  /**
   * Optional resolver: maps agentId → directory containing SOUL.md.
   * When set, SoulManager reads/writes from the agent's workspace CWD
   * instead of the default `baseDir/{agentId}/` path. This eliminates
   * drift between the workspace copy and the canonical store.
   */
  private cwdResolver: ((agentId: string) => string | undefined) | null = null;

  constructor(
    private readonly baseDir: string,
    private readonly eventBus: IEventBus,
  ) {}

  /** Set a resolver that maps agent IDs to their workspace CWD.
   *  When set, SOUL.md is read/written from the workspace, not userData. */
  setCwdResolver(resolver: (agentId: string) => string | undefined): void {
    this.cwdResolver = resolver;
  }

  /** Resolve the SOUL.md path for an agent — prefers workspace CWD if resolver is set */
  private soulPath(agentId: string): string {
    const cwd = this.cwdResolver?.(agentId);
    if (cwd) return join(cwd, 'SOUL.md');
    return join(this.baseDir, agentId, 'SOUL.md');
  }

  async load(agentId: string): Promise<SoulStructure> {
    const filePath = this.soulPath(agentId);
    try {
      const content = await readFile(filePath, 'utf-8');
      return parseSoulMd(content);
    } catch {
      return defaultSoul();
    }
  }

  async save(agentId: string, soul: SoulStructure): Promise<void> {
    const filePath = this.soulPath(agentId);
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
      if (soul.learnings.length > MAX_LEARNINGS) {
        soul.learnings = soul.learnings.slice(-MAX_LEARNINGS);
      }
    }
    if (reflections.traitAdjustments) {
      for (const [trait, delta] of Object.entries(reflections.traitAdjustments)) {
        // Find existing trait that matches (case-insensitive, ignoring suffixes like -ness/-ity)
        const canonical = findCanonicalTrait(trait, soul.traits);
        const current = soul.traits[canonical] ?? 0.5;
        soul.traits[canonical] = Math.max(0, Math.min(1, current + delta));
      }
    }
    if (reflections.newGoals) {
      soul.goals.push(...reflections.newGoals);
      if (soul.goals.length > MAX_GOALS) {
        soul.goals = soul.goals.slice(-MAX_GOALS);
      }
    }
    if (reflections.newStrengths) {
      soul.strengths.push(...reflections.newStrengths);
      if (soul.strengths.length > MAX_TRAITS) {
        soul.strengths = soul.strengths.slice(-MAX_TRAITS);
      }
    }
    if (reflections.newWeaknesses) {
      soul.weaknesses.push(...reflections.newWeaknesses);
      if (soul.weaknesses.length > MAX_TRAITS) {
        soul.weaknesses = soul.weaknesses.slice(-MAX_TRAITS);
      }
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
