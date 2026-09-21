// SPDX-License-Identifier: Apache-2.0
import {
    findFolder,
    type ClassifiableBookmark,
    type FolderNode,
} from './bookmark-tree';
import {
    FALLBACK_FOLDER_CATALOG,
    HIGH_CONFIDENCE,
    KEEP_THRESHOLD,
    LEAVE_OPTION,
    MAX_CHOICE_OPTIONS,
    MAX_FOLDER_DEPTH,
    REVIEW_CONFIDENCE,
    catalogById,
    folderOptionId,
    isCatalogOption,
    parseFolderOptionId,
    tagsFromFolderPath,
} from './folder-catalog';
import {
    asChoice,
    asNoul,
    evaluateSystemOne,
    type ChoiceQuestion,
    type JsonValue,
    type NoulQuestion,
    type TypeSafeQuestion,
} from './typesafe-client';

export type ReorgDecision = 'apply' | 'review' | 'keep';

export interface FolderDecision {
    folderPath: string[];
    tags: string[];
    confidence: number;
    keepProbability: number;
    choiceId: string;
    kept: boolean;
}

export interface ReorgSuggestion {
    bookmarkId: string;
    title: string;
    url: string;
    fromPath: string[];
    toPath: string[];
    fromParentId: string;
    confidence: number;
    keepProbability: number;
    decision: ReorgDecision;
    reason: string;
}

export type SystemOneEvaluate = typeof evaluateSystemOne;

export function buildChoiceCriteria(
    children: FolderNode[],
    includeCatalog: boolean,
    currentPath: string[],
): Record<string, string> {
    const criteria: Record<string, string> = {
        [LEAVE_OPTION]: currentPath.length
            ? `Keep this bookmark in its current folder: ${currentPath.join(' > ')}.`
            : 'Leave this bookmark at the Bookmarks Bar root. Use only when no folder is a better home.',
    };

    const usedTitles = new Set(children.map((child) => normalizeTitle(child.title)));
    for (const child of children) {
        if (Object.keys(criteria).length >= MAX_CHOICE_OPTIONS) {
            break;
        }
        const pathLabel = child.path.length ? child.path.join(' > ') : child.title;
        criteria[folderOptionId(child.id)] = `Existing folder "${child.title}" at ${pathLabel}.`;
    }

    if (includeCatalog) {
        for (const folder of FALLBACK_FOLDER_CATALOG) {
            if (Object.keys(criteria).length >= MAX_CHOICE_OPTIONS) {
                break;
            }
            if (usedTitles.has(normalizeTitle(folder.title))) {
                continue;
            }
            criteria[folder.id] = `Create folder ${folder.title}. ${folder.description}`;
        }
    }

    return criteria;
}

export function decideSuggestion(
    bookmark: ClassifiableBookmark,
    decision: FolderDecision,
): ReorgSuggestion {
    const samePath = pathsEqual(bookmark.currentPath, decision.folderPath);
    if (decision.kept || samePath || decision.choiceId === LEAVE_OPTION) {
        return {
            ...baseSuggestion(bookmark, decision),
            decision: 'keep',
            reason: decision.kept
                ? 'Current folder already looks right.'
                : 'Jev chose to leave this bookmark where it is.',
        };
    }

    if (decision.keepProbability > KEEP_THRESHOLD && bookmark.currentPath.length) {
        return {
            ...baseSuggestion(bookmark, {
                ...decision,
                folderPath: bookmark.currentPath,
            }),
            toPath: bookmark.currentPath,
            decision: 'keep',
            reason: 'Current folder already looks right.',
        };
    }

    if (decision.confidence >= HIGH_CONFIDENCE) {
        return {
            ...baseSuggestion(bookmark, decision),
            decision: 'apply',
            reason: 'High-confidence folder match.',
        };
    }

    if (decision.folderPath.length && !samePath) {
        return {
            ...baseSuggestion(bookmark, decision),
            decision: 'review',
            reason: decision.confidence >= REVIEW_CONFIDENCE
                ? 'Plausible match — review before moving.'
                : 'Jev picked a folder, but the choice is not concentrated. Review it before moving.',
        };
    }

    return {
        ...baseSuggestion(bookmark, {
            ...decision,
            folderPath: bookmark.currentPath,
        }),
        toPath: bookmark.currentPath,
        decision: 'keep',
        reason: 'No better folder was chosen.',
    };
}

