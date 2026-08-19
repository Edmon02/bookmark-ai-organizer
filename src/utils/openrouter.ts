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
const FALLBACK_PREFERENCE: string[] = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3-opus',
  'anthropic/claude-3-haiku',
  'google/gemini-2.0-flash-001',
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
  if (isBatchOnlyModel(model)) return false;
  if (model.supported_parameters?.includes('messages')) return true;
  return /(gpt|claude|llama|gemini|chat|instruct|sonnet|haiku|opus|kimi|qwen|mistral)/i.test(haystack);
}

function sanitizeModels(models: OpenRouterModel[]): OpenRouterModel[] {
  return models.filter(model =>
    typeof model.id === 'string' &&
    model.id.includes('/') &&
    isLikelyChatModel(model)
  );
}

export async function fetchOpenRouterModels(apiKey: string, forceRefresh = false): Promise<OpenRouterModel[]> {
  if (!forceRefresh) {
    const cached = await getCachedModels();
    if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS && cached.models.length) {
      return cached.models;
    }
  }
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });
    if (resp.status === 401) throw new Error('Invalid OpenRouter API key');
    if (resp.status === 429) throw new Error('Rate limited by OpenRouter (429)');
    if (!resp.ok) throw new Error(`Failed to fetch models (${resp.status})`);
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
  } catch (e) {
    console.error('OpenRouter model fetch error:', e);
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
  const result = await chrome.storage.sync.get(SELECTED_MODEL_KEY);
  return result[SELECTED_MODEL_KEY] || null;
}

export async function setSelectedOpenRouterModel(modelId: string): Promise<void> {
  await chrome.storage.sync.set({ [SELECTED_MODEL_KEY]: modelId });
}

export async function clearSelectedOpenRouterModel(): Promise<void> {
  await chrome.storage.sync.remove(SELECTED_MODEL_KEY);
}

export async function getProviderPreference(): Promise<string | null> {
  const result = await chrome.storage.sync.get(PROVIDER_PREF_KEY);
  return result[PROVIDER_PREF_KEY] || null;
}

export async function setProviderPreference(pref: string): Promise<void> {
  if (!pref) {
    await chrome.storage.sync.remove(PROVIDER_PREF_KEY);
  } else {
    await chrome.storage.sync.set({ [PROVIDER_PREF_KEY]: pref });
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
    const heuristic = models.find(isLikelyChatModel);
    return heuristic ? heuristic.id : models[0].id;
  } catch (e) {
    console.warn('Failed to choose default OpenRouter model', e);
    return null;
  }
}
