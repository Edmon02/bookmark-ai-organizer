// SPDX-License-Identifier: Apache-2.0
import type { ChatMessage, ProposedAction } from '../utils/bookmark-assistant';
import type { BookmarkMatch } from '../utils/bookmark-search';

interface DisplayedProposedAction extends ProposedAction {
    applied?: boolean;
}

class ManagePageController {
    private searchDescription: HTMLTextAreaElement;
    private searchBtn: HTMLButtonElement;
    private searchStatus: HTMLElement;
    private searchResults: HTMLElement;

    private chatMessagesEl: HTMLElement;
    private chatInput: HTMLInputElement;
    private chatSendBtn: HTMLButtonElement;
    private chatWelcomeShown = false;

    private history: ChatMessage[] = [];

    constructor() {
        this.searchDescription = document.getElementById('search-description') as HTMLTextAreaElement;
        this.searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
        this.searchStatus = document.getElementById('search-status')!;
        this.searchResults = document.getElementById('search-results')!;

        this.chatMessagesEl = document.getElementById('chat-messages')!;
        this.chatInput = document.getElementById('chat-input') as HTMLInputElement;
        this.chatSendBtn = document.getElementById('chat-send') as HTMLButtonElement;

        this.bindTabs();
        this.bindSearch();
        this.bindChat();
        this.showChatWelcome();
    }

