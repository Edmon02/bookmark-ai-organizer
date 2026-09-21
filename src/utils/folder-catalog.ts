// SPDX-License-Identifier: Apache-2.0

export const LEAVE_OPTION = 'leave';
export const MAX_CHOICE_OPTIONS = 255;
export const MAX_FOLDER_DEPTH = 3;
export const KEEP_THRESHOLD = 0.9;
export const HIGH_CONFIDENCE = 0.75;
export const REVIEW_CONFIDENCE = 0.45;

export interface CatalogFolder {
    id: string;
    title: string;
    description: string;
}

export const FALLBACK_FOLDER_CATALOG: CatalogFolder[] = [
    {
        id: 'c_news',
        title: '📰 News',
        description: 'News, journalism, current events, and politics.',
    },
    {
        id: 'c_technology',
        title: '💻 Technology',
        description: 'Software, programming, gadgets, and developer tools.',
    },
    {
        id: 'c_shopping',
        title: '🛒 Shopping',
        description: 'Stores, products, marketplaces, and commerce.',
    },
    {
        id: 'c_education',
        title: '📚 Education',
        description: 'Courses, tutorials, research, and learning resources.',
    },
    {
        id: 'c_social',
        title: '🌐 Social Media',
        description: 'Social networks, forums, and community sites.',
    },
    {
        id: 'c_entertainment',
        title: '🎬 Entertainment',
        description: 'Movies, music, games, and streaming.',
    },
    {
        id: 'c_finance',
        title: '💰 Finance',
        description: 'Banking, investing, crypto, and personal finance.',
    },
    {
        id: 'c_reference',
        title: '📖 Reference',
        description: 'Documentation, wikis, and general reference material.',
    },
    {
        id: 'c_work',
        title: '💼 Work',
        description: 'Jobs, careers, recruiting, and professional profiles.',
    },
    {
        id: 'c_travel',
        title: '✈️ Travel',
        description: 'Hotels, trips, flights, and places to visit.',
    },
];

export function catalogById(id: string): CatalogFolder | undefined {
    return FALLBACK_FOLDER_CATALOG.find((folder) => folder.id === id);
}

export function isCatalogOption(optionId: string): boolean {
    return optionId.startsWith('c_');
}

export function isFolderOption(optionId: string): boolean {
    return optionId.startsWith('f_');
}

export function folderOptionId(bookmarkId: string): string {
    return `f_${bookmarkId}`;
}

export function parseFolderOptionId(optionId: string): string | null {
    if (!isFolderOption(optionId)) {
        return null;
    }
    return optionId.slice(2);
}

export function tagsFromFolderPath(path: string[]): string[] {
    return path
        .map((segment) => segment.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 5);
}
