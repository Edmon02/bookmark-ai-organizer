// SPDX-License-Identifier: Apache-2.0
export interface FlatBookmark {
    id: string;
    title: string;
    url: string;
    path: string[];
}

export class BookmarkManager {
    async createBookmark(url: string, title: string, folderPath: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
        const folderId = await this.ensureFolderPath(folderPath);
        return chrome.bookmarks.create({
            parentId: folderId,
            title,
            url
        });
    }

    /** Find an existing bookmark by exact URL match and return it with its human-readable folder path. */
    async findByUrl(url: string): Promise<{ bookmark: chrome.bookmarks.BookmarkTreeNode; path: string[] } | null> {
        const results = await chrome.bookmarks.search({ url });
        const bookmark = results.find(r => r.url === url && r.parentId);
        if (!bookmark || !bookmark.parentId) return null;
        const path = await this.getPath(bookmark.parentId);
        return { bookmark, path };
    }

    /** Walk up the parent chain from a node/folder id, returning folder titles top-down (root excluded). */
    async getPath(nodeId: string): Promise<string[]> {
        const titles: string[] = [];
        let currentId: string | undefined = nodeId;
        while (currentId && currentId !== '0') {
            const [node]: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.get(currentId);
            if (!node) break;
            titles.unshift(node.title);
            currentId = node.parentId;
        }
        return titles;
    }

    /** Flatten the entire bookmark tree into a list of leaf bookmarks (nodes with a url) with their folder path. */
    async getFlatIndex(): Promise<FlatBookmark[]> {
        const [rootNode] = await chrome.bookmarks.getTree();
        const flat: FlatBookmark[] = [];

        const walk = (node: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
            if (node.url) {
                flat.push({ id: node.id, title: node.title, url: node.url, path });
                return;
            }
            const childPath = node.parentId ? [...path, node.title] : path; // skip synthetic root title
            for (const child of node.children || []) {
                walk(child, childPath);
            }
        };

        walk(rootNode, []);
        return flat;
    }

    async moveBookmark(id: string, folderPath: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
        const parentId = await this.ensureFolderPath(folderPath);
        return chrome.bookmarks.move(id, { parentId });
    }

    async renameBookmark(id: string, title: string): Promise<chrome.bookmarks.BookmarkTreeNode> {
        return chrome.bookmarks.update(id, { title });
    }

    async deleteBookmark(id: string): Promise<void> {
        await chrome.bookmarks.remove(id);
    }

    /** Move all children of sourcePath into targetPath, then remove the now-empty source folder. */
    async mergeFolders(sourcePath: string[], targetPath: string[]): Promise<void> {
        const sourceId = await this.ensureFolderPath(sourcePath);
        const targetId = await this.ensureFolderPath(targetPath);
        if (sourceId === targetId) return;
        const children = await chrome.bookmarks.getChildren(sourceId);
        for (const child of children) {
            await chrome.bookmarks.move(child.id, { parentId: targetId });
        }
        await chrome.bookmarks.remove(sourceId);
    }

    async ensureFolderPath(path: string[]): Promise<string> {
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