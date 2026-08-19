// SPDX-License-Identifier: Apache-2.0
// Shared LLM provider detection + client construction, used by classifier, search, and assistant.
import OpenAI from 'openai';

export interface AIProvider {
    name: string;
    baseURL: string;
    model: string;
}

export const providers: Record<string, AIProvider> = {
    openai: {
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo'
    },
    moonshot: {
        name: 'Moonshot (Kimi)',
        baseURL: 'https://api.moonshot.ai/v1',
        model: 'kimi-k2-0711-preview'
    },
    grok: {
        name: 'Grok',
        baseURL: 'https://api.x.ai/v1',
        model: 'grok-beta'
    },
    openrouter: {
        name: 'OpenRouter',
        baseURL: 'https://openrouter.ai/api/v1',
        // Use a stable widely-available smaller model as initial default; can be overridden dynamically
        model: 'openai/gpt-4o-mini'
    },
    groq: {
        name: 'Groq',
        baseURL: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile'
    },
};

export function detectProvider(apiKey: string): AIProvider {
    // Auto-detect provider based on API key format or content
    if (apiKey.startsWith('gsk_')) {
        return providers.groq;
    } else if (apiKey.startsWith('sk-') && !apiKey.includes('kimi') && !apiKey.includes('or-v1')) {
        return providers.openai;
    } else if (apiKey.startsWith('sk-or-v1-') || apiKey.includes('openrouter')) {
        return providers.openrouter;
    } else if (apiKey.includes('kimi') || apiKey.length > 40) {
        // Moonshot keys are often longer and may contain 'kimi' or be generic long tokens
        return providers.moonshot;
    } else if (apiKey.includes('grok') || apiKey.startsWith('xai-')) {
        return providers.grok;
    }
    // Default to OpenRouter for most generic keys since it supports many models
    return providers.openrouter;
}

/**
 * Resolve the provider config to use (respecting an explicit override / selected OpenRouter model)
 * and construct an OpenAI-compatible client for it.
 */
export function createClient(
    apiKey: string,
    providerOverride?: string | null,
    selectedOpenRouterModel?: string | null
): { client: OpenAI; provider: AIProvider } {
    const baseProvider = (providerOverride && providers[providerOverride])
        ? providers[providerOverride]
        : detectProvider(apiKey);
    const provider = { ...baseProvider }; // copy to avoid mutating shared config

    if (provider.name === 'OpenRouter' && selectedOpenRouterModel) {
        provider.model = selectedOpenRouterModel;
    }

    const client = new OpenAI({
        apiKey,
        baseURL: provider.baseURL,
        dangerouslyAllowBrowser: true // Allow usage in browser extension
    });

    return { client, provider };
}
