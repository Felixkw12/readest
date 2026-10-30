import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

const BASE_URL = 'https://api.opper.ai/v3/compat';
// `simplified` lists each model once, by its bare pool name where it has one.
const MODELS_URL = `${BASE_URL}/models?view=simplified`;
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/**
 * Provider for Opper (https://opper.ai), an EU-hosted AI gateway with an
 * OpenAI-compatible endpoint. Users supply their own Opper API key. Bare model
 * IDs such as `gemini-3.8-flash` let Opper pick the route; `vendor/model` IDs
 * pin one.
 *
 * Transport: same as `OpenRouterProvider`, every outbound call goes through
 * {@link getAIFetch}.
 */
export class OpperProvider implements AIProvider {
  id: AIProviderName = 'opper';
  name = 'Opper';
  requiresAuth = true;

  private settings: AISettings;
  private client: ReturnType<typeof createOpenAICompatible>;
  private apiKey: string;
  private httpFetch: typeof fetch;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.opperApiKey) {
      throw new Error('Opper API key required');
    }
    this.apiKey = settings.opperApiKey;
    this.httpFetch = getAIFetch();
    this.client = createOpenAICompatible({
      name: 'opper',
      baseURL: BASE_URL,
      apiKey: this.apiKey,
      fetch: this.httpFetch,
    });
    aiLogger.provider.init('opper', settings.opperModel || DEFAULT_MODEL);
  }

  getModel(): LanguageModel {
    return this.client.chatModel(this.settings.opperModel || DEFAULT_MODEL);
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.client.textEmbeddingModel(
      this.settings.opperEmbeddingModel || DEFAULT_EMBEDDING_MODEL,
    );
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await this.httpFetch(MODELS_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      aiLogger.provider.init('opper', 'healthCheck success');
      return true;
    } catch (e) {
      aiLogger.provider.error('opper', `healthCheck failed: ${(e as Error).message}`);
      return false;
    }
  }
}

export interface OpperModelInfo {
  id: string;
  name?: string;
  /** `llm` or `embedding`, from Opper's `opper.type` field. */
  type?: string;
}

/** Fetch the models the key can call, for the settings pickers. */
export async function fetchOpperModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<OpperModelInfo[]> {
  const response = await getAIFetch()(MODELS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }
  const json = (await response.json()) as {
    data?: { id: string; opper?: { display_name?: string; type?: string } }[];
  };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.opper?.display_name,
    type: m.opper?.type,
  }));
}
