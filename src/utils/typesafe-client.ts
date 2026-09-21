// SPDX-License-Identifier: Apache-2.0

export const TYPESAFE_API_URL = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_MODEL = 'jev-latest';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type NoulQuestion = {
    type: 'noul';
    instructions: string | Record<string, unknown>;
    criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
    type: 'choice';
    instructions: string | Record<string, unknown>;
    criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
    type: 'score';
    instructions: string | Record<string, unknown>;
    criteria: string[];
};

export type TypeSafeQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = {
    type: 'noul';
    noul: number;
};

export type ChoiceAnswer = {
    type: 'choice';
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
};

export type ScoreAnswer = {
    type: 'score';
    score: number;
    confidence: number;
    legend: Record<string, string>;
    probabilities: Record<string, number>;
};

export type TypeSafeAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneRequest {
    state: JsonValue;
    model?: string;
    questions: Record<string, TypeSafeQuestion>;
}

export interface SystemOneResult {
    model: string;
    answers: Record<string, TypeSafeAnswer>;
    usage?: { input_tokens: number; output_tokens: number };
}

const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 3;

export async function evaluateSystemOne(
    apiKey: string,
    request: SystemOneRequest,
): Promise<SystemOneResult> {
    if (!Object.keys(request.questions).length) {
        throw new Error('TypeSafe requests need at least one question.');
    }

    const payload = {
        state: request.state,
        model: request.model ?? TYPESAFE_MODEL,
        questions: request.questions,
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetchOnce(apiKey, payload);
            if (response.status === 401) {
                throw new Error('Invalid TypeSafe API key. Check your credentials.');
            }
            if (response.status === 422) {
                const detail = await readErrorDetail(response);
                throw new Error(detail || 'TypeSafe rejected the request.');
            }
            if (response.ok) {
                return parseSystemOneResult(await response.json());
            }

            if (!shouldRetryStatus(response.status) || attempt === MAX_RETRIES) {
                throw new Error(`TypeSafe API error (${response.status}).`);
            }

            await wait(backoffMs(attempt, response.headers.get('Retry-After')));
        } catch (error: unknown) {
            lastError = normalizeError(error);
            if (attempt === MAX_RETRIES || isFatalError(lastError)) {
                throw lastError;
            }
            await wait(backoffMs(attempt, null));
        }
    }

    throw lastError ?? new Error('TypeSafe request failed.');
}

async function fetchOnce(apiKey: string, payload: SystemOneRequest): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(TYPESAFE_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

function parseSystemOneResult(raw: unknown): SystemOneResult {
    if (!raw || typeof raw !== 'object') {
        throw new Error('TypeSafe returned an empty response.');
    }
    const record = raw as Record<string, unknown>;
    const answers = record.answers;
    if (!answers || typeof answers !== 'object') {
        throw new Error('TypeSafe response is missing answers.');
    }
    return {
        model: typeof record.model === 'string' ? record.model : TYPESAFE_MODEL,
        answers: answers as Record<string, TypeSafeAnswer>,
        usage: record.usage as SystemOneResult['usage'],
    };
}

async function readErrorDetail(response: Response): Promise<string | null> {
    try {
        const body = await response.json() as { detail?: unknown; error?: unknown; message?: unknown };
        if (typeof body.detail === 'string') {
            return body.detail;
        }
        if (typeof body.message === 'string') {
            return body.message;
        }
        if (typeof body.error === 'string') {
            return body.error;
        }
    } catch {
        return null;
    }
    return null;
}

function shouldRetryStatus(status: number): boolean {
    return status === 429 || status === 529 || status >= 500;
}

function isFatalError(error: Error): boolean {
    return error.message.startsWith('Invalid TypeSafe API key')
        || error.message.startsWith('TypeSafe rejected');
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
    if (retryAfterHeader) {
        const seconds = Number(retryAfterHeader);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(seconds * 1000, 10000);
        }
    }
    return Math.min(400 * 2 ** attempt, 4000);
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error && error.name === 'AbortError') {
        return new Error('TypeSafe request timed out.');
    }
    if (error instanceof Error) {
        return error;
    }
    return new Error('TypeSafe request failed.');
}

export function asChoice(answer: TypeSafeAnswer | undefined): ChoiceAnswer {
    if (!answer || answer.type !== 'choice') {
        throw new Error('TypeSafe did not return a choice answer.');
    }
    return answer;
}

export function asNoul(answer: TypeSafeAnswer | undefined): NoulAnswer {
    if (!answer || answer.type !== 'noul') {
        throw new Error('TypeSafe did not return a noul answer.');
    }
    return answer;
}
