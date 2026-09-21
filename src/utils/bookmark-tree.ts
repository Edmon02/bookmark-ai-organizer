// SPDX-License-Identifier: Apache-2.0

export const BOOKMARKS_BAR_ID = '1';
export const OTHER_BOOKMARKS_ID = '2';

export interface FolderNode {
    id: string;
    title: string;
    path: string[];
    children: FolderNode[];
}

export interface ClassifiableBookmark {
    id: string;
    title: string;
    url: string;
    parentId: string;
    currentPath: string[];
}

export async function getClassificationRoot(): Promise<FolderNode> {
    const [bar] = await chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID);
    const [other] = await chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID);
    const barNode = toFolderNode(bar, []);
    const otherNode = toFolderNode(other, []);
    return {
        id: '0',
        title: 'Bookmarks',
        path: [],
        children: [...barNode.children, ...otherNode.children],
    };
}

export async function listClassifiableBookmarks(): Promise<ClassifiableBookmark[]> {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const results: ClassifiableBookmark[] = [];
    collectBookmarks(root, [], results);
    return results;
}

export function countFolders(node: FolderNode): number {
    return node.children.reduce((total, child) => total + 1 + countFolders(child), 0);
}

export function findFolder(node: FolderNode, id: string): FolderNode | null {
    if (node.id === id) {
        return node;
    }
    for (const child of node.children) {
        const match = findFolder(child, id);
        if (match) {
            return match;
        }
    }
    return null;
}

function toFolderNode(node: chrome.bookmarks.BookmarkTreeNode, parentPath: string[]): FolderNode {
    const path = node.id === BOOKMARKS_BAR_ID || node.id === '0'
        ? parentPath
        : [...parentPath, node.title];
    const children = (node.children ?? [])
        .filter((child) => !child.url)
        .map((child) => toFolderNode(child, path));
    return {
        id: node.id,
        title: node.title,
        path,
        children,
    };
}

function collectBookmarks(
    node: chrome.bookmarks.BookmarkTreeNode,
    parentPath: string[],
    results: ClassifiableBookmark[],
): void {
    const path = appendPath(node, parentPath);
    if (node.url && isHttpUrl(node.url) && node.id) {
        results.push({
            id: node.id,
            title: node.title || node.url,
            url: node.url,
            parentId: node.parentId || BOOKMARKS_BAR_ID,
            currentPath: parentPath,
        });
    }

    for (const child of node.children ?? []) {
        collectBookmarks(child, path, results);
    }
}

function appendPath(node: chrome.bookmarks.BookmarkTreeNode, parentPath: string[]): string[] {
    if (!node.title || node.id === '0' || node.id === BOOKMARKS_BAR_ID || node.id === OTHER_BOOKMARKS_ID) {
        return parentPath;
    }
    if (node.url) {
        return parentPath;
    }
    return [...parentPath, node.title];
}

function isHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}
