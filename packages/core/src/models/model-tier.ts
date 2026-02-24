/**
 * Model tier system — maps team operations to appropriate model tiers
 * for cost/performance balance. Creative ops get the best model,
 * routine ops get the cheapest.
 */

export type ModelTierLevel = 'creative' | 'analytical' | 'routine';

export interface ModelTierConfig {
  /** Top-tier model for soul evolution, code improvement (e.g. claude-opus-4-6) */
  creative: string;
  /** Mid-tier model for reflection synthesis, task analysis (e.g. sonnet) */
  analytical: string;
  /** Low-cost model for summarization, classification, parsing (e.g. haiku) */
  routine: string;
}

export type TeamOperation =
  | 'soul:evolve'
  | 'self:reflect'
  | 'task:analyze'
  | 'code:improve'
  | 'comms:summarize'
  | 'inbox:parse';

/** Maps each team operation to its required model tier */
export const OPERATION_TIERS: Record<TeamOperation, ModelTierLevel> = {
  'soul:evolve': 'creative',
  'self:reflect': 'analytical',
  'task:analyze': 'analytical',
  'code:improve': 'creative',
  'comms:summarize': 'routine',
  'inbox:parse': 'routine',
} as const;

export const DEFAULT_MODEL_TIERS: ModelTierConfig = {
  creative: 'claude-opus-4-6',
  analytical: 'sonnet',
  routine: 'haiku',
} as const;
