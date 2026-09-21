// SPDX-License-Identifier: Apache-2.0

export interface ClassificationResult {
    folderPath: string[];
    tags: string[];
    confidence: number;
}

export interface ClassificationOptions {
    providerOverride?: string | null;
    modelOverride?: string | null;
}

export interface ClassificationResultWithMeta extends ClassificationResult {
    providerId: string;
    providerName: string;
    model: string;
}
