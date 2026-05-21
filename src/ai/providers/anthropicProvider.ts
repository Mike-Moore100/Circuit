import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, ProviderResult } from '../aiTypes';
import { estimateCostUsd } from './types';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  requestTimeoutMs: number;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const { apiKey, model, maxOutputTokens, requestTimeoutMs } = options;
  if (!apiKey) {
    throw new Error('createAnthropicProvider: apiKey is required');
  }

  const client = new Anthropic({ apiKey, timeout: requestTimeoutMs });

  return {
    name: 'anthropic',
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<ProviderResult> {
      const response = await client.messages.create({
        model,
        max_tokens: maxOutputTokens,
        // System prompt is stable across leads → mark it as ephemeral so the
        // cache hits and we pay ~0.1× on input tokens after the first call.
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const rawJson = textBlocks.map((b) => b.text).join('').trim();

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      };

      return {
        rawJson,
        usage,
        estimatedCostUsd: estimateCostUsd(model, usage),
        provider: 'anthropic',
        model,
      };
    },
  };
}
