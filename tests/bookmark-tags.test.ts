// SPDX-License-Identifier: Apache-2.0
import { getTags, setTags, getAllTags, removeTags } from '../src/utils/bookmark-tags';

describe('bookmark-tags', () => {
    beforeEach(() => {
        chrome.storage.local.get = jest.fn().mockResolvedValue({});
        chrome.storage.local.set = jest.fn().mockResolvedValue(undefined);
    });

    test('getTags returns empty array when nothing stored', async () => {
        const tags = await getTags('1');
        expect(tags).toEqual([]);
    });

    test('setTags stores tags under the bookmark id', async () => {
        await setTags('1', ['coding', 'github']);
        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            bookmark_tags_v1: { '1': ['coding', 'github'] }
        });
    });

    test('getAllTags returns the full map', async () => {
        chrome.storage.local.get = jest.fn().mockResolvedValue({ bookmark_tags_v1: { '1': ['a'], '2': ['b'] } });
        const all = await getAllTags();
        expect(all).toEqual({ '1': ['a'], '2': ['b'] });
    });

    test('removeTags deletes the entry for the bookmark id', async () => {
        chrome.storage.local.get = jest.fn().mockResolvedValue({ bookmark_tags_v1: { '1': ['a'], '2': ['b'] } });
        await removeTags('1');
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ bookmark_tags_v1: { '2': ['b'] } });
    });
});
