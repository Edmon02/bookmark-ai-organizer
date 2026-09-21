// SPDX-License-Identifier: Apache-2.0
import { getClassificationRoot } from './bookmark-tree';
import type { ClassificationResultWithMeta } from './classification-types';
import { decideFolderForBookmark } from './reorg-planner';
import { TYPESAFE_MODEL } from './typesafe-client';

export async function classifyWithJev(
    apiKey: string,
    url: string,
    title: string,
    currentPath: string[] = [],
): Promise<ClassificationResultWithMeta> {
    const tree = await getClassificationRoot();
    const decision = await decideFolderForBookmark(
        { title, url, currentPath },
        tree,
        apiKey,
    );
    const folderPath = decision.folderPath.length ? decision.folderPath : ['💻 Technology'];

    return {
        folderPath,
        tags: decision.tags.length ? decision.tags : ['bookmark'],
        confidence: decision.confidence,
        providerId: 'typesafe',
        providerName: 'TypeSafe (Jev)',
        model: TYPESAFE_MODEL,
    };
}