export async function decideFolderForBookmark(
    bookmark: Pick<ClassifiableBookmark, 'title' | 'url' | 'currentPath'>,
    tree: FolderNode,
    apiKey: string,
    evaluate: SystemOneEvaluate = evaluateSystemOne,
): Promise<FolderDecision> {
    const includeCatalog = true;
    let node = tree;
    let folderPath: string[] = [];
    let choiceId = LEAVE_OPTION;
    let confidence = 0;
    let keepProbability = 0;

    for (let depth = 0; depth < MAX_FOLDER_DEPTH; depth += 1) {
        const criteria = buildChoiceCriteria(node.children, includeCatalog && depth === 0, folderPath.length ? folderPath : bookmark.currentPath);
        if (Object.keys(criteria).length <= 1) {
            break;
        }

        const questions: Record<string, TypeSafeQuestion> = {
            folder: choiceQuestion(criteria, folderPath),
        };
        if (depth === 0 && bookmark.currentPath.length) {
            questions.keep = keepQuestion();
        }

        const result = await evaluate(apiKey, {
            state: bookmarkState(bookmark, folderPath),
            questions,
        });

        if (questions.keep) {
            keepProbability = asNoul(result.answers.keep).noul;
            if (keepProbability > KEEP_THRESHOLD) {
                return {
                    folderPath: bookmark.currentPath,
                    tags: tagsFromFolderPath(bookmark.currentPath),
                    confidence: keepProbability,
                    keepProbability,
                    choiceId: LEAVE_OPTION,
                    kept: true,
                };
            }
        }

        const folderAnswer = asChoice(result.answers.folder);
        choiceId = folderAnswer.choice;
        confidence = clamp01(folderAnswer.confidence);

        if (choiceId === LEAVE_OPTION) {
            return {
                folderPath: folderPath.length ? folderPath : bookmark.currentPath,
                tags: tagsFromFolderPath(folderPath.length ? folderPath : bookmark.currentPath),
                confidence,
                keepProbability,
                choiceId,
                kept: folderPath.length === 0,
            };
        }

        const nextPath = resolveChoicePath(choiceId, node, folderPath);
        if (!nextPath) {
            break;
        }
        folderPath = nextPath.path;

        if (nextPath.kind === 'catalog') {
            break;
        }

        const nextNode = findFolder(tree, nextPath.folderId);
        if (!nextNode || !nextNode.children.length) {
            break;
        }
        node = nextNode;
    }

    return {
        folderPath,
        tags: tagsFromFolderPath(folderPath),
        confidence,
        keepProbability,
        choiceId,
        kept: false,
    };
}

export async function planLibraryReorganization(
    bookmarks: ClassifiableBookmark[],
    tree: FolderNode,
    apiKey: string,
    options: {
        evaluate?: SystemOneEvaluate;
        concurrency?: number;
        shouldCancel?: () => boolean;
        onProgress?: (processed: number, total: number, suggestion: ReorgSuggestion) => Promise<void> | void;
    } = {},
): Promise<ReorgSuggestion[]> {
    const evaluate = options.evaluate ?? evaluateSystemOne;
    const concurrency = Math.max(1, options.concurrency ?? 3);
    const suggestions: ReorgSuggestion[] = new Array(bookmarks.length);
    let nextIndex = 0;
    let processed = 0;

    const workers = Array.from({ length: Math.min(concurrency, bookmarks.length) }, async () => {
        while (nextIndex < bookmarks.length) {
            if (options.shouldCancel?.()) {
                return;
            }
            const current = nextIndex;
            nextIndex += 1;
            const bookmark = bookmarks[current];
            const decision = await decideFolderForBookmark(bookmark, tree, apiKey, evaluate);
            const suggestion = decideSuggestion(bookmark, decision);
            suggestions[current] = suggestion;
            processed += 1;
            await options.onProgress?.(processed, bookmarks.length, suggestion);
        }
    });

    await Promise.all(workers);
    return suggestions.filter(Boolean);
}

function choiceQuestion(criteria: Record<string, string>, proposedPath: string[]): ChoiceQuestion {
    return {
        type: 'choice',
        instructions: proposedPath.length
            ? `This bookmark is being placed under ${proposedPath.join(' > ')}. Choose the best child folder, or leave to stop at this folder.`
            : 'Choose the closest folder for this bookmark from its title and URL. Pick leave only when every folder is unrelated.',
        criteria,
    };
}

function keepQuestion(): NoulQuestion {
    return {
        type: 'noul',
        instructions: 'The current folder is already a good home for this bookmark.',
        criteria: {
            true: 'The bookmark already sits in a folder that matches its topic.',
            false: 'A different folder would be a clearer home.',
        },
    };
}

function bookmarkState(
    bookmark: Pick<ClassifiableBookmark, 'title' | 'url' | 'currentPath'>,
    proposedPath: string[],
): JsonValue {
    let host = '';
    try {
        host = new URL(bookmark.url).hostname;
    } catch {
        host = '';
    }

    return {
        title: bookmark.title,
        url: bookmark.url,
        host,
        currentFolder: bookmark.currentPath.length ? bookmark.currentPath.join(' > ') : 'Bookmarks Bar',
        proposedFolder: proposedPath.length ? proposedPath.join(' > ') : '',
    };
}

function resolveChoicePath(
    choiceId: string,
    node: FolderNode,
    currentPath: string[],
): { kind: 'folder' | 'catalog'; path: string[]; folderId: string } | null {
    if (isCatalogOption(choiceId)) {
        const catalog = catalogById(choiceId);
        if (!catalog) {
            return null;
        }
        return { kind: 'catalog', path: [catalog.title], folderId: choiceId };
    }

    const folderId = parseFolderOptionId(choiceId);
    if (!folderId) {
        return null;
    }
    const child = node.children.find((item) => item.id === folderId);
    if (!child) {
        return null;
    }
    return {
        kind: 'folder',
        path: child.path.length ? child.path : [...currentPath, child.title],
        folderId: child.id,
    };
}

function baseSuggestion(bookmark: ClassifiableBookmark, decision: FolderDecision): ReorgSuggestion {
    return {
        bookmarkId: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        fromPath: bookmark.currentPath,
        toPath: decision.folderPath,
        fromParentId: bookmark.parentId,
        confidence: decision.confidence,
        keepProbability: decision.keepProbability,
        decision: 'keep',
        reason: '',
    };
}

function pathsEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((segment, index) => segment === right[index]);
}

function normalizeTitle(title: string): string {
    return title.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}
