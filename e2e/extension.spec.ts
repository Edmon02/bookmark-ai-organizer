import { test, expect } from '@playwright/test';
import { launchExtension, openPopup } from './extension-harness';

const OPENROUTER_KEY = 'sk-or-v1-e2e-persistence-key-123456';

test.describe('AI Bookmark Organizer', () => {
    test('keeps a saved OpenRouter key after the popup is closed and opened again', async () => {
        const { context, extensionId } = await launchExtension();
        try {
            const popup = await openPopup(context, extensionId);
            await popup.getByRole('button', { name: /I have an API key/i }).click();
            await popup.locator('#ob-api-key').fill(OPENROUTER_KEY);
            await popup.getByRole('button', { name: 'Connect & Start' }).click();
            await expect(popup.locator('#view-main')).toBeVisible({ timeout: 10000 });
            await popup.close();

            const popupAgain = await openPopup(context, extensionId);
            await expect(popupAgain.locator('#view-main')).toBeVisible({ timeout: 10000 });
            await expect(popupAgain.locator('#view-onboarding')).toBeHidden();
            await popupAgain.locator('#btn-settings').click();
            await expect(popupAgain.locator('#key-badge-text')).toContainText('ends with 3456');
        } finally {
            await context.close();
        }
    });

    test('reorganize review can apply a suggested move', async () => {
        const { context, extensionId } = await launchExtension();
        try {
            const popup = await openPopup(context, extensionId);
            await popup.getByRole('button', { name: /I have an API key/i }).click();
            await popup.locator('#ob-provider').selectOption('typesafe');
            await popup.locator('#ob-api-key').fill('apikey_e2e_typesafe_key_123456');
            await popup.getByRole('button', { name: 'Connect & Start' }).click();
            await expect(popup.locator('#view-main')).toBeVisible({ timeout: 10000 });

            const fixture = await popup.evaluate(async () => {
                const folder = await chrome.bookmarks.create({ title: 'Inbox' });
                const bookmark = await chrome.bookmarks.create({
                    parentId: folder.id,
                    title: 'Example Docs',
                    url: 'https://example.com/docs',
                });
                await chrome.storage.session.set({
                    reorg_job: {
                        status: 'review',
                        total: 1,
                        processed: 1,
                        suggestions: [{
                            bookmarkId: bookmark.id,
                            title: bookmark.title,
                            url: bookmark.url,
                            fromPath: ['Inbox'],
                            toPath: ['💻 Technology'],
                            fromParentId: folder.id,
                            confidence: 0.92,
                            keepProbability: 0.05,
                            decision: 'apply',
                            reason: 'High-confidence folder match.',
                        }],
                        updatedAt: Date.now(),
                    },
                });
                return { bookmarkId: bookmark.id };
            });

            const page = await context.newPage();
            await page.goto(`chrome-extension://${extensionId}/reorganize/reorganize.html`);
            await expect(page.locator('#review-body .move-card')).toHaveCount(1, { timeout: 10000 });
            await expect(page.getByText('Inbox')).toBeVisible();
            await expect(page.getByText('💻 Technology')).toBeVisible();
            await page.locator('#btn-apply').click();
            await expect(page.locator('#status-title')).toContainText(/Library updated|Moves applied/, { timeout: 10000 });

            const moved = await page.evaluate(async (bookmarkId) => {
                const [bookmark] = await chrome.bookmarks.get(bookmarkId);
                const [parent] = await chrome.bookmarks.get(bookmark.parentId!);
                return parent.title;
            }, fixture.bookmarkId);
            expect(moved).toContain('Technology');
        } finally {
            await context.close();
        }
    });
});
