// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai';
import { AIProvider, createClient } from './ai-provider';
import {
    chooseDefaultOpenRouterModel,
    clearSelectedOpenRouterModel,
    setSelectedOpenRouterModel
} from './openrouter';

export interface LlmCompletionOptions {
    apiKey: string;
    providerOverride?: string | null;
    selectedOpenRouterModel?: string | null;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    maxTokens: number;
    temperature?: number;
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
}

export interface LlmCompletionResult {
    completion: OpenAI.Chat.Completions.ChatCompletion;
    provider: AIProvider;
    fallbackModel: string | null;
}

export async function createChatCompletion(
    options: LlmCompletionOptions
): Promise<LlmCompletionResult> {
    const { apiKey, providerOverride, selectedOpenRouterModel, messages, maxTokens, temperature, tools } = options;
    const { client, provider } = createClient(apiKey, providerOverride, selectedOpenRouterModel);

    const request = () => client.chat.completions.create({
        model: provider.model,
        messages,
        max_tokens: maxTokens,
        temperature: temperature ?? 0.2,
        ...(tools ? { tools } : {})
    });

    try {
        return { completion: await request(), provider, fallbackModel: null };
    } catch (error) {
        if (provider.name === 'OpenRouter' && error instanceof OpenAI.APIError && error.status === 404) {
            await clearSelectedOpenRouterModel();
            const fallbackModel = await chooseDefaultOpenRouterModel(apiKey);
            if (!fallbackModel) {
                throw new Error('OpenRouter could not find a working chat model. Please refresh the model list and select another model.');
            }

            provider.model = fallbackModel;
            await setSelectedOpenRouterModel(fallbackModel);
            try {
                return { completion: await request(), provider, fallbackModel };
            } catch (fallbackError) {
                throw mapCompletionError(fallbackError);
            }
        }

        throw mapCompletionError(error);
    }
}

export function mapCompletionError(error: unknown): Error {
    if (error instanceof OpenAI.APIError) {
        if (error.status === 401) {
            return new Error('Invalid API key. Please check your credentials.');
        }
        if (error.status === 403) {
            return new Error('API access forbidden. Check your API key permissions.');
        }
        if (error.status === 404) {
            return new Error('The selected model is unavailable for chat requests. Please choose a different model and try again.');
        }
        if (error.status === 429) {
            return new Error('Rate limit exceeded. Please try again later.');
        }
        return new Error(`API Error (${error.status}): ${error.message}`);
    }

    if (error instanceof Error) {
        return error;
    }

    return new Error('Unknown error occurred');
}

export function stripMarkdownCodeFences(content: string): string {
    return content.replace(/```json\n?|\n?```/g, '').trim();
}
