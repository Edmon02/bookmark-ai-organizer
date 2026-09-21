// SPDX-License-Identifier: Apache-2.0
import type { ReorgJob } from '../utils/reorg-job';
import type { ReorgSuggestion } from '../utils/reorg-planner';

type RuntimeResponse<T> =
    | { success: true; result: T }
    | { success: false; error: string };

class ReorganizePage {
    private port: chrome.runtime.Port | null = null;
    private pollTimer: number | null = null;
    private job: ReorgJob | null = null;
    private renderedKey = '';

    constructor() {
        this.bind();
        this.port = chrome.runtime.connect({ name: 'reorg' });
        void this.refreshStatus();
        this.startPolling();
    }

    private bind(): void {
        this.el('btn-scan').addEventListener('click', () => void this.startScan());
        this.el('btn-cancel').addEventListener('click', () => void this.cancelScan());
        this.el('btn-apply').addEventListener('click', () => void this.applySelected());
        this.el('btn-undo').addEventListener('click', () => void this.undo());
        this.el('select-high-confidence').addEventListener('change', () => this.renderTable());
        this.el('select-review').addEventListener('change', () => this.renderTable());
        this.el('show-stays').addEventListener('change', () => this.renderTable());
    }

    private startPolling(): void {
        this.pollTimer = window.setInterval(() => {
            void this.refreshStatus();
        }, 700);
    }

    private async startScan(): Promise<void> {
        this.setBusy(true);
        try {
            await this.sendAction('START_REORG_SCAN');
            await this.refreshStatus();
        } catch (error: unknown) {
            this.showError(error);
        } finally {
            this.setBusy(false);
        }
    }

    private async cancelScan(): Promise<void> {
        try {
            await this.sendAction('CANCEL_REORG');
            await this.refreshStatus();
        } catch (error: unknown) {
            this.showError(error);
        }
    }

    private async applySelected(): Promise<void> {
        const ids = this.selectedIds();
        if (!ids.length) {
            this.setStatus('Select bookmarks to move', 'Check high-confidence or review rows first.');
            return;
        }

        this.setBusy(true);
        try {
            const result = await this.sendAction<{ appliedCount: number }>('APPLY_REORG', { bookmarkIds: ids });
            this.el('btn-undo').classList.remove('hidden');
            this.setStatus('Moves applied', `${result.appliedCount} bookmark${result.appliedCount === 1 ? '' : 's'} moved. You can undo until this browser session ends.`);
            await this.refreshStatus();
        } catch (error: unknown) {
            this.showError(error);
        } finally {
            this.setBusy(false);
        }
    }

    private async undo(): Promise<void> {
        this.setBusy(true);
        try {
            const result = await this.sendAction<{ restoredCount: number }>('UNDO_REORG');
            this.setStatus('Undo complete', `Restored ${result.restoredCount} bookmark${result.restoredCount === 1 ? '' : 's'} to their previous folders.`);
            await this.refreshStatus();
        } catch (error: unknown) {
            this.showError(error);
        } finally {
            this.setBusy(false);
        }
    }

    private async refreshStatus(): Promise<void> {
        try {
            this.job = await this.sendAction<ReorgJob>('GET_REORG_STATUS');
            this.renderJob();
        } catch {
            this.setStatus('Reconnecting...', 'Waiting for the extension service worker.');
        }
    }

    private renderJob(): void {
        const job = this.job;
        if (!job) {
            return;
        }

        const scanning = job.status === 'scanning';
        this.el('btn-cancel').classList.toggle('hidden', !scanning);
        this.el('progress-track').classList.toggle('hidden', !scanning);
        this.el('toolbar').classList.toggle('hidden', job.suggestions.length === 0 && job.status !== 'review' && job.status !== 'done');
        this.el('table-wrap').classList.toggle('hidden', job.suggestions.length === 0 && job.status !== 'review' && job.status !== 'done');

        if (job.status === 'scanning') {
            const percent = job.total ? Math.round((job.processed / job.total) * 100) : 0;
            this.el('progress-bar').style.width = `${percent}%`;
            this.setStatus('Scanning bookmarks', `${job.processed} of ${job.total} evaluated.`);
        } else if (job.status === 'error') {
            this.setStatus('Scan failed', job.error || 'Try again.');
        } else if (job.status === 'cancelled') {
            this.setStatus('Scan cancelled', 'Start a new scan when you are ready.');
        } else if (job.status === 'review' || job.status === 'done') {
            const applyCount = job.suggestions.filter((item) => item.decision === 'apply').length;
            const reviewCount = job.suggestions.filter((item) => item.decision === 'review').length;
            this.setStatus(
                job.status === 'done' ? 'Library updated' : 'Review suggested moves',
                `${applyCount} high-confidence move${applyCount === 1 ? '' : 's'}, ${reviewCount} to review.`,
            );
        } else {
            this.setStatus('Ready to scan', 'Jev will keep bookmarks where the current folder already fits.');
        }

        const renderKey = `${job.status}:${job.processed}:${job.suggestions.length}:${job.updatedAt}`;
        if (renderKey !== this.renderedKey) {
            this.renderedKey = renderKey;
            this.renderTable();
        }
    }

