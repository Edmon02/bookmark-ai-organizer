import path from 'path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

export const extensionPath = path.resolve(__dirname, '../dist');

export async function launchExtension(): Promise<{
    context: BrowserContext;
    extensionId: string;
}> {
    const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: false,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
    });

    let [worker] = context.serviceWorkers();
    if (!worker) {
        worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    const extensionId = new URL(worker.url()).host;
    return { context, extensionId };
}

export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    return page;
}
