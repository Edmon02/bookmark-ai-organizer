const mockBookmarkManager = {
    createBookmark: jest.fn(),
    moveBookmarkToFolderPath: jest.fn(),
    moveBookmarkToParent: jest.fn(),
};

const mockClassifier = {
    classifyUrlWithMeta: jest.fn(),
};

const mockSecurity = {
    storeApiKey: jest.fn(),
    hasApiKey: jest.fn(),
    getApiKeyHint: jest.fn(),
    getApiKey: jest.fn(),
    getApiKeyForProvider: jest.fn(),
    listStoredKeys: jest.fn(),
    clearApiKey: jest.fn(),
};

const mockOpenRouter = {
    fetchOpenRouterModels: jest.fn(),
    getProviderPreference: jest.fn(),
    getSelectedOpenRouterModel: jest.fn(),
};

const mockPlanner = {
    planLibraryReorganization: jest.fn(),
};

const mockTree = {
    getClassificationRoot: jest.fn(),
    listClassifiableBookmarks: jest.fn(),
};

jest.mock('../src/utils/bookmark-manager', () => ({
    BookmarkManager: jest.fn().mockImplementation(() => mockBookmarkManager),
}));

jest.mock('../src/utils/llm-classifier', () => ({
    LlmClassifier: jest.fn().mockImplementation(() => mockClassifier),
}));

jest.mock('../src/utils/security', () => ({
    SecurityManager: mockSecurity,
}));

jest.mock('../src/utils/openrouter', () => ({
    fetchOpenRouterModels: (...args: unknown[]) => mockOpenRouter.fetchOpenRouterModels(...args),
    getProviderPreference: (...args: unknown[]) => mockOpenRouter.getProviderPreference(...args),
    getSelectedOpenRouterModel: (...args: unknown[]) => mockOpenRouter.getSelectedOpenRouterModel(...args),
}));

jest.mock('../src/utils/reorg-planner', () => ({
    planLibraryReorganization: (...args: unknown[]) => mockPlanner.planLibraryReorganization(...args),
}));

jest.mock('../src/utils/bookmark-tree', () => ({
    getClassificationRoot: (...args: unknown[]) => mockTree.getClassificationRoot(...args),
    listClassifiableBookmarks: (...args: unknown[]) => mockTree.listClassifiableBookmarks(...args),
}));

