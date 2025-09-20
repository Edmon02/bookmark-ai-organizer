// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai';
import { SecurityManager } from './security';
import { getProviderPreference, getSelectedOpenRouterModel, chooseDefaultOpenRouterModel, clearSelectedOpenRouterModel, setSelectedOpenRouterModel } from './openrouter';

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

    constructor() {
        this.loadApiKey();
    }

    private async loadApiKey() {
        this.apiKey = (await SecurityManager.getApiKey())?.trim();
    }

    private async loadPreferences() {
        try {
            this.providerOverride = await getProviderPreference();
            this.selectedOpenRouterModel = await getSelectedOpenRouterModel();
        } catch (e) {
            console.warn('Failed to load provider preferences', e);
        }
    }

    private detectProvider(apiKey: string): AIProvider {
        // Auto-detect provider based on API key format or content
        if (apiKey.startsWith('gsk_')) {
            console.log('Selected provider: Groq');
            return this.providers.groq;
        } else if (apiKey.startsWith('sk-') && !apiKey.includes('kimi') && !apiKey.includes('or-v1')) {
            return this.providers.openai;
        } else if (apiKey.startsWith('sk-or-v1-') || apiKey.includes('openrouter')) {
            return this.providers.openrouter;
        } else if (apiKey.includes('kimi') || apiKey.length > 40) {
            // Moonshot keys are often longer and may contain 'kimi' or be generic long tokens
            return this.providers.moonshot;
        } else if (apiKey.includes('grok') || apiKey.startsWith('xai-')) {
            return this.providers.grok;
        }
        // Default to OpenRouter for most generic keys since it supports many models
        return this.providers.openrouter;
    }

    async classifyUrl(url: string, title: string): Promise<{ folderPath: string[], tags: string[] }> {
        // Always reload API key to ensure we have the latest saved key
        await this.loadApiKey();

        if (!this.apiKey) {
            throw new Error('API key not configured. Please save your API key first.');
        }

        console.log('Using API key (first 10 chars):', this.apiKey.substring(0, 10) + '...');
        await this.loadPreferences();

        const baseProvider = (this.providerOverride && this.providers[this.providerOverride])
            ? this.providers[this.providerOverride]
            : this.detectProvider(this.apiKey);
        const provider = { ...baseProvider }; // copy to avoid mutating shared config

        if (provider.name === 'OpenRouter' && this.selectedOpenRouterModel) {
            provider.model = this.selectedOpenRouterModel;
        }
        console.log('Using provider:', provider.name, 'model:', provider.model);

        // Create OpenAI client with provider-specific configuration
        const client = new OpenAI({
            apiKey: this.apiKey,
            baseURL: provider.baseURL,
            dangerouslyAllowBrowser: true // Allow usage in browser extension
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

3. **Context**:
   - Infer the webpage’s purpose from the URL and title (e.g., blog, e-commerce, news, social media, education).
   - Consider the domain (e.g., github.com → coding, amazon.com → shopping).

4. **Output**:
   - Respond with valid JSON only, containing "folderPath" (array of strings) and "tags" (array of strings).
   - Do not include markdown, code fences, or extra text.

**URL**: ${url}
**Title**: ${title}

**Examples**:
- URL: https://www.nytimes.com/politics, Title: "Election Updates"
  → {"folderPath": ["📰 News", "🌍 Global", "🗳️ Politics"], "tags": ["politics", "election", "news"]}
- URL: https://github.com/python, Title: "Python Repository"
  → {"folderPath": ["💻 Technology", "🖥️ Software", "🛠️ Coding"], "tags": ["coding", "python", "github"]}
- URL: https://www.amazon.com/electronics, Title: "Electronics Store"
  → {"folderPath": ["🛒 Shopping", "📱 Electronics"], "tags": ["shopping", "electronics", "amazon"]}
- URL: https://www.khanacademy.org/math, Title: "Math Lessons"
  → {"folderPath": ["📚 Education", "➗ Math"], "tags": ["education", "math", "learning"]}
- URL: https://www.reddit.com/r/science, Title: "Science Discussions"
  → {"folderPath": ["🌐 Social Media", "🔬 Science"], "tags": ["social", "science", "reddit"]} 

**Response Format**:
{
  "folderPath": ["Emoji Category", "Emoji Subcategory", "Emoji Specific"],
  "tags": ["tag1", "tag2", "tag3"]
}`;

        try {
            const attemptClassification = async (): Promise<string> => {
                const completion = await client.chat.completions.create({
                    model: provider.model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 300,
                    temperature: 0.2
                });
                return completion.choices[0].message.content || '';
            };

            let retried = false;
            let result: string | undefined;
            try {
                console.log(`Using ${provider.name} for classification (model=${provider.model})`);
                result = await attemptClassification();
            } catch (err) {
                if (provider.name === 'OpenRouter' && err instanceof OpenAI.APIError && err.status === 404 && !retried) {
                    console.warn('OpenRouter model returned 404; attempting fallback model. Original model:', provider.model);
                    retried = true;
                    await clearSelectedOpenRouterModel();
                    const apiKey = this.apiKey!;
                    const fallback = await chooseDefaultOpenRouterModel(apiKey);
                    if (fallback) {
                        provider.model = fallback;
                        console.log('Retrying with fallback OpenRouter model:', fallback);
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
            console.log('Classification successful:', parsed);
            return {
                folderPath: parsed.folderPath.slice(0, 3),
                tags: parsed.tags || []
            };
        } catch (error: unknown) {
            console.error('Classification error:', error);
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
}