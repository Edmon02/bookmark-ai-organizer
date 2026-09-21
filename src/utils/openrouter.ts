// SPDX-License-Identifier: Apache-2.0
// OpenRouter models utility: fetch, cache, and preference management
// Caching strategy: store models in chrome.storage.local with timestamp; TTL = 15 minutes.

export interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: { tokenizer?: string; modality?: string };
  supported_parameters?: string[];
}

interface ModelCacheEnvelope {
  updatedAt: number;
  models: OpenRouterModel[];
}

const CACHE_KEY = 'openrouter_models_cache';
const SELECTED_MODEL_KEY = 'openrouter_selected_model';
export const PROVIDER_PREF_KEY = 'provider_preference';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REQUEST_TIMEOUT_MS = 12000;
const MAX_MODEL_FETCH_RETRIES = 2;
const FALLBACK_PREFERENCE: string[] = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3-opus',
  'anthropic/claude-3-haiku',
  'google/gemini-flash-1.5',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct'
];

function isBatchOnlyModel(model: OpenRouterModel): boolean {
  const haystack = `${model.id} ${model.name || ''} ${model.description || ''}`.toLowerCase();
  return /\bbatch\b|jsonl|asynchronous|async job|offline processing/.test(haystack);
}

function isLikelyChatModel(model: OpenRouterModel): boolean {
  const haystack = `${model.id} ${model.name || ''} ${model.description || ''}`.toLowerCase();
  if (isBatchOnlyModel(model)) {
    return false;
  }
  if (model.supported_parameters?.includes('messages')) {
    return true;
  }
  return /(gpt|claude|llama|gemini|chat|instruct|sonnet|haiku|opus|kimi|qwen|mistral)/i.test(haystack);
}

function sanitizeModels(models: OpenRouterModel[]): OpenRouterModel[] {
  return models.filter((model) =>
    typeof model.id === 'string' &&
    model.id.includes('/') &&
    isLikelyChatModel(model)
  );
}

async function getLocalWithSyncFallback(key: string): Promise<string | null> {
  const localResult = await chrome.storage.local.get(key);
  const localValue = localResult[key];
  if (typeof localValue === 'string' && localValue) {
    return localValue;
  }

  const syncResult = await chrome.storage.sync.get(key);
  const syncValue = syncResult[key];
  if (typeof syncValue === 'string' && syncValue) {
    await chrome.storage.local.set({ [key]: syncValue });
    await chrome.storage.sync.remove(key);
    return syncValue;
  }

  return null;
}

export async function fetchOpenRouterModels(apiKey: string, forceRefresh = false): Promise<OpenRouterModel[]> {
  if (!forceRefresh) {
    const cached = await getCachedModels();
    if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS && cached.models.length) {
      return cached.models;
    }
  }

  try {
    const resp = await fetchModelsWithRetry(apiKey);
    const data = await resp.json();
    const models: OpenRouterModel[] = Array.isArray(data.data) ? data.data.map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      description: m.description,
      context_length: m.context_length,
      architecture: m.architecture,
      supported_parameters: Array.isArray(m.supported_parameters) ? m.supported_parameters : undefined
    })) : [];
    const filtered = sanitizeModels(models);
    await cacheModels(filtered);
    return filtered;
  } catch (e: unknown) {
    const cached = await getCachedModels();
    if (cached?.models?.length) return cached.models; // stale fallback
    throw e;
  }
}

export async function cacheModels(models: OpenRouterModel[]): Promise<void> {
  const envelope: ModelCacheEnvelope = { updatedAt: Date.now(), models };
  await chrome.storage.local.set({ [CACHE_KEY]: envelope });
}

export async function getCachedModels(): Promise<ModelCacheEnvelope | null> {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    return result[CACHE_KEY] || null;
  } catch {
    return null;
  }
}

export async function getSelectedOpenRouterModel(): Promise<string | null> {
  return getLocalWithSyncFallback(SELECTED_MODEL_KEY);
}

export async function setSelectedOpenRouterModel(modelId: string): Promise<void> {
  await chrome.storage.local.set({ [SELECTED_MODEL_KEY]: modelId });
  await chrome.storage.sync.remove(SELECTED_MODEL_KEY);
}

export async function clearSelectedOpenRouterModel(): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove(SELECTED_MODEL_KEY),
    chrome.storage.sync.remove(SELECTED_MODEL_KEY),
  ]);
}

export async function getProviderPreference(): Promise<string | null> {
  return getLocalWithSyncFallback(PROVIDER_PREF_KEY);
}

export async function setProviderPreference(pref: string): Promise<void> {
  if (!pref) {
    await Promise.all([
      chrome.storage.local.remove(PROVIDER_PREF_KEY),
      chrome.storage.sync.remove(PROVIDER_PREF_KEY),
    ]);
  } else {
    await chrome.storage.local.set({ [PROVIDER_PREF_KEY]: pref });
    await chrome.storage.sync.remove(PROVIDER_PREF_KEY);
  }
}

// Choose a stable default model from the available list
export async function chooseDefaultOpenRouterModel(apiKey: string): Promise<string | null> {
  try {
    const models = await fetchOpenRouterModels(apiKey, false);
    if (!models.length) return null;
    for (const preferred of FALLBACK_PREFERENCE) {
      if (models.some(m => m.id === preferred)) return preferred;
    }
    // Otherwise pick first model that appears to be chat-capable (heuristic: contains 'gpt' or 'claude' or 'llama' or 'gemini')
    const heuristic = models.find(isLikelyChatModel);
    return heuristic ? heuristic.id : models[0].id;
  } catch {
    return null;
  }
}

async function fetchModelsWithRetry(apiKey: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_MODEL_FETCH_RETRIES; attempt++) {
    try {
      const response = await fetchModelsOnce(apiKey);
      if (response.status === 401) {
        throw new Error('Invalid OpenRouter API key');
      }

      if (response.ok) {
        return response;
      }

      if (!shouldRetryStatus(response.status) || attempt === MAX_MODEL_FETCH_RETRIES) {
        if (response.status === 429) {
          throw new Error('Rate limited by OpenRouter (429)');
        }
        throw new Error(`Failed to fetch models (${response.status})`);
      }

      const retryAfterMs = getRetryAfterMs(response.headers.get('Retry-After'));
      await wait(retryAfterMs ?? backoffMs(attempt));
    } catch (error: unknown) {
      const normalized = normalizeFetchError(error);
      lastError = normalized;

      if (attempt === MAX_MODEL_FETCH_RETRIES || !shouldRetryError(normalized)) {
        throw normalized;
      }

      await wait(backoffMs(attempt));
    }
  }

  throw lastError ?? new Error('Failed to fetch OpenRouter models');
}

async function fetchModelsOnce(apiKey: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function shouldRetryError(error: Error): boolean {
  if (error.message === 'Invalid OpenRouter API key') {
    return false;
  }
  return true;
}

function getRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) {
    return null;
  }
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 10000);
  }
  return null;
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 4000);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeFetchError(error: unknown): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error('OpenRouter model request timed out');
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error('Failed to fetch OpenRouter models');
}
