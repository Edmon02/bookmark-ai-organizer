import OpenAI from 'openai';
import { SecurityManager } from './security';

interface AIProvider {
    name: string;
    baseURL: string;
    model: string;
}

export class LlmClassifier {
    private apiKey: string | null = null;
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
        }
    };

    constructor() {
        this.loadApiKey();
    }

    private async loadApiKey() {
        this.apiKey = await SecurityManager.getApiKey();
    }

    private detectProvider(apiKey: string): AIProvider {
        // Auto-detect provider based on API key format or content
        if (apiKey.startsWith('sk-') && !apiKey.includes('kimi')) {
            return this.providers.openai;
        } else if (apiKey.includes('kimi') || apiKey.length > 40) {
            // Moonshot keys are often longer and may contain 'kimi' or be generic long tokens
            return this.providers.moonshot;
        } else if (apiKey.includes('grok') || apiKey.startsWith('xai-')) {
            return this.providers.grok;
        }
        // Default to Moonshot for most generic keys since that's what user is using
        return this.providers.moonshot;
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

        const prompt = `You are Kimi, an AI assistant. Please analyze this webpage and classify it into a bookmark folder structure.

URL: ${url}
Title: ${title}

Create a logical folder structure (maximum 3 levels) and relevant tags for bookmarking.

Respond with valid JSON only (no extra text or markdown):
{
  "folderPath": ["Category", "Subcategory", "Specific"],
  "tags": ["tag1", "tag2", "tag3"]
}

Examples:
- Tech blog → {"folderPath": ["Technology", "Blogs"], "tags": ["tech", "blog", "programming"]}
- Recipe site → {"folderPath": ["Lifestyle", "Food", "Recipes"], "tags": ["food", "cooking", "recipe"]}
- News article → {"folderPath": ["News", "Current Events"], "tags": ["news", "current", "events"]}`;

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