export interface GroqModelCapability {
  id: string;
  displayName: string;
  tier: 'production' | 'preview' | 'custom';
  supportsStrictJsonSchema: boolean;
  supportsJsonObject: boolean;
  supportsToolUse: boolean;
  contextWindow: number;
  notes: string;
}

/**
 * Curated capability metadata for Groq-hosted models (see https://console.groq.com/docs/models
 * and https://console.groq.com/docs/structured-outputs).
 * Any unlisted model ID configured via GROQ_MODEL or dashboard AI Settings remains fully supported
 * via dynamic fallback detection.
 */
export const KNOWN_GROQ_MODELS: readonly GroqModelCapability[] = [
  {
    id: 'llama-3.3-70b-versatile',
    displayName: 'Meta Llama 3.3 70B Versatile (Recommended)',
    tier: 'production',
    supportsStrictJsonSchema: false,
    supportsJsonObject: true,
    supportsToolUse: true,
    contextWindow: 131072,
    notes: 'Best natural human Discord chat voice; supports tool calling and JSON Object structured mode.',
  },
  {
    id: 'openai/gpt-oss-120b',
    displayName: 'OpenAI GPT-OSS 120B',
    tier: 'production',
    supportsStrictJsonSchema: true,
    supportsJsonObject: true,
    supportsToolUse: true,
    contextWindow: 131072,
    notes: 'High-reasoning flagship open-weight model supporting strict json_schema structured outputs.',
  },
  {
    id: 'openai/gpt-oss-20b',
    displayName: 'OpenAI GPT-OSS 20B',
    tier: 'production',
    supportsStrictJsonSchema: true,
    supportsJsonObject: true,
    supportsToolUse: true,
    contextWindow: 131072,
    notes: 'Fast lightweight LPU inference with native strict json_schema constrained decoding.',
  },
  {
    id: 'llama-3.1-8b-instant',
    displayName: 'Meta Llama 3.1 8B Instant',
    tier: 'production',
    supportsStrictJsonSchema: false,
    supportsJsonObject: true,
    supportsToolUse: true,
    contextWindow: 131072,
    notes: 'Ultra-low-latency model suitable for high-throughput support intake.',
  },
] as const;

export function getGroqModelCapabilities(modelId: string): GroqModelCapability {
  const normalized = modelId.trim();
  const known = KNOWN_GROQ_MODELS.find((m) => m.id === normalized);
  if (known) {
    return known;
  }

  const supportsStrictByFamily = normalized.startsWith('openai/gpt-oss-');
  return {
    id: normalized,
    displayName: normalized || 'Environment Configured Model',
    tier: 'custom',
    supportsStrictJsonSchema: supportsStrictByFamily,
    supportsJsonObject: true,
    supportsToolUse: true,
    contextWindow: 32768,
    notes: 'Dynamically configured Groq model with automatic json_object fallback and Zod validation.',
  };
}

