export interface GroqModelCapability {
  id: string;
  displayName: string;
  tier: 'production' | 'preview' | 'custom';
  supportsStrictJsonSchema: boolean;
  supportsJsonObject: boolean;
  supportsToolUse: boolean;
  isReasoningModel?: boolean;
  contextWindow: number;
  notes: string;
}

/**
 * Official Groq decommissioned model IDs mapped to their active Production replacements
 * (verified against https://console.groq.com/docs/deprecations as of Oct 2026).
 * Prevents `400 model_decommissioned` failures if an older model ID was saved in env or DB.
 */
export const DEPRECATED_GROQ_MODEL_REPLACEMENTS: Readonly<Record<string, string>> = {
  'groq/compound': 'openai/gpt-oss-120b',
  'groq/compound-mini': 'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct': 'llama-3.3-70b-versatile',
  'qwen/qwen3-32b': 'llama-3.3-70b-versatile',
  'qwen-qwq-32b': 'openai/gpt-oss-120b',
  'qwen-2.5-32b': 'llama-3.3-70b-versatile',
  'moonshotai/kimi-k2-instruct-0905': 'openai/gpt-oss-120b',
  'deepseek-r1-distill-llama-70b': 'llama-3.3-70b-versatile',
  'deepseek-r1-distill-llama-70b-specdec': 'llama-3.3-70b-versatile',
  'deepseek-r1-distill-qwen-32b': 'openai/gpt-oss-120b',
  'llama3-70b-8192': 'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile': 'llama-3.3-70b-versatile',
  'llama3-8b-8192': 'llama-3.1-8b-instant',
  'gemma2-9b-it': 'llama-3.1-8b-instant',
  'gemma-7b-it': 'llama-3.1-8b-instant',
  'mixtral-8x7b-32768': 'llama-3.3-70b-versatile',
};

export function resolveActiveGroqModelId(
  modelId: string,
  fallback = 'openai/gpt-oss-120b'
): { modelId: string; replacedDeprecated: boolean } {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return { modelId: fallback, replacedDeprecated: false };
  }
  const replacement = DEPRECATED_GROQ_MODEL_REPLACEMENTS[trimmed];
  if (replacement) {
    return { modelId: replacement, replacedDeprecated: true };
  }
  return { modelId: trimmed, replacedDeprecated: false };
}

/**
 * Curated capability metadata for Groq-hosted chat models (verified against
 * https://console.groq.com/docs/models and https://console.groq.com/docs/structured-outputs).
 * Any unlisted model ID configured via GROQ_MODEL or dashboard AI Settings remains fully supported
 * via dynamic fallback detection.
 */
export const KNOWN_GROQ_MODELS: readonly GroqModelCapability[] = [
  {
    id: 'openai/gpt-oss-120b',
    displayName: 'OpenAI GPT-OSS 120B (Recommended)',
    tier: 'production',
    supportsStrictJsonSchema: true,
    supportsJsonObject: true,
    supportsToolUse: true,
    isReasoningModel: true,
    contextWindow: 131072,
    notes:
      'Production (~500 tok/s). Flagship 120B MoE model with native strict json_schema constrained decoding, low-latency reasoning_effort="low", and 200k TPD free tier.',
  },
  {
    id: 'llama-3.3-70b-versatile',
    displayName: 'Meta Llama 3.3 70B Versatile',
    tier: 'production',
    supportsStrictJsonSchema: false,
    supportsJsonObject: true,
    supportsToolUse: true,
    isReasoningModel: false,
    contextWindow: 131072,
    notes:
      'Production (~280 tok/s). Strong casual Discord voice with JSON Object mode and 12k TPM free tier.',
  },
  {
    id: 'openai/gpt-oss-20b',
    displayName: 'OpenAI GPT-OSS 20B (Fast Strict Schema)',
    tier: 'production',
    supportsStrictJsonSchema: true,
    supportsJsonObject: true,
    supportsToolUse: true,
    isReasoningModel: true,
    contextWindow: 131072,
    notes:
      'Production (~1,000 tok/s). Fast 20B reasoning model with strict json_schema, though more prone to repetitive customer-support phrasing in casual chat.',
  },
  {
    id: 'llama-3.1-8b-instant',
    displayName: 'Meta Llama 3.1 8B Instant (Ultra-Fast Simple Intake)',
    tier: 'production',
    supportsStrictJsonSchema: false,
    supportsJsonObject: true,
    supportsToolUse: true,
    isReasoningModel: false,
    contextWindow: 131072,
    notes:
      'Production (~560+ tok/s). Lowest latency for simple 1-question intake, less reliable on nuanced multi-turn banter.',
  },
  {
    id: 'qwen/qwen3.8-27b',
    displayName: 'Qwen 3.8 27B (Preview — Eval Only)',
    tier: 'preview',
    supportsStrictJsonSchema: true,
    supportsJsonObject: true,
    supportsToolUse: true,
    isReasoningModel: true,
    contextWindow: 131072,
    notes:
      'Preview model supporting strict json_schema; not recommended for production because Groq preview models can be sunset on short notice.',
  },
] as const;

export function getGroqModelCapabilities(modelId: string): GroqModelCapability {
  const normalized = modelId.trim();
  const known = KNOWN_GROQ_MODELS.find((m) => m.id === normalized);
  if (known) {
    return known;
  }

  const isGptOss = normalized.startsWith('openai/gpt-oss-');
  const supportsStrictByFamily =
    isGptOss || normalized === 'qwen/qwen3.8-27b' || normalized === 'meta-models/muse-spark-open';
  return {
    id: normalized,
    displayName: normalized || 'Environment Configured Model',
    tier: 'custom',
    supportsStrictJsonSchema: supportsStrictByFamily,
    supportsJsonObject: true,
    supportsToolUse: true,
    isReasoningModel: isGptOss || normalized.startsWith('qwen/qwen3'),
    contextWindow: 32768,
    notes: 'Dynamically configured Groq model with automatic json_object fallback and Zod validation.',
  };
}

