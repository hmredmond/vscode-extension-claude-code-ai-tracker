/**
 * Claude API pricing per 1M tokens (as of February 2026)
 * Official Anthropic pricing
 *
 * Cache pricing breakdown:
 * - Cache Read: 10% of input token cost (90% savings vs fresh input)
 * - Cache Write: 125% of input token cost (25% premium to write to cache)
 *
 * Prices in USD per 1M tokens
 */
export const CLAUDE_PRICING = {
  // Claude 4 series
  'claude-opus-4-6': {
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  'claude-sonnet-4-6': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  // Claude 3-series and earlier 4-series
  'claude-haiku': {
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
  'claude-3-5-haiku': {
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
  'claude-haiku-4-5-20251001': {
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
  'claude-sonnet': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  'claude-3-5-sonnet': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  'claude-sonnet-4-5-20250929': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  'claude-opus': {
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
};

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

/** Runtime pricing overrides set from VS Code configuration. */
let _customOverrides: Record<string, Partial<ModelPricing>> = {};

/**
 * Apply custom pricing overrides from VS Code config.
 * Call this on extension activation and whenever aiUsageCost.customModelPricing changes.
 */
export function setCustomPricingOverrides(overrides: Record<string, Partial<ModelPricing>>): void {
  _customOverrides = overrides ?? {};
}

function getDefaultPricingForModel(modelName: string): ModelPricing {
  // Try exact match first
  if (modelName in CLAUDE_PRICING) {
    return CLAUDE_PRICING[modelName as keyof typeof CLAUDE_PRICING];
  }

  // Try to match by partial name
  const lowerName = modelName.toLowerCase();
  if (lowerName.includes('haiku')) {
    return CLAUDE_PRICING['claude-haiku-4-5-20251001'];
  }
  if (lowerName.includes('sonnet')) {
    return CLAUDE_PRICING['claude-sonnet-4-5-20250929'];
  }
  if (lowerName.includes('opus')) {
    return CLAUDE_PRICING['claude-opus'];
  }

  // Default to Sonnet as a mid-range fallback
  return CLAUDE_PRICING['claude-sonnet-4-5-20250929'];
}

export function getPricingForModel(modelName: string): ModelPricing {
  const base = getDefaultPricingForModel(modelName);

  // Apply custom overrides: check exact match first, then partial substring match
  if (modelName in _customOverrides) {
    return { ...base, ..._customOverrides[modelName] };
  }
  const lowerName = modelName.toLowerCase();
  for (const [key, override] of Object.entries(_customOverrides)) {
    if (lowerName.includes(key.toLowerCase())) {
      return { ...base, ...override };
    }
  }

  return base;
}

export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0
): number {
  const pricing = getPricingForModel(modelName);

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
