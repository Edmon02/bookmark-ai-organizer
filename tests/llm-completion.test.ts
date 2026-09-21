// SPDX-License-Identifier: Apache-2.0
const mockCreate = jest.fn();
const mockChooseDefaultOpenRouterModel = jest.fn();
const mockClearSelectedOpenRouterModel = jest.fn();
const mockSetSelectedOpenRouterModel = jest.fn();
const mockCreateClient = jest.fn();

class MockAPIError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

jest.mock('openai', () => {
    class MockOpenAI {
        static APIError = MockAPIError;
    }

    return { __esModule: true, default: MockOpenAI };
});

jest.mock('../src/utils/openrouter', () => ({
    chooseDefaultOpenRouterModel: (...args: unknown[]) => mockChooseDefaultOpenRouterModel(...args),
    clearSelectedOpenRouterModel: (...args: unknown[]) => mockClearSelectedOpenRouterModel(...args),
    setSelectedOpenRouterModel: (...args: unknown[]) => mockSetSelectedOpenRouterModel(...args)
}));

jest.mock('../src/utils/ai-provider', () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args)
}));

import { createChatCompletion, mapCompletionError } from '../src/utils/llm-completion';

describe('llm-completion', () => {
    beforeEach(() => {
        mockCreate.mockReset();
        mockChooseDefaultOpenRouterModel.mockReset();
        mockClearSelectedOpenRouterModel.mockReset();
        mockSetSelectedOpenRouterModel.mockReset();
        mockCreateClient.mockReset();
    });

    test('retries once with a persisted fallback model when OpenRouter returns 404', async () => {
        mockCreate
            .mockRejectedValueOnce(new MockAPIError(404, 'batch-only model'))
            .mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });
        mockChooseDefaultOpenRouterModel.mockResolvedValue('openai/gpt-4o-mini');
        mockCreateClient.mockReturnValue({
            client: { chat: { completions: { create: mockCreate } } },
            provider: { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'bad/model' }
        });

        const result = await createChatCompletion({
            apiKey: 'sk-or-v1-test',
            providerOverride: 'openrouter',
            selectedOpenRouterModel: 'bad/model',
            messages: [{ role: 'user', content: 'hello' }],
            maxTokens: 100
        });

        expect(mockClearSelectedOpenRouterModel).toHaveBeenCalled();
        expect(mockChooseDefaultOpenRouterModel).toHaveBeenCalledWith('sk-or-v1-test');
        expect(mockSetSelectedOpenRouterModel).toHaveBeenCalledWith('openai/gpt-4o-mini');
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(result.provider.model).toBe('openai/gpt-4o-mini');
        expect(result.fallbackModel).toBe('openai/gpt-4o-mini');
    });

    test('maps rate-limit errors to a friendly message', () => {
        const error = mapCompletionError(new MockAPIError(429, 'too many requests'));
        expect(error.message).toBe('Rate limit exceeded. Please try again later.');
    });

    test('maps missing models to a friendly message', () => {
        const error = mapCompletionError(new MockAPIError(404, 'not found'));
        expect(error.message).toBe('The selected model is unavailable for chat requests. Please choose a different model and try again.');
    });
});
