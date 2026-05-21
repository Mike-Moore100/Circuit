// Pricing per 1M tokens, USD. Cached reads ≈ 0.1×; cache writes (5-min
// ephemeral) ≈ 1.25× of base input. Keep this table small and explicit —
// users can override via the model env var to pick whichever fits cost.
export interface ModelPricing {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': { input: 1.0, cachedInput: 0.1, cacheWrite: 1.25, output: 5.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, cachedInput: 0.1, cacheWrite: 1.25, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, cachedInput: 0.3, cacheWrite: 3.75, output: 15.0 },
  'claude-opus-4-7': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  'claude-opus-4-6': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
};

// Fallback price (treat unknown models as haiku) — used only if the configured
// model isn't in the table, so cost is never silently uncounted.
export const FALLBACK_PRICING: ModelPricing = MODEL_PRICING['claude-haiku-4-5'];

export function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

export function estimateCostUsd(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
  },
): number {
  const p = pricingFor(model);
  const cached = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  // input_tokens from Anthropic already excludes cached + cache-creation
  // tokens, so we bill the three buckets independently.
  const cost =
    (usage.inputTokens * p.input +
      cached * p.cachedInput +
      cacheWrite * p.cacheWrite +
      usage.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6; // 6dp USD
}
