// SPDX-License-Identifier: Apache-2.0
import { BookmarkManager } from '../utils/bookmark-manager';
import type { BookmarkCreationResult, BookmarkMoveResult } from '../utils/bookmark-manager';
import { applyProposedAction, chat, type ChatMessage, type ProposedAction } from '../utils/bookmark-assistant';
import { findMatchingBookmarks } from '../utils/bookmark-search';
import { setTags } from '../utils/bookmark-tags';
import { getClassificationRoot, listClassifiableBookmarks } from '../utils/bookmark-tree';
import { LlmClassifier } from '../utils/llm-classifier';
import type { ClassificationResultWithMeta } from '../utils/llm-classifier';
import {
    fetchOpenRouterModels,
    getProviderPreference,
    getSelectedOpenRouterModel,
} from '../utils/openrouter';
import { isProviderId, type ProviderId } from '../utils/providers';
import {
    emptyReorgJob,
    isReorgCancelled,
    readReorgJob,
    readUndoLog,
    setReorgCancelled,
    writeReorgJob,
    writeUndoLog,
    type ReorgUndoEntry,
} from '../utils/reorg-job';
import { planLibraryReorganization, type ReorgSuggestion } from '../utils/reorg-planner';
import { SecurityManager } from '../utils/security';

type RuntimeRequest = {
    action: string;
    data?: unknown;
};

type RuntimeSuccess<T> = { success: true; result: T };
type RuntimeFailure = { success: false; error: string };
type RuntimeResponse<T> = RuntimeSuccess<T> | RuntimeFailure;

type SettingsState = {
    hasApiKey: boolean;
    apiKeyHint: string | null;
    keyedProviders: Array<{ providerId: ProviderId; hint: string }>;
    providerPreference: string | null;
    selectedOpenRouterModel: string | null;
    autoClassifyEnabled: boolean;
};

type ClassifyAndSavePayload = {
    url: string;
    title: string;
};

type ReclassifyPayload = {
    bookmarkId: string;
    modelOverride?: string;
};

type ClassifyResultPayload = {
    bookmark: chrome.bookmarks.BookmarkTreeNode;
    folderPath: string[];
    previousFolderPath?: string[];
    folderId: string;
    title: string;
    url: string;
    tags: string[];
    confidence: number;
    provider: string;
    providerId: string;
    model: string;
    action: 'created' | 'moved';
};

const AUTO_CLASSIFY_KEY = 'auto_classify_enabled';
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_TITLE_LENGTH = 300;
const MAX_MODEL_LENGTH = 150;

class BackgroundService {
    private readonly bookmarkManager = new BookmarkManager();
    private readonly classifier = new LlmClassifier();
    private readonly pendingInternalBookmarkFingerprints = new Set<string>();
    private reorgRunning = false;
    private reorgCancelRequested = false;

    constructor() {
        this.initializeListeners();
    }

