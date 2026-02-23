export interface SoulStructure {
  persona: string;
  traits: Record<string, number>;
  goals: string[];
  strengths: string[];
  weaknesses: string[];
  /** Accumulated insights */
  learnings: string[];
  lastReflection: string;
  /** Incremented on each evolution */
  version: number;
}
