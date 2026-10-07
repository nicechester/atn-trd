/**
 * LLM Cost Calculator
 * Calculates API costs based on model, input tokens, and output tokens.
 */

interface ModelPricing {
  inputPerMillion: number;  // Cost per 1M input tokens in USD
  outputPerMillion: number; // Cost per 1M output tokens in USD
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI models
  'gpt-4-turbo': { inputPerMillion: 10, outputPerMillion: 30 },
  'gpt-4': { inputPerMillion: 30, outputPerMillion: 60 },
  'gpt-3.5-turbo': { inputPerMillion: 0.5, outputPerMillion: 1.5 },

  // Google Gemini models
  'gemini-2.0-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'gemini-1.5-flash-8b': { inputPerMillion: 0.0375, outputPerMillion: 0.15 },
  'gemini-3.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'gemini-3.5-flash-lite': { inputPerMillion: 0.0375, outputPerMillion: 0.15 },

  // Fallback for unknown models
  'default': { inputPerMillion: 1, outputPerMillion: 3 },
};

export interface LlmCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/**
 * Calculate the cost of an LLM API call.
 * Estimates output tokens from input tokens if not provided.
 */
export function calculateLlmCost(
  model: string,
  inputTokens: number,
  outputTokens?: number
): LlmCost {
  // Get pricing for the model, fallback to default if unknown
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Try to match by prefix (e.g., "gemini-3.5-flash-lite" -> "gemini-3.5-flash-lite")
    const matching = Object.entries(MODEL_PRICING).find(([key]) =>
      model.includes(key) || key.includes(model)
    );
    pricing = matching ? matching[1] : MODEL_PRICING['default'];
  }

  // If output tokens not provided, estimate as 20% of input
  const outputToks = outputTokens ?? Math.round(inputTokens * 0.2);
  const totalToks = inputTokens + outputToks;

  // Calculate costs
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputToks / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + outputCost;

  return {
    model,
    inputTokens,
    outputTokens: outputToks,
    totalTokens: totalToks,
    inputCost,
    outputCost,
    totalCost,
  };
}

/**
 * Create telemetry object for storage in database.
 */
export function createLlmTelemetry(
  model: string,
  totalTokens: number,
  promptTokens: number = Math.round(totalTokens * 0.8),
  completionTokens: number = Math.round(totalTokens * 0.2)
) {
  const cost = calculateLlmCost(model, promptTokens, completionTokens);

  return {
    models: { screener: model },
    tokens: {
      screener: {
        input: promptTokens,
        output: completionTokens,
      },
    },
    cost: {
      screener: cost.totalCost,
      total: cost.totalCost,
    },
    latency_ms: {
      screener: 0, // Placeholder - should be measured by caller
      total: 0,
    },
  };
}
