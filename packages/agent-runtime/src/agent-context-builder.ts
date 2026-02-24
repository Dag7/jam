import { readFile, readdir, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { AgentProfile } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('AgentContextBuilder');

export interface ConversationEntry {
  timestamp: string;
  role: 'user' | 'agent';
  content: string;
  source?: 'text' | 'voice';
  /** Hidden entries are persisted for agent context but excluded from chat history UI */
  hidden?: boolean;
}

export interface SkillDefinition {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}

const MAX_CONVERSATION_HISTORY = 20;
const MAX_SYSTEM_PROMPT_LENGTH = 12_000;
const CONVERSATION_DIR = 'conversations';
const SKILLS_DIR = 'skills';
const SOUL_FILE = 'SOUL.md';

export class AgentContextBuilder {
  /** Shared skills directory — loaded for all agents (agent-specific overrides shared) */
  private sharedSkillsDir: string | null = null;

  setSharedSkillsDir(dir: string): void {
    this.sharedSkillsDir = dir;
  }

  /** Build enriched profile with SOUL.md, conversation history, and matched skills */
  async buildContext(profile: AgentProfile, commandText: string): Promise<AgentProfile> {
    const cwd = profile.cwd;
    if (!cwd) return profile;

    const [soulContent, recentHistory, matchedSkills] = await Promise.all([
      this.readSoul(cwd),
      this.loadRecentConversations(cwd, MAX_CONVERSATION_HISTORY),
      this.matchSkills(cwd, commandText),
    ]);

    if (matchedSkills.length > 0) {
      log.info(`Matched ${matchedSkills.length} skills: ${matchedSkills.map(s => s.name).join(', ')}`, undefined, profile.id);
    }

    const enrichedPrompt = this.composeSystemPrompt(profile, soulContent, recentHistory, matchedSkills);
    log.debug(`System prompt: ${enrichedPrompt.length} chars (soul=${soulContent.length}, history=${recentHistory.length}, skills=${matchedSkills.length})`, undefined, profile.id);

    return { ...profile, systemPrompt: enrichedPrompt };
  }

  /** Append a conversation entry to today's JSONL log */
  async recordConversation(cwd: string, entry: ConversationEntry): Promise<void> {
    const dir = join(cwd, CONVERSATION_DIR);
    await mkdir(dir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const filePath = join(dir, `${today}.jsonl`);
    const line = JSON.stringify(entry) + '\n';
    await appendFile(filePath, line, 'utf-8');
  }

  /** Generate initial SOUL.md from the agent's system prompt */
  async initializeSoul(cwd: string, profile: AgentProfile): Promise<void> {
    const soulPath = join(cwd, SOUL_FILE);
    if (existsSync(soulPath)) return;

    await mkdir(cwd, { recursive: true });
    const content = this.generateInitialSoul(profile);
    await writeFile(soulPath, content, 'utf-8');
    log.info(`Created SOUL.md for "${profile.name}"`, undefined, profile.id);
  }

  /** Create the skills directory scaffold */
  async initializeSkillsDir(cwd: string): Promise<void> {
    await mkdir(join(cwd, SKILLS_DIR), { recursive: true });
  }

  /** Load conversation history with pagination (for chat UI).
   *  Returns entries in chronological order, oldest first. */
  async loadPaginatedConversations(
    cwd: string,
    options: { before?: string; limit: number },
  ): Promise<{ entries: ConversationEntry[]; hasMore: boolean }> {
    const dir = join(cwd, CONVERSATION_DIR);
    try {
      const files = await readdir(dir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort().reverse();

      const allEntries: ConversationEntry[] = [];
      for (const file of jsonlFiles) {
        const content = await readFile(join(dir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try { allEntries.push(JSON.parse(line)); } catch { /* skip */ }
        }
      }

      // Sort chronologically, with user before agent as tiebreaker for identical timestamps
      allEntries.sort((a, b) => {
        const cmp = a.timestamp.localeCompare(b.timestamp);
        if (cmp !== 0) return cmp;
        if (a.role === 'user' && b.role !== 'user') return -1;
        if (a.role !== 'user' && b.role === 'user') return 1;
        return 0;
      });

      // Exclude hidden entries (e.g. task trigger prompts) from UI history
      let filtered = allEntries.filter(e => !e.hidden);
      if (options.before) {
        filtered = allEntries.filter(e => e.timestamp < options.before!);
      }

      // Take the last `limit` entries (most recent ones before cursor)
      const hasMore = filtered.length > options.limit;
      const page = filtered.slice(-options.limit);

      return { entries: page, hasMore };
    } catch {
      return { entries: [], hasMore: false };
    }
  }

  // --- Private ---

  private async readSoul(cwd: string): Promise<string> {
    try {
      return await readFile(join(cwd, SOUL_FILE), 'utf-8');
    } catch {
      return '';
    }
  }

  private async loadRecentConversations(cwd: string, limit: number): Promise<ConversationEntry[]> {
    const dir = join(cwd, CONVERSATION_DIR);
    try {
      const files = await readdir(dir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort().reverse();

      const entries: ConversationEntry[] = [];
      for (const file of jsonlFiles) {
        if (entries.length >= limit) break;
        const content = await readFile(join(dir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        for (const line of lines.reverse()) {
          if (entries.length >= limit) break;
          try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
        }
      }
      return entries.reverse(); // chronological order
    } catch {
      return [];
    }
  }

  private async matchSkills(cwd: string, commandText: string): Promise<SkillDefinition[]> {
    // Load from agent's own skills dir + shared skills dir
    const [agentSkills, sharedSkills] = await Promise.all([
      this.loadSkillsFromDir(join(cwd, SKILLS_DIR)),
      this.sharedSkillsDir ? this.loadSkillsFromDir(this.sharedSkillsDir) : Promise.resolve([]),
    ]);

    // Merge: agent-specific skills override shared ones (by name)
    const agentNames = new Set(agentSkills.map(s => s.name));
    const merged = [...agentSkills, ...sharedSkills.filter(s => !agentNames.has(s.name))];

    // Filter by trigger match
    const lowerCommand = commandText.toLowerCase();
    return merged.filter(skill =>
      skill.triggers.some(trigger => lowerCommand.includes(trigger.toLowerCase()))
    );
  }

  private async loadSkillsFromDir(dir: string): Promise<SkillDefinition[]> {
    try {
      const files = await readdir(dir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      const skills: SkillDefinition[] = [];
      for (const file of mdFiles) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const skill = this.parseSkillFile(content);
          if (skill) skills.push(skill);
        } catch { /* skip unreadable */ }
      }
      return skills;
    } catch {
      return [];
    }
  }

  private parseSkillFile(content: string): SkillDefinition | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const [, frontmatter, body] = match;
    const meta: Record<string, string> = {};
    for (const line of frontmatter.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        meta[key] = value;
      }
    }

    if (!meta.name || !meta.triggers) return null;

    return {
      name: meta.name,
      description: meta.description || '',
      triggers: meta.triggers.split(',').map(t => t.trim()).filter(Boolean),
      body: body.trim(),
    };
  }

  private generateInitialSoul(profile: AgentProfile): string {
    const sections: string[] = [
      `# ${profile.name}`,
      '',
      '## Identity',
      `You are ${profile.name}.`,
    ];

    if (profile.systemPrompt) {
      sections.push('', '## Core Directives', profile.systemPrompt);
    }

    sections.push(
      '',
      '## Personality',
      '<!-- Evolve this section over time as you develop preferences and style -->',
      '',
      '## Notes',
      '<!-- Add observations, learned behaviors, and important context here -->',
    );

    return sections.join('\n') + '\n';
  }

  private composeSystemPrompt(
    profile: AgentProfile,
    soulContent: string,
    history: ConversationEntry[],
    skills: SkillDefinition[],
  ): string {
    const sections: string[] = [];

    // 1. Identity
    sections.push(`Your name is ${profile.name}. When asked who you are, respond as ${profile.name}.`);

    // 2. Workspace
    if (profile.cwd) {
      sections.push(
        `Your workspace directory is: ${profile.cwd}`,
        'All files you create should be placed in this directory unless the user specifies otherwise.',
      );
    }

    // 3. SOUL.md
    if (soulContent) {
      sections.push('--- YOUR SOUL ---', soulContent, '--- END SOUL ---');
    }

    // 4. Conversation history
    if (history.length > 0) {
      const historyLines = history.map(e =>
        `[${e.timestamp}] ${e.role === 'user' ? 'User' : 'You'}: ${e.content.slice(0, 300)}`
      );
      sections.push(
        '--- RECENT CONVERSATION HISTORY ---',
        historyLines.join('\n'),
        '--- END HISTORY ---',
      );
    }

    // 5. Matched skills
    if (skills.length > 0) {
      const skillBlocks = skills.map(s =>
        `### Skill: ${s.name}\n${s.description ? s.description + '\n' : ''}${s.body}`
      );
      sections.push(
        '--- RELEVANT SKILLS ---',
        skillBlocks.join('\n\n'),
        '--- END SKILLS ---',
      );
    }

    // 6. Skill system instructions
    sections.push(
      '--- SKILL & MEMORY SYSTEM ---',
      'You can create reusable skills by writing .md files to your skills/ directory.',
      'Skill file format:',
      '```',
      '---',
      'name: skill-name',
      'description: What this skill does',
      'triggers: keyword1, keyword2, keyword3',
      '---',
      'Detailed instructions...',
      '```',
      'Skills are automatically loaded when the user\'s message matches trigger keywords.',
      'You can also update your SOUL.md file to evolve your personality and remember important information.',
      '--- END SKILL & MEMORY SYSTEM ---',
    );

    let prompt = sections.join('\n\n');

    // Truncate if too long — preserve head (identity + soul) and tail (instructions)
    if (prompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      const headBudget = Math.floor(MAX_SYSTEM_PROMPT_LENGTH * 0.7);
      const tailBudget = MAX_SYSTEM_PROMPT_LENGTH - headBudget - 50;
      prompt = prompt.slice(0, headBudget)
        + '\n\n... (context truncated) ...\n\n'
        + prompt.slice(prompt.length - tailBudget);
    }

    return prompt;
  }
}
