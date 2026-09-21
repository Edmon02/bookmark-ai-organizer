// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai';
import {
    type ClassificationOptions,
    type ClassificationResult,
    type ClassificationResultWithMeta,
} from './classification-types';
import { classifyWithJev } from './jev-classifier';
import {
    chooseDefaultOpenRouterModel,
    clearSelectedOpenRouterModel,
    getProviderPreference,
    getSelectedOpenRouterModel,
    setSelectedOpenRouterModel,
} from './openrouter';
import { detectProviderId, isProviderId, PROVIDER_LABELS, type ProviderId } from './providers';
import { SecurityManager } from './security';

export type {
    ClassificationOptions,
    ClassificationResult,
    ClassificationResultWithMeta,
};

interface AIProvider {
    name: string;
    baseURL: string;
    model: string;
}

export class LlmClassifier {
    private apiKey: string | undefined = undefined;
    private providerOverride: string | null = null;
    private selectedOpenRouterModel: string | null = null;
    private providers: Record<string, AIProvider> = {
        openai: {
            name: 'OpenAI',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-3.5-turbo',
        },
        moonshot: {
            name: 'Moonshot (Kimi)',
            baseURL: 'https://api.moonshot.ai/v1',
            model: 'kimi-k2-0711-preview',
        },
        grok: {
            name: 'Grok',
            baseURL: 'https://api.x.ai/v1',
            model: 'grok-beta',
        },
        openrouter: {
            name: 'OpenRouter',
            baseURL: 'https://openrouter.ai/api/v1',
            model: 'openai/gpt-4o-mini',
        },
        groq: {
            name: 'Groq',
            baseURL: 'https://api.groq.com/openai/v1',
            model: 'llama-3.3-70b-versatile',
        },
    };

    constructor() {}

    private async loadPreferences() {
        try {
            this.providerOverride = await getProviderPreference();
            this.selectedOpenRouterModel = await getSelectedOpenRouterModel();
        } catch {
            this.providerOverride = null;
            this.selectedOpenRouterModel = null;
        }
    }

    async classifyUrl(url: string, title: string, options: ClassificationOptions = {}): Promise<ClassificationResult> {
        const result = await this.classifyUrlWithMeta(url, title, options);
        return {
            folderPath: result.folderPath,
            tags: result.tags,
            confidence: result.confidence,
        };
    }

