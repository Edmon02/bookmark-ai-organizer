import OpenAI from 'openai';
import { SecurityManager } from './security';

interface AIProvider {
    name: string;
    baseURL: string;
    model: string;
}

export class LlmClassifier {
    private apiKey: string | undefined = undefined;
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
            model: 'openrouter/horizon-beta'
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
        const provider = this.detectProvider(this.apiKey);
        console.log('Detected provider:', provider.name);

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
            console.log(`Using ${provider.name} for classification`);

            const completion = await client.chat.completions.create({
                model: provider.model,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: 300,
                temperature: 0.2
            });

            const result = completion.choices[0].message.content;

            if (!result) {
                throw new Error('No response content received from AI provider');
            }

            // Clean and parse JSON response
            const cleanResult = result.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(cleanResult);

            // Validate response structure
            if (!parsed.folderPath || !Array.isArray(parsed.folderPath)) {
                throw new Error('Invalid response format: missing folderPath');
            }

            console.log('Classification successful:', parsed);
            return {
                folderPath: parsed.folderPath.slice(0, 3), // Max 3 levels
                tags: parsed.tags || []
            };

        } catch (error) {
            console.error('Classification error:', error);

            // Enhanced error handling for OpenAI library
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