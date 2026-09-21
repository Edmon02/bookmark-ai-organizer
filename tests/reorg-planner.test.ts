import {
    buildChoiceCriteria,
    decideSuggestion,
    decideFolderForBookmark,
    planLibraryReorganization,
} from '../src/utils/reorg-planner';
import { HIGH_CONFIDENCE, KEEP_THRESHOLD, LEAVE_OPTION, MAX_CHOICE_OPTIONS } from '../src/utils/folder-catalog';
import type { ClassifiableBookmark, FolderNode } from '../src/utils/bookmark-tree';
import type { SystemOneResult } from '../src/utils/typesafe-client';

function folder(id: string, title: string, path: string[], children: FolderNode[] = []): FolderNode {
    return { id, title, path, children };
}

const tree: FolderNode = folder('1', 'Bookmarks Bar', [], [
    folder('10', '💻 Technology', ['💻 Technology'], [
        folder('11', '🛠️ Tools', ['💻 Technology', '🛠️ Tools']),
    ]),
    folder('20', '📰 News', ['📰 News']),
]);

const bookmark: ClassifiableBookmark = {
    id: '100',
    title: 'Python Repository',
    url: 'https://github.com/python',
    parentId: '20',
    currentPath: ['📰 News'],
};

function choiceResult(choice: string, confidence: number, extras: Record<string, SystemOneResult['answers'][string]> = {}): SystemOneResult {
    return {
        model: 'jev-1.13.0',
        answers: {
            folder: {
                type: 'choice',
                choice,
                confidence,
                probabilities: { [choice]: 1 },
            },
            ...extras,
        },
    };
}

describe('reorg planner', () => {
    test('caps choice options at 255 including leave', () => {
        const children = Array.from({ length: 400 }, (_, index) =>
            folder(String(index), `Folder ${index}`, [`Folder ${index}`]),
        );
        const criteria = buildChoiceCriteria(children, true, []);
        expect(Object.keys(criteria)).toHaveLength(MAX_CHOICE_OPTIONS);
        expect(criteria[LEAVE_OPTION]).toBeDefined();
    });

    test('keeps a bookmark when keep probability is high', () => {
        const suggestion = decideSuggestion(bookmark, {
            folderPath: ['💻 Technology'],
            tags: ['technology'],
            confidence: 0.9,
            keepProbability: KEEP_THRESHOLD + 0.2,
            choiceId: 'f_10',
            kept: false,
        });
        expect(suggestion.decision).toBe('keep');
        expect(suggestion.toPath).toEqual(['📰 News']);
    });

    test('sends a weaker folder choice to review instead of dropping it', () => {
        const suggestion = decideSuggestion(bookmark, {
            folderPath: ['💻 Technology'],
            tags: ['technology'],
            confidence: 0.2,
            keepProbability: 0.1,
            choiceId: 'f_10',
            kept: false,
        });
        expect(suggestion.decision).toBe('review');
        expect(suggestion.toPath).toEqual(['💻 Technology']);
    });

    test('marks high-confidence folder changes as apply', () => {
        const suggestion = decideSuggestion(bookmark, {
            folderPath: ['💻 Technology'],
            tags: ['technology'],
            confidence: HIGH_CONFIDENCE,
            keepProbability: 0.1,
            choiceId: 'f_10',
            kept: false,
        });
        expect(suggestion.decision).toBe('apply');
        expect(suggestion.toPath).toEqual(['💻 Technology']);
    });

    test('walks into a child folder only after the first choice', async () => {
        const calls: unknown[] = [];
        const evaluate = jest.fn(async (_apiKey: string, request: { questions: Record<string, unknown> }) => {
            calls.push(Object.keys(request.questions));
            if (calls.length === 1) {
                return choiceResult('f_10', 0.9, {
                    keep: { type: 'noul', noul: 0.1 },
                });
            }
            return choiceResult('f_11', 0.88);
        });

        const decision = await decideFolderForBookmark(bookmark, tree, 'apikey_test', evaluate);
        expect(decision.folderPath).toEqual(['💻 Technology', '🛠️ Tools']);
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(calls[0]).toEqual(expect.arrayContaining(['keep', 'folder']));
        expect(calls[1]).toEqual(['folder']);
    });

    test('planLibraryReorganization builds undo-friendly parent ids', async () => {
        const evaluate = jest.fn(async () => choiceResult('f_10', 0.92, {
            keep: { type: 'noul', noul: 0.05 },
        }));

        const suggestions = await planLibraryReorganization([bookmark], tree, 'apikey_test', { evaluate, concurrency: 1 });
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].fromParentId).toBe('20');
        expect(suggestions[0].decision).toBe('apply');
    });
});
