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

    test('findByUrl returns null when no bookmark matches', async () => {
        chrome.bookmarks.search = jest.fn().mockResolvedValue([]);
        const result = await manager.findByUrl('https://nope.example.com');
        expect(result).toBeNull();
    });

    test('findByUrl returns the bookmark and its folder path', async () => {
        chrome.bookmarks.search = jest.fn().mockResolvedValue([
            { id: '10', parentId: '5', title: 'Example', url: 'https://example.com' }
        ]);
        chrome.bookmarks.get = jest.fn()
            .mockResolvedValueOnce([{ id: '5', parentId: '1', title: '💻 Tech' }])
            .mockResolvedValueOnce([{ id: '1', parentId: '0', title: 'Bookmarks Bar' }]);

        const result = await manager.findByUrl('https://example.com');
        expect(result).toEqual({
            bookmark: { id: '10', parentId: '5', title: 'Example', url: 'https://example.com' },
            path: ['Bookmarks Bar', '💻 Tech']
        });
    });

    test('getFlatIndex flattens the bookmark tree with folder paths', async () => {
        chrome.bookmarks.getTree = jest.fn().mockResolvedValue([
            {
                id: '0', title: '', children: [
                    {
                        id: '1', parentId: '0', title: 'Bookmarks Bar', children: [
                            { id: '2', parentId: '1', title: 'Example', url: 'https://example.com' },
                            {
                                id: '3', parentId: '1', title: '💻 Tech', children: [
                                    { id: '4', parentId: '3', title: 'GitHub', url: 'https://github.com' }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]);

        const flat = await manager.getFlatIndex();
        expect(flat).toEqual([
            { id: '2', title: 'Example', url: 'https://example.com', path: ['Bookmarks Bar'] },
            { id: '4', title: 'GitHub', url: 'https://github.com', path: ['Bookmarks Bar', '💻 Tech'] }
        ]);
    });

    test('moveBookmark ensures the folder path exists and moves the bookmark', async () => {
        chrome.bookmarks.getChildren = jest.fn().mockResolvedValue([]);
        chrome.bookmarks.create = jest.fn().mockResolvedValue({ id: '99', title: '📁 New' });
        chrome.bookmarks.move = jest.fn().mockResolvedValue({ id: '2', parentId: '99' });

        const result = await manager.moveBookmark('2', ['📁 New']);
        expect(chrome.bookmarks.move).toHaveBeenCalledWith('2', { parentId: '99' });
        expect(result).toEqual({ id: '2', parentId: '99' });
    });

    test('renameBookmark updates the bookmark title', async () => {
        chrome.bookmarks.update = jest.fn().mockResolvedValue({ id: '2', title: 'New Title' });
        const result = await manager.renameBookmark('2', 'New Title');
        expect(chrome.bookmarks.update).toHaveBeenCalledWith('2', { title: 'New Title' });
        expect(result).toEqual({ id: '2', title: 'New Title' });
    });

    test('deleteBookmark removes the bookmark', async () => {
        chrome.bookmarks.remove = jest.fn().mockResolvedValue(undefined);
        await manager.deleteBookmark('2');
        expect(chrome.bookmarks.remove).toHaveBeenCalledWith('2');
    });

    test('mergeFolders moves all children into target and removes the source folder', async () => {
        chrome.bookmarks.getChildren = jest.fn()
            .mockResolvedValueOnce([]) // ensureFolderPath('Source') lookup at root
            .mockResolvedValueOnce([]) // ensureFolderPath('Target') lookup at root
            .mockResolvedValueOnce([{ id: 'c1', title: 'Child1', url: 'https://a.com' }]); // children of source
        chrome.bookmarks.create = jest.fn()
            .mockResolvedValueOnce({ id: 'src', title: 'Source' })
            .mockResolvedValueOnce({ id: 'tgt', title: 'Target' });
        chrome.bookmarks.move = jest.fn().mockResolvedValue({ id: 'c1', parentId: 'tgt' });
        chrome.bookmarks.remove = jest.fn().mockResolvedValue(undefined);

        await manager.mergeFolders(['Source'], ['Target']);

        expect(chrome.bookmarks.move).toHaveBeenCalledWith('c1', { parentId: 'tgt' });
        expect(chrome.bookmarks.remove).toHaveBeenCalledWith('src');
    });
});