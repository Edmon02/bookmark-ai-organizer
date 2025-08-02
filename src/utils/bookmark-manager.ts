export class BookmarkManager {
    async createBookmark(url: string, title: string, folderPath: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
        const folderId = await this.ensureFolderPath(folderPath);
        return chrome.bookmarks.create({
            parentId: folderId,
            title,
            url
        });
    }

    private async ensureFolderPath(path: string[]): Promise<string> {
        let currentId = '1'; // Bookmarks menu ID
        for (const folderName of path) {
            const existingFolder = await this.findFolder(currentId, folderName);
            if (existingFolder) {
                currentId = existingFolder.id;
            } else {
                const newFolder = await chrome.bookmarks.create({
                    parentId: currentId,
                    title: folderName
                });
                currentId = newFolder.id;
            }
        }
        return currentId;
    }

    private async findFolder(parentId: string, name: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
        const children = await chrome.bookmarks.getChildren(parentId);
        return children.find(child => child.title === name && !child.url) || null;
    }
}