    private renderTable(): void {
        const body = this.el('review-body');
        body.textContent = '';
        const includeApply = (this.el('select-high-confidence') as HTMLInputElement).checked;
        const includeReview = (this.el('select-review') as HTMLInputElement).checked;
        const showStays = (this.el('show-stays') as HTMLInputElement).checked;
        const suggestions = (this.job?.suggestions ?? []).filter((suggestion) => {
            if (suggestion.decision === 'keep') {
                return showStays;
            }
            if (suggestion.decision === 'apply') {
                return includeApply;
            }
            return includeReview;
        });

        const empty = this.el('empty-note');
        empty.classList.toggle('hidden', suggestions.length > 0);
        if (!suggestions.length) {
            const stays = (this.job?.suggestions ?? []).filter((item) => item.decision === 'keep').length;
            empty.textContent = stays
                ? `No moves are selected. ${stays} bookmark${stays === 1 ? '' : 's'} stay in place. Turn on “Show bookmarks that stay” to see them.`
                : 'No moves match these filters.';
        }

        suggestions.forEach((suggestion) => {
            body.appendChild(this.moveCard(suggestion, this.shouldPreselect(suggestion, includeApply, includeReview)));
        });
    }

    private moveCard(suggestion: ReorgSuggestion, selected: boolean): HTMLElement {
        const card = document.createElement('article');
        card.className = `move-card decision-${suggestion.decision}`;
        card.dataset.id = suggestion.bookmarkId;

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.dataset.id = suggestion.bookmarkId;
        check.disabled = suggestion.decision === 'keep';
        check.checked = selected && suggestion.decision !== 'keep';
        check.setAttribute('aria-label', `Select ${suggestion.title}`);

        const main = document.createElement('div');
        main.className = 'move-main';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = suggestion.title;

        const url = document.createElement('div');
        url.className = 'url';
        url.textContent = suggestion.url;
        url.title = suggestion.url;

        const route = document.createElement('div');
        route.className = 'route';
        const from = document.createElement('span');
        from.className = 'path';
        from.textContent = this.formatPath(suggestion.fromPath);
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = '→';
        const to = document.createElement('span');
        to.className = 'path path-to';
        to.textContent = suggestion.decision === 'keep'
            ? 'Stays here'
            : this.formatPath(suggestion.toPath);
        route.append(from, arrow, to);

        const reason = document.createElement('div');
        reason.className = 'url';
        reason.textContent = suggestion.reason;
        main.append(title, url, route, reason);

        const meta = document.createElement('div');
        meta.className = 'move-meta';
        const confidence = document.createElement('div');
        confidence.className = 'confidence';
        confidence.textContent = `${Math.round(suggestion.confidence * 100)}%`;
        const label = document.createElement('div');
        label.className = `decision decision-${suggestion.decision}`;
        label.textContent = suggestion.decision === 'apply'
            ? 'Move'
            : suggestion.decision === 'review'
                ? 'Review'
                : 'Stay';
        meta.append(confidence, label);

        card.append(check, main, meta);
        return card;
    }

    private shouldPreselect(suggestion: ReorgSuggestion, includeApply: boolean, includeReview: boolean): boolean {
        if (suggestion.decision === 'apply') {
            return includeApply;
        }
        if (suggestion.decision === 'review') {
            return includeReview;
        }
        return false;
    }

    private selectedIds(): string[] {
        return Array.from(document.querySelectorAll<HTMLInputElement>('#review-body input[type="checkbox"]'))
            .filter((input) => input.checked && input.dataset.id)
            .map((input) => input.dataset.id as string);
    }

    private formatPath(path: string[]): string {
        return path.length ? path.join(' > ') : 'Bookmarks Bar';
    }

    private setStatus(title: string, meta: string): void {
        this.el('status-title').textContent = title;
        this.el('status-meta').textContent = meta;
    }

    private showError(error: unknown): void {
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        this.setStatus('Error', message);
    }

    private setBusy(busy: boolean): void {
        (this.el('btn-scan') as HTMLButtonElement).disabled = busy;
        (this.el('btn-apply') as HTMLButtonElement).disabled = busy;
    }

    private async sendAction<T>(action: string, data?: unknown): Promise<T> {
        const response = await chrome.runtime.sendMessage({ action, data }) as RuntimeResponse<T> | undefined;
        if (!response) {
            throw new Error('No response from background service.');
        }
        if (!response.success) {
            throw new Error(response.error || 'Request failed.');
        }
        return response.result;
    }

    private el(id: string): HTMLElement {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Element #${id} not found`);
        }
        return element;
    }
}

new ReorganizePage();
