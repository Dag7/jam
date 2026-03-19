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
  /** Frontmatter keys not recognized by the parser — preserved through round-trips */
  extraFrontmatter?: Record<string, string>;
  /** Markdown sections not recognized by the parser — preserved through round-trips.
   *  Each entry is [heading, content] where heading includes the "## " prefix. */
  extraSections?: Array<{ heading: string; content: string }>;
}
