// SPDX-License-Identifier: Apache-2.0
import { chooseDefaultOpenRouterModel, fetchOpenRouterModels } from '../src/utils/openrouter';

describe('openrouter model helpers', () => {
    beforeEach(() => {
        chrome.storage.local.get = jest.fn().mockResolvedValue({});
        chrome.storage.local.set = jest.fn().mockResolvedValue(undefined);
        global.fetch = jest.fn();
    });

    test('filters out batch-only models from the picker list', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                data: [
                    { id: 'moonshot/kimi-k2-batch', name: 'Kimi Batch', description: 'offline processing with batch jobs' },
                    { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', description: 'chat model' }
                ]
            })
        });

        const models = await fetchOpenRouterModels('test-key', true);

        expect(models.map(model => model.id)).toEqual(['openai/gpt-4o-mini']);
    });

    test('prefers stable chat models when choosing a default fallback', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                data: [
                    { id: 'moonshot/kimi-k2-batch', name: 'Kimi Batch', description: 'batch only' },
                    { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', description: 'chat model' },
                    { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1', description: 'chat model' }
                ]
            })
        });

        const model = await chooseDefaultOpenRouterModel('test-key');

        expect(model).toBe('openai/gpt-4o-mini');
    });
});
