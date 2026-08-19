// SPDX-License-Identifier: Apache-2.0
const mockCreate = jest.fn();

jest.mock('openai', () => {
    class MockOpenAI {
        chat = { completions: { create: mockCreate } };
        static APIError = class extends Error { };
    }
    return { __esModule: true, default: MockOpenAI };
});

import { chat, applyProposedAction, ProposedAction } from '../src/utils/bookmark-assistant';

function mockBookmarkTree() {
    chrome.bookmarks.getTree = jest.fn().mockResolvedValue([
        {
            id: '0', title: '', children: [
                {
                    id: '1', parentId: '0', title: 'Bookmarks Bar', children: [
                        { id: '2', parentId: '1', title: 'Example', url: 'https://example.com' },
                        {
                            id: '10',
                            parentId: '1',
                            title: 'Education',
                            children: [
                                {
                                    id: '11',
                                    parentId: '10',
                                    title: 'Courses',
                                    children: [
                                        {
                                            id: '12',
                                            parentId: '11',
                                            title: 'Deep Bookmark',
                                            url: 'https://deep.example.com'
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]);
}

describe('bookmark-assistant chat', () => {
    beforeEach(() => {
        mockCreate.mockReset();
        chrome.storage.sync.get = jest.fn().mockResolvedValue({ encrypted_api_key: btoa('sk-test-key') });
        chrome.storage.local.get = jest.fn().mockResolvedValue({});
        mockBookmarkTree();
    });

    test('throws when no API key is configured', async () => {
        chrome.storage.sync.get = jest.fn().mockResolvedValue({});
        await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('API key not configured');
    });

    test('returns plain content when the model makes no tool calls', async () => {
        mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Here are your bookmarks.' } }] });
        const result = await chat([{ role: 'user', content: 'list my bookmarks' }]);
        expect(result).toEqual({ content: 'Here are your bookmarks.', proposedActions: [] });
    });

    test('a propose_delete tool call never deletes the bookmark, only records a proposal', async () => {
        mockCreate
            .mockResolvedValueOnce({
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: { name: 'propose_delete', arguments: JSON.stringify({ bookmarkId: '2' }) }
                        }]
                    }
                }]
            })
            .mockResolvedValueOnce({ choices: [{ message: { content: 'I proposed deleting that bookmark.' } }] });

        chrome.bookmarks.remove = jest.fn();

        const result = await chat([{ role: 'user', content: 'delete the example bookmark' }]);

        expect(chrome.bookmarks.remove).not.toHaveBeenCalled();
        expect(result.proposedActions).toHaveLength(1);
        expect(result.proposedActions[0]).toMatchObject({ type: 'delete', payload: { bookmarkId: '2' } });
    });

    test('rejects a proposal referencing an unknown bookmark id', async () => {
        mockCreate
            .mockResolvedValueOnce({
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: { name: 'propose_delete', arguments: JSON.stringify({ bookmarkId: 'does-not-exist' }) }
                        }]
                    }
                }]
            })
            .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] });

        const result = await chat([{ role: 'user', content: 'delete something fake' }]);
        expect(result.proposedActions).toHaveLength(0);
    });

    test('list_bookmarks returns deepest bookmarks first for organized-library requests', async () => {
        mockCreate
            .mockResolvedValueOnce({
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'list_bookmarks',
                                arguments: JSON.stringify({ sort: 'depth', limit: 2 })
                            }
                        }]
                    }
                }]
            })
            .mockResolvedValueOnce({ choices: [{ message: { content: 'Here are the deepest bookmarks.' } }] });

        const result = await chat([{ role: 'user', content: 'show me the top 2 most organized bookmarks' }]);

        expect(result).toEqual({ content: 'Here are the deepest bookmarks.', proposedActions: [] });

        const secondRequest = mockCreate.mock.calls[1][0];
        const toolMessage = secondRequest.messages.find((message: any) => message.role === 'tool');
        const payload = JSON.parse(toolMessage.content);

        expect(payload.results).toHaveLength(2);
        expect(payload.results[0]).toMatchObject({ id: '12', title: 'Deep Bookmark', depth: 3 });
        expect(payload.results[1]).toMatchObject({ id: '2', title: 'Example', depth: 1 });
    });
});

describe('applyProposedAction', () => {
    beforeEach(() => {
        mockBookmarkTree();
    });

    test('executes a move action for a known bookmark id', async () => {
        chrome.bookmarks.getChildren = jest.fn().mockResolvedValue([]);
        chrome.bookmarks.create = jest.fn().mockResolvedValue({ id: '99', title: '📁 New' });
        chrome.bookmarks.move = jest.fn().mockResolvedValue({ id: '2', parentId: '99' });

        const action: ProposedAction = {
            actionId: 'a1',
            type: 'move',
            description: 'Move bookmark 2 to folder "📁 New"',
            payload: { bookmarkId: '2', folderPath: ['📁 New'] }
        };

        await applyProposedAction(action);
        expect(chrome.bookmarks.move).toHaveBeenCalledWith('2', { parentId: '99' });
    });

    test('throws when the bookmark no longer exists', async () => {
        const action: ProposedAction = {
            actionId: 'a1',
            type: 'delete',
            description: 'Delete bookmark 404',
            payload: { bookmarkId: '404' }
        };

        await expect(applyProposedAction(action)).rejects.toThrow('no longer exists');
    });
});