describe('Background service worker runtime contract', () => {
    let onMessageListener: ((request: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null;
    let onCreatedListener: ((bookmarkId: string, bookmark: chrome.bookmarks.BookmarkTreeNode) => void) | null;
    let localStore: Record<string, unknown>;
    let sessionStore: Record<string, unknown>;
    let storageSetMock: jest.Mock;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        onMessageListener = null;
        onCreatedListener = null;
        localStore = {};
        sessionStore = {};
        storageSetMock = jest.fn(async (values: Record<string, unknown>) => {
            Object.assign(localStore, values);
        });

        (globalThis as { chrome?: unknown }).chrome = {
            runtime: {
                id: 'ext-id',
                onMessage: {
                    addListener: jest.fn((listener: typeof onMessageListener) => {
                        onMessageListener = listener;
                    }),
                },
                onInstalled: {
                    addListener: jest.fn(),
                },
                onConnect: {
                    addListener: jest.fn(),
                },
            },
            bookmarks: {
                onCreated: {
                    addListener: jest.fn((listener: typeof onCreatedListener) => {
                        onCreatedListener = listener;
                    }),
                },
                get: jest.fn(),
            },
            storage: {
                local: {
                    get: jest.fn(async (key: string) => ({ [key]: localStore[key] })),
                    set: storageSetMock,
                    remove: jest.fn(async (key: string) => {
                        delete localStore[key];
                    }),
                },
                session: {
                    get: jest.fn(async (key: string) => ({ [key]: sessionStore[key] })),
                    set: jest.fn(async (values: Record<string, unknown>) => {
                        Object.assign(sessionStore, values);
                    }),
                    remove: jest.fn(async (key: string) => {
                        delete sessionStore[key];
                    }),
                },
            },
        };

        if (typeof globalThis.addEventListener !== 'function') {
            (globalThis as { addEventListener: typeof addEventListener }).addEventListener = jest.fn() as unknown as typeof addEventListener;
        } else {
            jest.spyOn(globalThis, 'addEventListener').mockImplementation(() => {});
        }

        mockSecurity.hasApiKey.mockResolvedValue(true);
        mockSecurity.getApiKeyHint.mockResolvedValue('ends with 6789');
        mockSecurity.listStoredKeys.mockResolvedValue([{ providerId: 'openrouter', hint: 'ends with 6789' }]);
        mockSecurity.getApiKeyForProvider.mockImplementation(async (providerId: string) => {
            if (providerId === 'openrouter') {
                return 'sk-or-v1-test';
            }
            if (providerId === 'typesafe') {
                return 'apikey_test_123456';
            }
            return null;
        });
        mockOpenRouter.getProviderPreference.mockResolvedValue('openrouter');
        mockOpenRouter.getSelectedOpenRouterModel.mockResolvedValue('openai/gpt-4o-mini');
        mockOpenRouter.fetchOpenRouterModels.mockResolvedValue([{ id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' }]);
        mockClassifier.classifyUrlWithMeta.mockResolvedValue({
            folderPath: ['💻 Technology'],
            tags: ['coding'],
            confidence: 0.92,
            providerId: 'openrouter',
            providerName: 'OpenRouter',
            model: 'openai/gpt-4o-mini',
        });
        mockBookmarkManager.createBookmark.mockResolvedValue({
            bookmark: { id: '10', title: 'Example', url: 'https://example.com' },
            folderPath: ['💻 Technology'],
            folderId: '2',
        });
        mockBookmarkManager.moveBookmarkToFolderPath.mockResolvedValue({
            bookmark: { id: '10', title: 'Example', url: 'https://example.com' },
            previousFolderPath: ['Old'],
            folderPath: ['💻 Technology'],
            folderId: '2',
        });
        mockBookmarkManager.moveBookmarkToParent.mockResolvedValue({
            id: '10',
            title: 'Example',
            url: 'https://example.com',
            parentId: '20',
        });
        mockTree.listClassifiableBookmarks.mockResolvedValue([
            { id: '10', title: 'Example', url: 'https://example.com', parentId: '20', currentPath: ['Old'] },
        ]);
        mockTree.getClassificationRoot.mockResolvedValue({ id: '1', title: 'Bookmarks Bar', path: [], children: [] });
        mockPlanner.planLibraryReorganization.mockResolvedValue([
            {
                bookmarkId: '10',
                title: 'Example',
                url: 'https://example.com',
                fromPath: ['Old'],
                toPath: ['💻 Technology'],
                fromParentId: '20',
                confidence: 0.91,
                keepProbability: 0.1,
                decision: 'apply',
                reason: 'High-confidence folder match.',
            },
        ]);

        await import('../src/background/service-worker');
        expect(onMessageListener).toBeTruthy();
        expect(onCreatedListener).toBeTruthy();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('rejects malformed runtime payloads', async () => {
        const sendResponse = jest.fn();
        onMessageListener!(null, { id: 'ext-id' }, sendResponse);
        await waitForCall(sendResponse);

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Invalid request payload.',
        });
    });

    test('rejects unauthorized sender id', async () => {
        const sendResponse = jest.fn();
        onMessageListener!({ action: 'GET_SETTINGS_STATE' }, { id: 'foreign-extension' }, sendResponse);
        await waitForCall(sendResponse);

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Unauthorized request sender.',
        });
    });

    test('returns hydrated settings state', async () => {
        localStore['auto_classify_enabled'] = true;
        const sendResponse = jest.fn();
        onMessageListener!({ action: 'GET_SETTINGS_STATE' }, { id: 'ext-id' }, sendResponse);
        await waitForCall(sendResponse);

        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: {
                hasApiKey: true,
                apiKeyHint: 'ends with 6789',
                keyedProviders: [{ providerId: 'openrouter', hint: 'ends with 6789' }],
                providerPreference: 'openrouter',
                selectedOpenRouterModel: 'openai/gpt-4o-mini',
                autoClassifyEnabled: true,
            },
        });
    });

    test('classifies and saves a bookmark through validated contract', async () => {
        jest.useFakeTimers();

        const sendResponse = jest.fn();
        onMessageListener!(
            {
                action: 'CLASSIFY_AND_SAVE',
                data: { url: 'https://example.com', title: 'Example' },
            },
            { id: 'ext-id' },
            sendResponse,
        );
        await waitForCall(sendResponse);

        expect(mockClassifier.classifyUrlWithMeta).toHaveBeenCalledWith('https://example.com', 'Example', {});
        expect(mockBookmarkManager.createBookmark).toHaveBeenCalledWith(
            'https://example.com',
            'Example',
            ['💻 Technology'],
        );
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            result: expect.objectContaining({
                action: 'created',
                folderPath: ['💻 Technology'],
                confidence: 0.92,
                model: 'openai/gpt-4o-mini',
            }),
        }));
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    test('persists auto-classify toggle', async () => {
        const sendResponse = jest.fn();
        onMessageListener!(
            {
                action: 'SET_AUTO_CLASSIFY',
                data: { enabled: true },
            },
            { id: 'ext-id' },
            sendResponse,
        );
        await waitForCall(sendResponse);

        expect(storageSetMock).toHaveBeenCalledWith({ auto_classify_enabled: true });
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: { autoClassifyEnabled: true },
        });
    });

    test('skips auto-classify move for internal create fingerprint', async () => {
        jest.useFakeTimers();
        const sendResponse = jest.fn();
        onMessageListener!(
            {
                action: 'CLASSIFY_AND_SAVE',
                data: { url: 'https://example.com', title: 'Example' },
            },
            { id: 'ext-id' },
            sendResponse,
        );
        await waitForCall(sendResponse);

        localStore['auto_classify_enabled'] = true;
        onCreatedListener!('10', {
            id: '10',
            title: 'Example',
            url: 'https://example.com',
        } as chrome.bookmarks.BookmarkTreeNode);
        await waitForCall(jest.fn(), 2);

        expect(mockBookmarkManager.moveBookmarkToFolderPath).not.toHaveBeenCalled();
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    test('preview scan never moves bookmarks', async () => {
        const sendResponse = jest.fn();
        onMessageListener!({ action: 'START_REORG_SCAN' }, { id: 'ext-id' }, sendResponse);
        await waitForCall(sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: { status: 'scanning' },
        });

        await waitForCondition(() => {
            const job = sessionStore.reorg_job as { status?: string } | undefined;
            return job?.status === 'review';
        });

        expect(mockPlanner.planLibraryReorganization).toHaveBeenCalled();
        expect(mockBookmarkManager.moveBookmarkToFolderPath).not.toHaveBeenCalled();
        expect(mockBookmarkManager.moveBookmarkToParent).not.toHaveBeenCalled();
    });

    test('apply moves only approved bookmark ids and undo restores parents', async () => {
        sessionStore.reorg_job = {
            status: 'review',
            total: 2,
            processed: 2,
            suggestions: [
                {
                    bookmarkId: '10',
                    title: 'Example',
                    url: 'https://example.com',
                    fromPath: ['Old'],
                    toPath: ['💻 Technology'],
                    fromParentId: '20',
                    confidence: 0.91,
                    keepProbability: 0.1,
                    decision: 'apply',
                    reason: 'High-confidence folder match.',
                },
                {
                    bookmarkId: '11',
                    title: 'Skip me',
                    url: 'https://example.com/skip',
                    fromPath: ['Old'],
                    toPath: ['📰 News'],
                    fromParentId: '20',
                    confidence: 0.5,
                    keepProbability: 0.2,
                    decision: 'review',
                    reason: 'Plausible match — review before moving.',
                },
            ],
            updatedAt: Date.now(),
        };

        const applyResponse = jest.fn();
        onMessageListener!(
            { action: 'APPLY_REORG', data: { bookmarkIds: ['10'] } },
            { id: 'ext-id' },
            applyResponse,
        );
        await waitForCall(applyResponse);

        expect(mockBookmarkManager.moveBookmarkToFolderPath).toHaveBeenCalledTimes(1);
        expect(mockBookmarkManager.moveBookmarkToFolderPath).toHaveBeenCalledWith('10', ['💻 Technology']);
        expect(applyResponse).toHaveBeenCalledWith({
            success: true,
            result: { appliedCount: 1, skipped: 1 },
        });

        const undoResponse = jest.fn();
        onMessageListener!({ action: 'UNDO_REORG' }, { id: 'ext-id' }, undoResponse);
        await waitForCall(undoResponse);
        expect(mockBookmarkManager.moveBookmarkToParent).toHaveBeenCalledWith('10', '20');
        expect(undoResponse).toHaveBeenCalledWith({
            success: true,
            result: { restoredCount: 1 },
        });
    });
});

async function waitForCall(mockFn: jest.Mock, maxTicks = 12): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
        if (mockFn.mock.calls.length > 0) {
            return;
        }
        await Promise.resolve();
    }
}

async function waitForCondition(check: () => boolean, maxTicks = 40): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
        if (check()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for condition');
}