    private initializeListeners(): void {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            void this.routeMessage(request, sender).then(sendResponse);
            return true;
        });

        chrome.runtime.onConnect?.addListener((port) => {
            if (port.name !== 'reorg') {
                return;
            }
            // An open port keeps the service worker alive during a long scan.
        });

        chrome.runtime.onInstalled.addListener(() => {
            void this.ensureDefaultSettings();
        });

        chrome.bookmarks.onCreated.addListener((bookmarkId, bookmark) => {
            void this.handleAutoClassifyBookmark(bookmarkId, bookmark);
        });

        globalThis.addEventListener('unhandledrejection', () => {
            // Keep service worker alive and avoid silent failures.
        });
    }

    private async routeMessage(
        request: unknown,
        sender: chrome.runtime.MessageSender,
    ): Promise<RuntimeResponse<unknown>> {
        try {
            if (!this.isRuntimeRequest(request)) {
                return this.failure('Invalid request payload.');
            }
            if (sender.id && sender.id !== chrome.runtime.id) {
                return this.failure('Unauthorized request sender.');
            }

            switch (request.action) {
                case 'SAVE_API_KEY':
                    return this.success(await this.handleSaveApiKey(request.data));
                case 'CLEAR_API_KEY':
                    return this.success(await this.handleClearApiKey(request.data));
                case 'GET_SETTINGS_STATE':
                    return this.success(await this.getSettingsState());
                case 'GET_OPENROUTER_MODELS':
                    return this.success(await this.handleGetOpenRouterModels(request.data));
                case 'CLASSIFY_AND_SAVE':
                    return this.success(await this.handleClassifyAndSave(request.data));
                case 'CLASSIFY_ONLY':
                    return this.success(await this.handleClassifyOnly(request.data));
                case 'RECLASSIFY_BOOKMARK':
                    return this.success(await this.handleReclassifyBookmark(request.data));
                case 'SET_AUTO_CLASSIFY':
                    return this.success(await this.handleSetAutoClassify(request.data));
                case 'START_REORG_SCAN':
                    return this.success(await this.handleStartReorgScan());
                case 'GET_REORG_STATUS':
                    return this.success(await readReorgJob());
                case 'CANCEL_REORG':
                    return this.success(await this.handleCancelReorg());
                case 'APPLY_REORG':
                    return this.success(await this.handleApplyReorg(request.data));
                case 'UNDO_REORG':
                    return this.success(await this.handleUndoReorg());
                case 'FIND_BOOKMARK':
                    return this.success(await this.handleFindBookmark(request.data));
                case 'SEARCH_BOOKMARKS':
                    return this.success(await this.handleSearchBookmarks(request.data));
                case 'CHAT_MESSAGE':
                    return this.success(await this.handleChatMessage(request.data));
                case 'APPLY_BOOKMARK_ACTION':
                    return this.success(await this.handleApplyBookmarkAction(request.data));
                default:
                    return this.failure('Unknown action.');
            }
        } catch (error: unknown) {
            return this.failure(this.errorMessage(error));
        }
    }

    private async handleSaveApiKey(data: unknown): Promise<SettingsState> {
        const payload = this.ensureObject(data);
        const apiKey = this.ensureString(payload.apiKey, 'API key');
        const providerId = payload.providerId === undefined || payload.providerId === ''
            ? undefined
            : this.ensureProviderId(payload.providerId);
        await SecurityManager.storeApiKey(apiKey, providerId);
        return this.getSettingsState();
    }

    private async handleClearApiKey(data: unknown): Promise<SettingsState> {
        const payload = this.ensureObject(data ?? {});
        const providerId = payload.providerId === undefined || payload.providerId === ''
            ? undefined
            : this.ensureProviderId(payload.providerId);
        await SecurityManager.clearApiKey(providerId);
        return this.getSettingsState();
    }

    private async handleGetOpenRouterModels(data: unknown): Promise<{ models: { id: string; name?: string }[] }> {
        const payload = this.ensureObject(data ?? {});
        const forceRefresh = payload.forceRefresh === true;
        const apiKey = await SecurityManager.getApiKeyForProvider('openrouter');
        if (!apiKey) {
            throw new Error('Save an OpenRouter API key before loading models.');
        }

        const models = await fetchOpenRouterModels(apiKey, forceRefresh);
        return {
            models: models.map((model) => ({ id: model.id, name: model.name })),
        };
    }

    private async handleClassifyAndSave(data: unknown): Promise<ClassifyResultPayload> {
        const payload = this.normalizeClassifyPayload(data);
        const classification = await this.classify(payload.url, payload.title, undefined);

        const fingerprint = this.fingerprint(payload.url, payload.title);
        this.pendingInternalBookmarkFingerprints.add(fingerprint);

        let created: BookmarkCreationResult;
        try {
            created = await this.bookmarkManager.createBookmark(
                payload.url,
                payload.title,
                classification.folderPath,
            );
        } finally {
            setTimeout(() => {
                this.pendingInternalBookmarkFingerprints.delete(fingerprint);
            }, 5000);
        }

        if (classification.tags.length && created.bookmark.id) {
            await setTags(created.bookmark.id, classification.tags);
        }

        return this.buildCreatePayload(created, classification, payload.url);
    }

    private async handleFindBookmark(data: unknown): Promise<{ found: { bookmark: chrome.bookmarks.BookmarkTreeNode; path: string[] } | null }> {
        const payload = this.ensureObject(data);
        const url = this.ensureUrl(payload.url);
        return { found: await this.bookmarkManager.findByUrl(url) };
    }

    private async handleSearchBookmarks(data: unknown): Promise<{ matches: unknown[] }> {
        const payload = this.ensureObject(data);
        const description = this.ensureString(payload.description, 'Description').trim();
        if (!description) {
            throw new Error('Description is required.');
        }
        const matches = await findMatchingBookmarks(description.slice(0, 1000));
        return { matches };
    }

    private async handleChatMessage(data: unknown) {
        const payload = this.ensureObject(data);
        if (!Array.isArray(payload.history)) {
            throw new Error('Chat history must be a list.');
        }
        const history: ChatMessage[] = payload.history.flatMap((item) => {
            if (!item || typeof item !== 'object') {
                return [];
            }
            const message = item as { role?: unknown; content?: unknown };
            if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
                return [];
            }
            return [{ role: message.role, content: message.content.slice(0, 4000) }];
        });
        return chat(history);
    }

    private async handleApplyBookmarkAction(data: unknown): Promise<{ result: unknown }> {
        const payload = this.ensureObject(data);
        const action = payload.action as ProposedAction;
        if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
            throw new Error('Bookmark action is invalid.');
        }
        return { result: await applyProposedAction(action) };
    }

    private async handleClassifyOnly(data: unknown): Promise<Omit<ClassifyResultPayload, 'bookmark' | 'folderId' | 'action'>> {
        const payload = this.normalizeClassifyPayload(data);
        const classification = await this.classify(payload.url, payload.title, undefined);
        return {
            folderPath: classification.folderPath,
            title: payload.title,
            url: payload.url,
            tags: classification.tags,
            confidence: classification.confidence,
            provider: classification.providerName,
            providerId: classification.providerId,
            model: classification.model,
        };
    }

    private async handleReclassifyBookmark(data: unknown): Promise<ClassifyResultPayload> {
        const payload = this.ensureObject(data);
        const bookmarkId = this.ensureString(payload.bookmarkId, 'Bookmark ID');
        const modelOverride = payload.modelOverride === undefined
            ? undefined
            : this.ensureModel(payload.modelOverride);

        const [bookmark] = await chrome.bookmarks.get(bookmarkId);
        if (!bookmark || !bookmark.url) {
            throw new Error('Bookmark is missing or cannot be classified.');
        }

        const title = bookmark.title || bookmark.url;
        const classification = await this.classify(
            bookmark.url,
            title,
            modelOverride,
        );
        const moved = await this.bookmarkManager.moveBookmarkToFolderPath(
            bookmark.id,
            classification.folderPath,
        );

        return this.buildMovePayload(moved, classification, bookmark.url);
    }

    private async handleSetAutoClassify(data: unknown): Promise<{ autoClassifyEnabled: boolean }> {
        const payload = this.ensureObject(data);
        const enabled = payload.enabled === true;
        await chrome.storage.local.set({ [AUTO_CLASSIFY_KEY]: enabled });
        return { autoClassifyEnabled: enabled };
    }

    private async handleStartReorgScan(): Promise<{ status: string }> {
        if (this.reorgRunning) {
            return { status: 'scanning' };
        }

        const apiKey = await SecurityManager.getApiKeyForProvider('typesafe');
        if (!apiKey) {
            throw new Error('Save a TypeSafe (Jev) API key before reorganizing bookmarks.');
        }

        this.reorgRunning = true;
        this.reorgCancelRequested = false;
        await setReorgCancelled(false);
        await writeReorgJob({
            ...emptyReorgJob('scanning'),
            suggestions: [],
        });
        void this.runReorgScan(apiKey).finally(() => {
            this.reorgRunning = false;
        });
        return { status: 'scanning' };
    }

    private async runReorgScan(apiKey: string): Promise<void> {
        try {
            const [bookmarks, tree] = await Promise.all([
                listClassifiableBookmarks(),
                getClassificationRoot(),
            ]);
            await writeReorgJob({
                status: 'scanning',
                total: bookmarks.length,
                processed: 0,
                suggestions: [],
                updatedAt: Date.now(),
            });

            if (!bookmarks.length) {
                await writeReorgJob({
                    status: 'review',
                    total: 0,
                    processed: 0,
                    suggestions: [],
                    updatedAt: Date.now(),
                });
                return;
            }

            const suggestions = await planLibraryReorganization(bookmarks, tree, apiKey, {
                concurrency: 3,
                shouldCancel: () => this.reorgCancelRequested,
                onProgress: async (processed, total) => {
                    await writeReorgJob({
                        status: 'scanning',
                        total,
                        processed,
                        suggestions: [],
                        updatedAt: Date.now(),
                    });
                },
            });

            if (await isReorgCancelled()) {
                await writeReorgJob({
                    status: 'cancelled',
                    total: bookmarks.length,
                    processed: suggestions.length,
                    suggestions,
                    updatedAt: Date.now(),
                });
                return;
            }

            await writeReorgJob({
                status: 'review',
                total: bookmarks.length,
                processed: bookmarks.length,
                suggestions,
                updatedAt: Date.now(),
            });
        } catch (error: unknown) {
            await writeReorgJob({
                ...emptyReorgJob('error'),
                error: this.errorMessage(error),
            });
        }
    }

    private async handleCancelReorg(): Promise<{ status: string }> {
        this.reorgCancelRequested = true;
        await setReorgCancelled(true);
        const job = await readReorgJob();
        if (job.status === 'scanning') {
            await writeReorgJob({
                ...job,
                status: 'cancelled',
            });
        }
        return { status: 'cancelled' };
    }

    private async handleApplyReorg(data: unknown): Promise<{ appliedCount: number; skipped: number }> {
        const payload = this.ensureObject(data ?? {});
        const selectedIds = Array.isArray(payload.bookmarkIds)
            ? payload.bookmarkIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
            : null;

        const job = await readReorgJob();
        const approved = job.suggestions.filter((suggestion) => {
            if (selectedIds) {
                return selectedIds.includes(suggestion.bookmarkId);
            }
            return suggestion.decision === 'apply';
        });

        if (!approved.length) {
            throw new Error('Select at least one suggested move to apply.');
        }

        await writeReorgJob({ ...job, status: 'applying' });
        const undo: ReorgUndoEntry[] = [];
        let appliedCount = 0;

        for (const suggestion of approved) {
            if (!suggestion.toPath.length) {
                continue;
            }
            const moved = await this.bookmarkManager.moveBookmarkToFolderPath(
                suggestion.bookmarkId,
                suggestion.toPath,
            );
            undo.push({
                bookmarkId: suggestion.bookmarkId,
                previousParentId: suggestion.fromParentId,
            });
            appliedCount += 1;
            void moved;
        }

        await writeUndoLog(undo);
        await writeReorgJob({
            ...job,
            status: 'done',
            appliedCount,
        });

        return {
            appliedCount,
            skipped: job.suggestions.length - appliedCount,
        };
    }

    private async handleUndoReorg(): Promise<{ restoredCount: number }> {
        const undo = await readUndoLog();
        if (!undo.length) {
            throw new Error('There is nothing to undo yet.');
        }

        let restoredCount = 0;
        for (const entry of undo) {
            await this.bookmarkManager.moveBookmarkToParent(entry.bookmarkId, entry.previousParentId);
            restoredCount += 1;
        }
        await writeUndoLog([]);
        const job = await readReorgJob();
        await writeReorgJob({
            ...job,
            status: 'review',
            appliedCount: 0,
        });
        return { restoredCount };
    }

    private async getSettingsState(): Promise<SettingsState> {
        const [hasApiKey, apiKeyHint, keyedProviders, providerPreference, selectedOpenRouterModel, autoClassifyEnabled] = await Promise.all([
            SecurityManager.hasApiKey(),
            SecurityManager.getApiKeyHint(),
            SecurityManager.listStoredKeys(),
            getProviderPreference(),
            getSelectedOpenRouterModel(),
            this.getAutoClassifyEnabled(),
        ]);

        return {
            hasApiKey,
            apiKeyHint,
            keyedProviders,
            providerPreference,
            selectedOpenRouterModel,
            autoClassifyEnabled,
        };
    }

    private async classify(
        url: string,
        title: string,
        modelOverride?: string,
    ): Promise<ClassificationResultWithMeta> {
        const options = modelOverride
            ? { providerOverride: 'openrouter', modelOverride }
            : {};
        return this.classifier.classifyUrlWithMeta(url, title, options);
    }

    private async handleAutoClassifyBookmark(
        _bookmarkId: string,
        bookmark: chrome.bookmarks.BookmarkTreeNode,
    ): Promise<void> {
        if (!bookmark.url || !bookmark.id) {
            return;
        }

        if (!this.isSupportedUrl(bookmark.url)) {
            return;
        }

        if (!await this.getAutoClassifyEnabled()) {
            return;
        }

        if (!await SecurityManager.hasApiKey()) {
            return;
        }

        const fingerprint = this.fingerprint(bookmark.url, bookmark.title || bookmark.url);
        if (this.pendingInternalBookmarkFingerprints.has(fingerprint)) {
            return;
        }

        try {
            const classification = await this.classify(bookmark.url, bookmark.title || bookmark.url, undefined);
            await this.bookmarkManager.moveBookmarkToFolderPath(bookmark.id, classification.folderPath);
        } catch {
            // Auto-classify is best-effort.
        }
    }

    private buildCreatePayload(
        created: BookmarkCreationResult,
        classification: ClassificationResultWithMeta,
        url: string,
    ): ClassifyResultPayload {
        return {
            bookmark: created.bookmark,
            folderPath: created.folderPath,
            folderId: created.folderId,
            title: created.bookmark.title || classification.folderPath.join(' / '),
            url,
            tags: classification.tags,
            confidence: classification.confidence,
            provider: classification.providerName,
            providerId: classification.providerId,
            model: classification.model,
            action: 'created',
        };
    }

    private buildMovePayload(
        moved: BookmarkMoveResult,
        classification: ClassificationResultWithMeta,
        url: string,
    ): ClassifyResultPayload {
        return {
            bookmark: moved.bookmark,
            folderPath: moved.folderPath,
            previousFolderPath: moved.previousFolderPath,
            folderId: moved.folderId,
            title: moved.bookmark.title || classification.folderPath.join(' / '),
            url,
            tags: classification.tags,
            confidence: classification.confidence,
            provider: classification.providerName,
            providerId: classification.providerId,
            model: classification.model,
            action: 'moved',
        };
    }

    private normalizeClassifyPayload(data: unknown): ClassifyAndSavePayload {
        const payload = this.ensureObject(data);
        return {
            url: this.ensureUrl(payload.url),
            title: this.ensureTitle(payload.title),
        };
    }

    private ensureUrl(value: unknown): string {
        const url = this.ensureString(value, 'URL');
        if (!this.isSupportedUrl(url)) {
            throw new Error('Only http(s) URLs can be classified.');
        }
        return url;
    }

    private ensureTitle(value: unknown): string {
        const title = this.ensureString(value, 'Title').trim();
        if (!title) {
            throw new Error('Title is required.');
        }
        return title.slice(0, MAX_TITLE_LENGTH);
    }

    private ensureModel(value: unknown): string {
        const model = this.ensureString(value, 'Model override').trim();
        if (!model || model.length > MAX_MODEL_LENGTH) {
            throw new Error('Model override is invalid.');
        }
        return model;
    }

    private ensureProviderId(value: unknown): ProviderId {
        const providerId = this.ensureString(value, 'Provider');
        if (!isProviderId(providerId)) {
            throw new Error('Provider is invalid.');
        }
        return providerId;
    }

    private ensureString(value: unknown, label: string): string {
        if (typeof value !== 'string') {
            throw new Error(`${label} must be a string.`);
        }
        return value;
    }

    private ensureObject(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Request payload must be an object.');
        }
        return value as Record<string, unknown>;
    }

    private isRuntimeRequest(value: unknown): value is RuntimeRequest {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }
        const candidate = value as RuntimeRequest;
        return typeof candidate.action === 'string' && candidate.action.length > 0;
    }

    private async getAutoClassifyEnabled(): Promise<boolean> {
        const state = await chrome.storage.local.get(AUTO_CLASSIFY_KEY);
        return state[AUTO_CLASSIFY_KEY] === true;
    }

    private async ensureDefaultSettings(): Promise<void> {
        const existing = await chrome.storage.local.get(AUTO_CLASSIFY_KEY);
        if (typeof existing[AUTO_CLASSIFY_KEY] !== 'boolean') {
            await chrome.storage.local.set({ [AUTO_CLASSIFY_KEY]: false });
        }
    }

    private isSupportedUrl(value: string): boolean {
        try {
            const parsed = new URL(value);
            return SUPPORTED_PROTOCOLS.has(parsed.protocol);
        } catch {
            return false;
        }
    }

    private fingerprint(url: string, title: string): string {
        return `${url}::${title}`;
    }

    private success<T>(result: T): RuntimeSuccess<T> {
        return { success: true, result };
    }

    private failure(error: string): RuntimeFailure {
        return { success: false, error };
    }

    private errorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return 'Unknown error occurred.';
    }
}

new BackgroundService();
