// SPDX-License-Identifier: Apache-2.0
import type { ReorgSuggestion } from './reorg-planner';

export const REORG_JOB_KEY = 'reorg_job';
export const REORG_UNDO_KEY = 'reorg_undo';
export const REORG_CANCEL_KEY = 'reorg_cancel';

export type ReorgJobStatus = 'idle' | 'scanning' | 'review' | 'applying' | 'done' | 'cancelled' | 'error';

export interface ReorgJob {
    status: ReorgJobStatus;
    total: number;
    processed: number;
    suggestions: ReorgSuggestion[];
    appliedCount?: number;
    error?: string;
    updatedAt: number;
}

export interface ReorgUndoEntry {
    bookmarkId: string;
    previousParentId: string;
}

function sessionArea(): chrome.storage.StorageArea {
    return chrome.storage.session ?? chrome.storage.local;
}

export function emptyReorgJob(status: ReorgJobStatus = 'idle'): ReorgJob {
    return {
        status,
        total: 0,
        processed: 0,
        suggestions: [],
        updatedAt: Date.now(),
    };
}

export async function readReorgJob(): Promise<ReorgJob> {
    try {
        const result = await sessionArea().get(REORG_JOB_KEY);
        const job = result[REORG_JOB_KEY] as ReorgJob | undefined;
        return job ?? emptyReorgJob();
    } catch {
        return emptyReorgJob();
    }
}

export async function writeReorgJob(job: ReorgJob): Promise<void> {
    await sessionArea().set({
        [REORG_JOB_KEY]: {
            ...job,
            updatedAt: Date.now(),
        },
    });
}

export async function readUndoLog(): Promise<ReorgUndoEntry[]> {
    try {
        const result = await sessionArea().get(REORG_UNDO_KEY);
        const log = result[REORG_UNDO_KEY];
        return Array.isArray(log) ? log as ReorgUndoEntry[] : [];
    } catch {
        return [];
    }
}

export async function writeUndoLog(entries: ReorgUndoEntry[]): Promise<void> {
    await sessionArea().set({ [REORG_UNDO_KEY]: entries });
}

export async function setReorgCancelled(cancelled: boolean): Promise<void> {
    await sessionArea().set({ [REORG_CANCEL_KEY]: cancelled });
}

export async function isReorgCancelled(): Promise<boolean> {
    try {
        const result = await sessionArea().get(REORG_CANCEL_KEY);
        return result[REORG_CANCEL_KEY] === true;
    } catch {
        return false;
    }
}
