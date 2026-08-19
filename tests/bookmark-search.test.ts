// SPDX-License-Identifier: Apache-2.0
const mockCreate = jest.fn();

jest.mock('openai', () => {
    class MockOpenAI {
        chat = { completions: { create: mockCreate } };
        static APIError = class extends Error { };
    }
    return { __esModule: true, default: MockOpenAI };
});

import { findMatchingBookmarks } from '../src/utils/bookmark-search';

describe('bookmark-search', () => {
    beforeEach(() => {
        mockCreate.mockReset();
        chrome.storage.sync.get = jest.fn().mockResolvedValue({ encrypted_api_key: btoa('sk-test-key') });
        chrome.storage.local.get = jest.fn().mockResolvedValue({});
        chrome.bookmarks.getTree = jest.fn().mockResolvedValue([
            {
                id: '0', title: '', children: [
                    {
                        id: '1', parentId: '0', title: 'Bookmarks Bar', children: [
                            { id: '2', parentId: '1', title: 'Example', url: 'https://example.com' },
                            { id: '3', parentId: '1', title: 'GitHub', url: 'https://github.com' }
                        ]
                    }
                ]
            }
        ]);
    });

    test('throws when description is empty', async () => {
        await expect(findMatchingBookmarks('   ')).rejects.toThrow('describe the page');
    });

    test('throws when no API key is configured', async () => {
        chrome.storage.sync.get = jest.fn().mockResolvedValue({});
        await expect(findMatchingBookmarks('some page')).rejects.toThrow('API key not configured');
    });

    test('only returns matches whose id exists in the local bookmark index', async () => {
        mockCreate.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        matches: [
                            { id: '3', reason: 'Matches GitHub', score: 0.9 },
                            { id: 'hallucinated-id', reason: 'should be ignored', score: 0.8 }
                        ]
                    })
                }
            }]
        });

        const matches = await findMatchingBookmarks('a coding repository site');

        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({ id: '3', title: 'GitHub', url: 'https://github.com', reason: 'Matches GitHub', score: 0.9 });
    });

    test('throws a friendly error when the AI response is not valid JSON', async () => {
        mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });
        await expect(findMatchingBookmarks('anything')).rejects.toThrow('unparseable response');
    });
});
