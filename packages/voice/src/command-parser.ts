import type { AgentId } from '@jam/core';

export interface ParsedCommand {
  targetAgentName: string | null;
  command: string;
  isMetaCommand: boolean;
}

const META_COMMANDS = [
  'create',
  'delete',
  'stop',
  'start',
  'restart',
  'list',
  'configure',
  'status',
];

export class CommandParser {
  private agentNames: Map<string, AgentId> = new Map();

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
        };
      }
    }

    // Try to find an agent name in the transcript using multiple strategies.

    // Strategy 1: "hey/hi/ok/yo [,] <name>" prefix — with optional comma/punctuation
    // Handles: "Hey Sue, ...", "Hey, Sue, ...", "Hi Sue ...", etc.
    const greetingMatch = trimmed.match(
      /^(?:hey|hi|ok|yo|hello)[,.]?\s+(\w+)[,.]?\s*(.*)/i,
    );
    if (greetingMatch) {
      const possibleName = greetingMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) {
        const command = greetingMatch[2].trim() || trimmed;
        return { targetAgentName: possibleName, command, isMetaCommand: false };
      }
    }

    // Strategy 2: "<name>, ..." or "<name> ..." as the first word
    const firstWordMatch = trimmed.match(/^(\w+)[,.]?\s+(.*)/i);
    if (firstWordMatch) {
      const possibleName = firstWordMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) {
        const command = firstWordMatch[2].trim() || trimmed;
        return { targetAgentName: possibleName, command, isMetaCommand: false };
      }
    }

    // Strategy 3: "ask/tell <name> ..." or "ask <name> to ..."
    const askTellMatch = trimmed.match(
      /^(?:ask|tell)\s+(\w+)[,.]?\s+(?:to\s+)?(.*)/i,
    );
    if (askTellMatch) {
      const possibleName = askTellMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) {
        return { targetAgentName: possibleName, command: askTellMatch[2].trim(), isMetaCommand: false };
      }
    }

    // Strategy 4: Scan anywhere for a known agent name as a whole word
    for (const [name] of this.agentNames) {
      const nameRegex = new RegExp(`\\b${name}\\b`, 'i');
      if (nameRegex.test(lower)) {
        return { targetAgentName: name, command: trimmed, isMetaCommand: false };
      }
    }

    // No agent addressed — send to default/active agent
    return {
      targetAgentName: null,
      command: trimmed,
      isMetaCommand: false,
    };
  }

  resolveAgentId(name: string): AgentId | undefined {
    return this.agentNames.get(name.toLowerCase());
  }
}
