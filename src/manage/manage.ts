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
        this.searchStatus.textContent = 'Searching…';
        this.searchResults.innerHTML = '';
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'SEARCH_BOOKMARKS',
                data: { description }
            });
            if (!response?.success) {
                throw new Error(response?.error || 'Search failed');
            }
            const matches: BookmarkMatch[] = response.matches || [];
            this.searchStatus.textContent = matches.length ? `Found ${matches.length} match(es).` : 'No matches found.';
            this.renderResults(matches);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Search failed';
            this.searchStatus.textContent = message;
        } finally {
            this.searchBtn.disabled = false;
        }
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

    private appendBubble(role: 'user' | 'assistant' | 'system', text: string): HTMLElement {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;
        bubble.textContent = text;
        this.chatMessagesEl.appendChild(bubble);
        this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;
        return bubble;
    }

    private async sendChatMessage() {
        const text = this.chatInput.value.trim();
        if (!text) return;
        this.chatInput.value = '';
        this.chatInput.disabled = true;
        this.chatSendBtn.disabled = true;

        this.appendBubble('user', text);
        this.history.push({ role: 'user', content: text });

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'CHAT_MESSAGE',
                data: { history: this.history }
            });
            if (!response?.success) {
                throw new Error(response?.error || 'Chat request failed');
            }
            const content: string = response.content || '';
            const proposedActions: DisplayedProposedAction[] = response.proposedActions || [];
            this.history.push({ role: 'assistant', content });

            const bubble = this.appendBubble('assistant', content);
            for (const action of proposedActions) {
                this.renderProposedAction(bubble, action);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Chat request failed';
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
