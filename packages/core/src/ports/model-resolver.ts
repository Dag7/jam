import type { TeamOperation } from '../models/model-tier.js';

export interface ResolvedModel {
  runtime: string;
  model: string;
}

/**
 * Resolves the appropriate runtime + model for a given team operation.
 * Implementations map operations → tiers → concrete model strings.
 */
export interface IModelResolver {
  resolve(operation: TeamOperation): ResolvedModel;
}
