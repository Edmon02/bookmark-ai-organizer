// tests/bookmark-manager.test.ts
import { BookmarkManager } from '../src/utils/bookmark-manager';

describe('BookmarkManager', () => {
    let manager: BookmarkManager;

    beforeEach(() => {
        manager = new BookmarkManager();
    });

    test('should create a bookmark in an existing folder', async () => {
        // Mock chrome.bookmarks API
        chrome.bookmarks.create = jest.fn().mockResolvedValue({ id: '123', title: 'Test', url: 'https://example.com' });
        chrome.bookmarks.getChildren = jest.fn().mockResolvedValue([{ id: '2', title: 'Technology', url: null }]);

        const bookmark = await manager.createBookmark('https://example.com', 'Test', ['Technology']);
        expect(bookmark).toEqual({ id: '123', title: 'Test', url: 'https://example.com' });
    });
});