// SPDX-License-Identifier: Apache-2.0
import { BookmarkManager } from '../utils/bookmark-manager';

class BackgroundService {
    private bookmarkManager: BookmarkManager;

    constructor() {
        console.log('BackgroundService initializing...');
        this.bookmarkManager = new BookmarkManager();
        this.initializeListeners();
        console.log('BackgroundService initialized successfully');
    }

    private initializeListeners() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('Received message:', request);
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async response
        });

        // Add installation and startup listeners
        chrome.runtime.onInstalled.addListener((details) => {
            console.log('Extension installed/updated:', details);
        });

        chrome.runtime.onStartup.addListener(() => {
            console.log('Extension startup');
        });
    }

    private async handleMessage(request: any, sender: any, sendResponse: (response: any) => void) {
        console.log('Handling message:', request.action);
        try {
            switch (request.action) {
                case 'CREATE_BOOKMARK':
                    const { url, title, classification } = request.data;
                    console.log('Creating bookmark:', { url, title, classification });
                    const bookmark = await this.bookmarkManager.createBookmark(
                        url,
                        title,
                        classification.folderPath
                    );
                    console.log('Bookmark created successfully:', bookmark);
                    sendResponse({ success: true, bookmark });
                    break;
                default:
                    console.warn('Unknown action:', request.action);
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            sendResponse({ success: false, error: errorMessage });
        }
    }
}

// Initialize the service
console.log('Starting BackgroundService...');
new BackgroundService();