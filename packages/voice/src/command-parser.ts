import type { AgentId } from '@jam/core';

export type CommandType = 'task' | 'status-query' | 'interrupt' | 'meta';

export interface ParsedCommand {
  targetAgentName: string | null;
  command: string;
  isMetaCommand: boolean;
  commandType: CommandType;
}

const META_COMMANDS = [
  'create',
  'delete',
  'restart',
  'list',
  'configure',
];

const STATUS_PATTERNS = [
  /\bstatus\b/i,
  /\bupdate\b/i,
  /\bprogress\b/i,
  /\bwhat are you doing\b/i,
  /\bwhat's happening\b/i,
  /\bwhats happening\b/i,
  /\bwhere are you\b/i,
  /\bhow's it going\b/i,
  /\bhows it going\b/i,
  /\bwhat are you working on\b/i,
  /\bare you done\b/i,
  /\bare you busy\b/i,
  /\bhow far along\b/i,
];

const INTERRUPT_PATTERNS = [
  /\bstop\b/i,
  /\bcancel\b/i,
  /\babort\b/i,
  /\bnever\s?mind\b/i,
  /\bquit\b/i,
  /\bforget it\b/i,
];

export class CommandParser {
  private agentNames: Map<string, AgentId> = new Map();

  getAgentNames(): string[] {
    return Array.from(this.agentNames.keys());
  }

  updateAgentNames(agents: Array<{ id: AgentId; name: string }>): void {
    this.agentNames.clear();
    for (const agent of agents) {
      this.agentNames.set(agent.name.toLowerCase(), agent.id);
    }
  }

  parse(transcript: string): ParsedCommand {
    const trimmed = transcript.trim();
    const lower = trimmed.toLowerCase();

    // Check for meta commands first (e.g., "create new agent named Ray")
    for (const meta of META_COMMANDS) {
      if (lower.startsWith(meta)) {
        return {
          targetAgentName: null,
          command: trimmed,
          isMetaCommand: true,
          commandType: 'meta',
        };
      }
    }

    // Extract target agent name first
    const targetAgentName = this.extractAgentName(trimmed, lower);
    const command = targetAgentName
      ? this.stripAgentPrefix(trimmed, targetAgentName)
      : trimmed;

    // Classify the command (after stripping agent name prefix)
    const commandType = this.classifyCommand(command);

    return {
      targetAgentName,
      command,
      isMetaCommand: false,
      commandType,
    };
  }

  resolveAgentId(name: string): AgentId | undefined {
    return this.agentNames.get(name.toLowerCase());
  }

  private classifyCommand(command: string): CommandType {
    const words = command.trim().split(/\s+/);

    // Only classify short commands as status queries or interrupts.
    // Long sentences (> 6 words) that happen to contain "status" or "update"
    // are clearly task descriptions, not status queries.
    if (words.length <= 6) {
      for (const pattern of STATUS_PATTERNS) {
        if (pattern.test(command)) return 'status-query';
      }
    }

    // Check if it's an interrupt command (short commands only — "stop working" is interrupt, "stop the server" is a task)
    if (words.length <= 3) {
      for (const pattern of INTERRUPT_PATTERNS) {
        if (pattern.test(command)) return 'interrupt';
      }
    }

    return 'task';
  }

  private extractAgentName(trimmed: string, lower: string): string | null {
    // Strategy 1: "hey/hi/ok/yo [,] <name>" prefix — with optional comma/punctuation
    const greetingMatch = trimmed.match(
      /^(?:hey|hi|ok|yo|hello)[,.]?\s+(\w+)[,.]?\s*(.*)/i,
    );
    if (greetingMatch) {
      const possibleName = greetingMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) return possibleName;
    }

    // Strategy 2: "<name>, ..." or "<name> ..." as the first word
    const firstWordMatch = trimmed.match(/^(\w+)[,.]?\s+(.*)/i);
    if (firstWordMatch) {
      const possibleName = firstWordMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) return possibleName;
    }

    // Strategy 3: "ask/tell <name> ..." or "ask <name> to ..."
    const askTellMatch = trimmed.match(
      /^(?:ask|tell)\s+(\w+)[,.]?\s+(?:to\s+)?(.*)/i,
    );
    if (askTellMatch) {
      const possibleName = askTellMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) return possibleName;
    }

    // Strategy 4: Scan anywhere for a known agent name as a whole word
    for (const [name] of this.agentNames) {
      const nameRegex = new RegExp(`\\b${name}\\b`, 'i');
      if (nameRegex.test(lower)) return name;
    }

    return null;
  }

  private stripAgentPrefix(trimmed: string, _agentName: string): string {
    // Try to strip greeting + name prefix
    const greetingMatch = trimmed.match(
      /^(?:hey|hi|ok|yo|hello)[,.]?\s+\w+[,.]?\s*(.*)/i,
    );
    if (greetingMatch && greetingMatch[1].trim()) return greetingMatch[1].trim();

    // Try to strip name as first word
    const firstWordMatch = trimmed.match(/^\w+[,.]?\s+(.*)/i);
    if (firstWordMatch && firstWordMatch[1].trim()) return firstWordMatch[1].trim();

    // Try ask/tell pattern
    const askTellMatch = trimmed.match(
      /^(?:ask|tell)\s+\w+[,.]?\s+(?:to\s+)?(.*)/i,
    );
    if (askTellMatch && askTellMatch[1].trim()) return askTellMatch[1].trim();

    return trimmed;
  }
}
