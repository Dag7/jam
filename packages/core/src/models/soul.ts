export interface SoulStructure {
  persona: string;
  /** Developed role the agent has taken on (e.g. "Frontend Developer", "Marketing Analyst") */
  role: string;
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
