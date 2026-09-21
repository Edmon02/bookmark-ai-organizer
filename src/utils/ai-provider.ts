// SPDX-License-Identifier: Apache-2.0
// Shared LLM provider detection + client construction, used by classifier, search, and assistant.
import OpenAI from 'openai';
import { getProviderPreference, getSelectedOpenRouterModel } from './openrouter';
import { detectProviderId, isProviderId, type ProviderId } from './providers';
import { SecurityManager } from './security';

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

const CHAT_PROVIDER_ORDER: ProviderId[] = ['openrouter', 'openai', 'groq', 'moonshot', 'grok'];

export function detectProvider(apiKey: string): AIProvider {
    const providerId = detectProviderId(apiKey);
    if (!providerId || providerId === 'typesafe' || !providers[providerId]) {
        throw new Error('Search and chat need a chat-model API key. TypeSafe Jev cannot write text.');
    }
    return providers[providerId];
}

export async function resolveChatClientConfig(): Promise<{
    apiKey: string;
    providerOverride: ProviderId;
    selectedOpenRouterModel: string | null;
}> {
    const [preference, selectedOpenRouterModel] = await Promise.all([
        getProviderPreference(),
        getSelectedOpenRouterModel(),
    ]);
    const ordered = isProviderId(preference) && preference !== 'typesafe'
        ? [preference, ...CHAT_PROVIDER_ORDER.filter((id) => id !== preference)]
        : CHAT_PROVIDER_ORDER;

    for (const providerId of ordered) {
        const apiKey = await SecurityManager.getApiKeyForProvider(providerId);
        if (apiKey) {
            return {
                apiKey,
                providerOverride: providerId,
                selectedOpenRouterModel: providerId === 'openrouter' ? selectedOpenRouterModel : null,
            };
        }
    }

    throw new Error('API key not configured. Search and chat need a chat-model key such as OpenRouter.');
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