    async classifyUrlWithMeta(
        url: string,
        title: string,
        options: ClassificationOptions = {},
    ): Promise<ClassificationResultWithMeta> {
        await this.loadPreferences();

        const credentials = await this.resolveCredentials(options.providerOverride);
        this.apiKey = credentials.apiKey;
        const effectiveProviderId = credentials.providerId;

        if (effectiveProviderId === 'typesafe') {
            return classifyWithJev(credentials.apiKey, url, title);
        }

        const baseProvider = this.providers[effectiveProviderId];
        if (!baseProvider) {
            throw new Error('No AI provider is configured for this key.');
        }
        const provider = { ...baseProvider };

        if (effectiveProviderId === 'openrouter') {
            const selectedModel = options.modelOverride ?? this.selectedOpenRouterModel;
            if (selectedModel) {
                provider.model = selectedModel;
            }
        }

        const client = new OpenAI({
            apiKey: this.apiKey,
            baseURL: provider.baseURL,
        });

        const prompt = `You are an AI assistant tasked with classifying webpages for bookmark organization. Analyze the provided URL and title to determine a logical folder structure and relevant tags. Use emojis in folder names to make them visually distinct and intuitive. Follow these guidelines:

1. **Folder Structure**:
   - Create a folder path with 1-3 levels (e.g., ["📰 News", "🌍 Global"] or ["💻 Technology", "🖥️ Software", "🛠️ Tools"]).
   - Use simple, widely supported Unicode emojis (e.g., 📰, 💻, 🛒, 📚) at the start of each folder name.
   - Ensure folder names are concise, descriptive, and reflect the webpage's content or purpose.
   - Avoid nested folders deeper than 3 levels.

2. **Tags**:
   - Generate 2-5 concise, lowercase tags that describe the webpage’s content, purpose, or category.
   - Tags should be specific and useful for searching (e.g., "coding" instead of "tech").

3. **Confidence**:
   - Include a confidence score between 0 and 1 for your classification.
   - Use higher confidence only when category intent is clear from URL/title.

4. **Context**:
   - Infer the webpage’s purpose from the URL and title (e.g., blog, e-commerce, news, social media, education).
   - Consider the domain (e.g., github.com → coding, amazon.com → shopping).

5. **Output**:
   - Respond with valid JSON only, containing "folderPath" (array of strings), "tags" (array of strings), and "confidence" (number from 0 to 1).
   - Do not include markdown, code fences, or extra text.

**URL**: ${url}
**Title**: ${title}

**Examples**:
- URL: https://www.nytimes.com/politics, Title: "Election Updates"
  → {"folderPath": ["📰 News", "🌍 Global", "🗳️ Politics"], "tags": ["politics", "election", "news"], "confidence": 0.9}
- URL: https://github.com/python, Title: "Python Repository"
  → {"folderPath": ["💻 Technology", "🖥️ Software", "🛠️ Coding"], "tags": ["coding", "python", "github"], "confidence": 0.88}
- URL: https://www.amazon.com/electronics, Title: "Electronics Store"
  → {"folderPath": ["🛒 Shopping", "📱 Electronics"], "tags": ["shopping", "electronics", "amazon"], "confidence": 0.95}
- URL: https://www.khanacademy.org/math, Title: "Math Lessons"
  → {"folderPath": ["📚 Education", "➗ Math"], "tags": ["education", "math", "learning"], "confidence": 0.9}
- URL: https://www.reddit.com/r/science, Title: "Science Discussions"
  → {"folderPath": ["🌐 Social Media", "🔬 Science"], "tags": ["social", "science", "reddit"], "confidence": 0.78} 

**Response Format**:
{
  "folderPath": ["Emoji Category", "Emoji Subcategory", "Emoji Specific"],
  "tags": ["tag1", "tag2", "tag3"],
  "confidence": 0.85
}`;

        try {
            const attemptClassification = async (): Promise<string> => {
                const completion = await client.chat.completions.create({
                    model: provider.model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 300,
                    temperature: 0.2,
                });
                return completion.choices[0].message.content || '';
            };

            let retried = false;
            let result: string | undefined;
            try {
                result = await attemptClassification();
            } catch (err) {
                if (provider.name === 'OpenRouter' && err instanceof OpenAI.APIError && err.status === 404 && !retried) {
                    retried = true;
                    await clearSelectedOpenRouterModel();
                    const apiKey = this.apiKey!;
                    const fallback = await chooseDefaultOpenRouterModel(apiKey);
                    if (fallback) {
                        provider.model = fallback;
                        await setSelectedOpenRouterModel(fallback);
                        result = await attemptClassification();
                    } else {
                        throw new Error('No fallback OpenRouter model available.');
                    }
                } else {
                    throw err;
                }
            }

            if (!result) {
                throw new Error('No response content received from AI provider');
            }
            const cleanResult = result.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(cleanResult);
            if (!parsed.folderPath || !Array.isArray(parsed.folderPath)) {
                throw new Error('Invalid response format: missing folderPath');
            }

            const rawFolderPath: unknown[] = parsed.folderPath;
            const folderPath = rawFolderPath
                .filter((segment: unknown): segment is string => typeof segment === 'string')
                .map((segment: string) => segment.trim())
                .filter(Boolean)
                .slice(0, 3);
            if (!folderPath.length) {
                throw new Error('Invalid response format: empty folderPath');
            }

            const rawTags: unknown[] = Array.isArray(parsed.tags) ? parsed.tags : [];
            const tags = rawTags
                .filter((tag: unknown): tag is string => typeof tag === 'string')
                .map((tag: string) => tag.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 5);

            const rawConfidence = Number(parsed.confidence);
            const confidence = Number.isFinite(rawConfidence)
                ? Math.max(0, Math.min(1, rawConfidence))
                : 0.5;

            return {
                folderPath,
                tags,
                confidence,
                providerId: effectiveProviderId,
                providerName: provider.name,
                model: provider.model,
            };
        } catch (error: unknown) {
            if (error instanceof OpenAI.APIError) {
                if (error.status === 401) {
                    throw new Error('Invalid API key. Please check your credentials.');
                } else if (error.status === 429) {
                    throw new Error('Rate limit exceeded. Please try again later.');
                } else if (error.status === 403) {
                    throw new Error('API access forbidden. Check your API key permissions.');
                } else {
                    throw new Error(`API Error (${error.status}): ${error.message}`);
                }
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Classification failed: ${errorMessage}`);
        }
    }

    private async resolveCredentials(
        overrideProvider?: string | null,
    ): Promise<{ providerId: ProviderId; apiKey: string }> {
        const requested = overrideProvider || this.providerOverride;
        if (isProviderId(requested)) {
            const apiKey = await SecurityManager.getApiKeyForProvider(requested);
            if (!apiKey) {
                throw new Error(`Save a ${PROVIDER_LABELS[requested]} API key first.`);
            }
            return { providerId: requested, apiKey };
        }

        const auto = await SecurityManager.resolveAutoCredentials();
        if (auto) {
            return auto;
        }

        const leftover = await SecurityManager.getApiKey();
        if (leftover) {
            const detected = detectProviderId(leftover);
            if (detected) {
                return { providerId: detected, apiKey: leftover };
            }
        }

        throw new Error('API key not configured. Please save your API key first.');
    }
}