    private bindTabs() {
        document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab-${btn.dataset.tab}`)!.classList.add('active');
            });
        });
    }

    private bindSearch() {
        this.searchBtn.addEventListener('click', () => this.runSearch());
    }

    private async runSearch() {
        const description = this.searchDescription.value.trim();
        if (!description) {
            this.searchStatus.textContent = 'Please describe the page you are looking for.';
            return;
        }
        this.searchBtn.disabled = true;
        this.searchDescription.disabled = true;
        this.searchStatus.textContent = 'Searching…';
        this.searchResults.innerHTML = '';
        this.renderSearchLoading();
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'SEARCH_BOOKMARKS',
                data: { description }
            });
            if (!response?.success) {
                throw new Error(response?.error || 'Search failed');
            }
            const matches: BookmarkMatch[] = response.result?.matches || [];
            this.searchStatus.textContent = matches.length ? `Found ${matches.length} match(es).` : 'No matches found.';
            this.renderResults(matches);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Search failed';
            this.searchStatus.textContent = message;
            this.searchResults.innerHTML = '';
        } finally {
            this.searchBtn.disabled = false;
            this.searchDescription.disabled = false;
        }
    }

    private renderSearchLoading() {
        const li = document.createElement('li');
        li.className = 'result-item loading';
        li.textContent = 'Looking through your saved bookmarks...';
        this.searchResults.appendChild(li);
    }

    private renderResults(matches: BookmarkMatch[]) {
        this.searchResults.innerHTML = '';
        for (const match of matches) {
            const li = document.createElement('li');
            li.className = 'result-item';
            li.innerHTML = `
                <div class="result-title"></div>
                <div class="result-url"></div>
                <div class="result-path"></div>
                <div class="result-reason"></div>
                <div class="result-actions">
                    <button class="open-btn">Open page</button>
                    <button class="reveal-btn">Reveal in Bookmark Manager</button>
                </div>
            `;
            li.querySelector('.result-title')!.textContent = match.title;
            li.querySelector('.result-url')!.textContent = match.url;
            li.querySelector('.result-path')!.textContent = (match.path || []).join(' / ') || 'Bookmarks Bar';
            li.querySelector('.result-reason')!.textContent = match.reason ? `Why: ${match.reason}` : '';
            li.querySelector('.open-btn')!.addEventListener('click', () => chrome.tabs.create({ url: match.url }));
            li.querySelector('.reveal-btn')!.addEventListener('click', () =>
                chrome.tabs.create({ url: `chrome://bookmarks/?id=${match.id}` })
            );
            this.searchResults.appendChild(li);
        }
    }

    private bindChat() {
        this.chatSendBtn.addEventListener('click', () => this.sendChatMessage());
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
    }

    private showChatWelcome() {
        if (this.chatWelcomeShown) return;
        this.chatWelcomeShown = true;
        const welcome = this.appendBubble(
            'system',
            'Try prompts like "show me the top 10 most organized bookmarks", "find the bookmark about TypeScript decorators", or "move my Python bookmarks into a new folder".'
        );
        welcome.classList.add('welcome-bubble');
    }

    private appendBubble(role: 'user' | 'assistant' | 'system', text: string): HTMLElement {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;
        if (role === 'assistant') {
            this.renderAssistantMessage(bubble, text);
        } else {
            bubble.textContent = text;
        }
        this.chatMessagesEl.appendChild(bubble);
        this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;
        return bubble;
    }

    private renderAssistantMessage(container: HTMLElement, text: string) {
        const escaped = this.escapeHtml(text);
        const blocks = escaped.split(/\n\s*\n/).filter(Boolean);

        for (const block of blocks) {
            const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
            if (!lines.length) continue;

            if (lines.every(line => /^\d+\.\s/.test(line))) {
                const ol = document.createElement('ol');
                for (const line of lines) {
                    const li = document.createElement('li');
                    li.innerHTML = this.decorateInlineMarkdown(line.replace(/^\d+\.\s/, ''));
                    this.bindBookmarkLinks(li);
                    ol.appendChild(li);
                }
                container.appendChild(ol);
                continue;
            }

            if (lines.every(line => /^-\s/.test(line))) {
                const ul = document.createElement('ul');
                for (const line of lines) {
                    const li = document.createElement('li');
                    li.innerHTML = this.decorateInlineMarkdown(line.replace(/^-\s/, ''));
                    this.bindBookmarkLinks(li);
                    ul.appendChild(li);
                }
                container.appendChild(ul);
                continue;
            }

            const p = document.createElement('p');
            p.innerHTML = this.decorateInlineMarkdown(lines.join('<br>'));
            this.bindBookmarkLinks(p);
            container.appendChild(p);
        }
    }

    private decorateInlineMarkdown(text: string): string {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\bbookmark\s+(\d+)\b/gi, 'bookmark <button class="bookmark-link" data-bookmark-id="$1">#$1</button>')
            .replace(/\bid:\s*(\d+)\b/gi, 'id: <button class="bookmark-link" data-bookmark-id="$1">#$1</button>');
    }

    private bindBookmarkLinks(container: ParentNode) {
        container.querySelectorAll<HTMLButtonElement>('.bookmark-link').forEach(button => {
            button.addEventListener('click', () => {
                const bookmarkId = button.dataset.bookmarkId;
                if (!bookmarkId) return;
                chrome.tabs.create({ url: `chrome://bookmarks/?id=${bookmarkId}` });
            });
        });
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private async sendChatMessage() {
        const text = this.chatInput.value.trim();
        if (!text) return;
        this.chatInput.value = '';
        this.chatInput.disabled = true;
        this.chatSendBtn.disabled = true;

        this.appendBubble('user', text);
        this.history.push({ role: 'user', content: text });
        const loadingBubble = this.appendBubble('assistant', 'Thinking...');
        loadingBubble.classList.add('loading');

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'CHAT_MESSAGE',
                data: { history: this.history }
            });
            if (!response?.success) {
                throw new Error(response?.error || 'Chat request failed');
            }
            const content: string = response.result?.content || '';
            const proposedActions: DisplayedProposedAction[] = response.result?.proposedActions || [];
            this.history.push({ role: 'assistant', content });

            loadingBubble.remove();
            const bubble = this.appendBubble('assistant', content);
            for (const action of proposedActions) {
                this.renderProposedAction(bubble, action);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Chat request failed';
            loadingBubble.remove();
            this.appendBubble('system', message);
        } finally {
            this.chatInput.disabled = false;
            this.chatSendBtn.disabled = false;
            this.chatInput.focus();
        }
    }

    private renderProposedAction(container: HTMLElement, action: DisplayedProposedAction) {
        const card = document.createElement('div');
        card.className = 'proposed-action';
        card.innerHTML = `
            <div class="description"></div>
            <div class="actions">
                <button class="apply-btn">Apply</button>
                <button class="dismiss-btn">Dismiss</button>
            </div>
        `;
        card.querySelector('.description')!.textContent = action.description;

        const applyBtn = card.querySelector('.apply-btn') as HTMLButtonElement;
        const dismissBtn = card.querySelector('.dismiss-btn') as HTMLButtonElement;

        applyBtn.addEventListener('click', async () => {
            applyBtn.disabled = true;
            dismissBtn.disabled = true;
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'APPLY_BOOKMARK_ACTION',
                    data: { action }
                });
                if (!response?.success) {
                    throw new Error(response?.error || 'Failed to apply action');
                }
                card.classList.add('applied');
                this.appendBubble('system', `Applied: ${action.description}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to apply action';
                this.appendBubble('system', `Error applying action: ${message}`);
                applyBtn.disabled = false;
                dismissBtn.disabled = false;
            }
        });

        dismissBtn.addEventListener('click', () => {
            card.remove();
        });

        container.appendChild(card);
    }
}

new ManagePageController();
