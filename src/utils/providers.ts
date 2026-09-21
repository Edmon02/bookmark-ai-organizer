// SPDX-License-Identifier: Apache-2.0

export const PROVIDER_IDS = [
    'typesafe',
    'openrouter',
    'openai',
    'groq',
    'moonshot',
    'grok',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
    typesafe: 'TypeSafe (Jev)',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    groq: 'Groq',
    moonshot: 'Moonshot',
    grok: 'Grok',
};

export const AUTO_PROVIDER_ORDER: ProviderId[] = [
    'openrouter',
    'typesafe',
    'openai',
    'groq',
    'moonshot',
    'grok',
];

export function isProviderId(value: string | null | undefined): value is ProviderId {
    return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export function detectProviderId(apiKey: string): ProviderId | null {
    const key = apiKey.trim();
    if (!key) {
        return null;
    }

    if (key.startsWith('apikey_')) {
        return 'typesafe';
    }
    if (key.startsWith('gsk_')) {
        return 'groq';
    }
    if (key.startsWith('sk-or-v1-') || key.includes('openrouter')) {
        return 'openrouter';
    }
    if (key.startsWith('xai-') || key.toLowerCase().includes('grok')) {
        return 'grok';
    }
    if (key.toLowerCase().includes('kimi')) {
        return 'moonshot';
    }
    if (key.startsWith('sk-')) {
        return 'openai';
    }

    return null;
}
