// SPDX-License-Identifier: Apache-2.0
// Persists AI-generated tags per bookmark id (local only, not synced) to power search/chat relevance.
const STORAGE_KEY = 'bookmark_tags_v1';

type TagMap = Record<string, string[]>;

async function readAll(): Promise<TagMap> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || {};
}

export async function getTags(bookmarkId: string): Promise<string[]> {
    const all = await readAll();
    return all[bookmarkId] || [];
}

export async function setTags(bookmarkId: string, tags: string[]): Promise<void> {
    const all = await readAll();
    all[bookmarkId] = tags;
    await chrome.storage.local.set({ [STORAGE_KEY]: all });
}

export async function getAllTags(): Promise<TagMap> {
    return readAll();
}

export async function removeTags(bookmarkId: string): Promise<void> {
    const all = await readAll();
    delete all[bookmarkId];
    await chrome.storage.local.set({ [STORAGE_KEY]: all });
}
