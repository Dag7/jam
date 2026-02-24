import type { IModelResolver, ResolvedModel, ModelTierConfig, TeamOperation } from '@jam/core';
import { OPERATION_TIERS } from '@jam/core';

/**
 * Resolves the appropriate model for each team operation based on tier config.
 * Stateless, easily testable — just a lookup chain: operation → tier → model.
 */
export class ModelResolver implements IModelResolver {
  constructor(
    private readonly tierConfig: ModelTierConfig,
    private readonly defaultRuntime: string,
  ) {}

  resolve(operation: TeamOperation): ResolvedModel {
    const tier = OPERATION_TIERS[operation];
    const model = this.tierConfig[tier];
    return { runtime: this.defaultRuntime, model };
  }
}
