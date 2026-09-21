import { SecurityManager } from '../src/utils/security';
import { detectProviderId } from '../src/utils/providers';
import { createStorageArea } from './helpers/chrome-storage';

type StorageRecord = Record<string, unknown>;

describe('provider detection', () => {
    test('maps known key prefixes without guessing long unknown keys', () => {
        expect(detectProviderId('apikey_2132f80432e02c5341d99ad725539b8479a6_abcd')).toBe('typesafe');
        expect(detectProviderId('sk-or-v1-abc1234567')).toBe('openrouter');
        expect(detectProviderId('gsk_abcdefghij')).toBe('groq');
        expect(detectProviderId('sk-openai-abc123')).toBe('openai');
        expect(detectProviderId('xai-abcdefghij')).toBe('grok');
        expect(detectProviderId('kimi-secret-123456')).toBe('moonshot');
        expect(detectProviderId('totally-unknown-key-that-is-very-long-1234567890')).toBeNull();
    });
});

describe('SecurityManager vault', () => {
    let localStore: StorageRecord;
    let syncStore: StorageRecord;

    beforeEach(() => {
        localStore = {};
        syncStore = {};

        if (typeof globalThis.atob !== 'function') {
            (globalThis as { atob: (value: string) => string }).atob = (value: string) =>
                Buffer.from(value, 'base64').toString('utf8');
        }

        (globalThis as { chrome?: unknown }).chrome = {
            storage: {
                local: createStorageArea(localStore),
                sync: createStorageArea(syncStore),
            },
        };
    });

    test('stores a validated API key in the provider vault', async () => {
        await SecurityManager.storeApiKey('  sk-or-v1-test-1234567890  ');

        expect(localStore.provider_api_keys).toEqual({
            openrouter: 'sk-or-v1-test-1234567890',
        });
        expect(localStore.api_key).toBeUndefined();
        expect(syncStore.encrypted_api_key).toBeUndefined();
    });

    test('keeps OpenRouter and TypeSafe keys in separate slots', async () => {
        await SecurityManager.storeApiKey('sk-or-v1-openrouter-key');
        await SecurityManager.storeApiKey('apikey_typesafe_test_key_123');

        const vault = localStore.provider_api_keys as Record<string, string>;
        expect(vault.openrouter).toBe('sk-or-v1-openrouter-key');
        expect(vault.typesafe).toBe('apikey_typesafe_test_key_123');
        await expect(SecurityManager.getApiKeyForProvider('openrouter')).resolves.toBe('sk-or-v1-openrouter-key');
        await expect(SecurityManager.getApiKeyForProvider('typesafe')).resolves.toBe('apikey_typesafe_test_key_123');
    });

    test('migrates a legacy local key into the vault without guessing unknown formats', async () => {
        localStore.api_key = 'sk-legacy-123456789';

        const key = await SecurityManager.getApiKey();

        expect(key).toBe('sk-legacy-123456789');
        expect((localStore.provider_api_keys as Record<string, string>).openai).toBe('sk-legacy-123456789');
        expect(localStore.api_key).toBeUndefined();
    });

    test('migrates legacy sync key into local vault', async () => {
        syncStore.encrypted_api_key = Buffer.from('sk-legacy-123456789').toString('base64');

        const key = await SecurityManager.getApiKey();

        expect(key).toBe('sk-legacy-123456789');
        expect((localStore.provider_api_keys as Record<string, string>).openai).toBe('sk-legacy-123456789');
        expect(syncStore.encrypted_api_key).toBeUndefined();
    });

    test('drops malformed legacy keys safely', async () => {
        syncStore.encrypted_api_key = '*not-base64*';
        const key = await SecurityManager.getApiKey();

        expect(key).toBeNull();
        expect(syncStore.encrypted_api_key).toBeUndefined();
    });

    test('returns key presence and hint without exposing the full key', async () => {
        localStore.api_key = 'sk-demo-123456789';

        await expect(SecurityManager.hasApiKey()).resolves.toBe(true);
        await expect(SecurityManager.getApiKeyHint()).resolves.toBe('ends with 6789');
    });

    test('still returns the key after a simulated new session', async () => {
        await SecurityManager.storeApiKey('sk-or-v1-persisted-key');
        const persisted = JSON.parse(JSON.stringify(localStore));

        localStore = persisted;
        (globalThis as { chrome?: unknown }).chrome = {
            storage: {
                local: createStorageArea(localStore),
                sync: createStorageArea({}),
            },
        };

        await expect(SecurityManager.getApiKeyForProvider('openrouter')).resolves.toBe('sk-or-v1-persisted-key');
        await expect(SecurityManager.hasApiKey()).resolves.toBe(true);
    });

    test('does not delete a valid key when another vault slot is invalid', async () => {
        localStore.provider_api_keys = {
            openrouter: 'sk-or-v1-keep-me-please',
            openai: 'short',
        };

        await expect(SecurityManager.getApiKeyForProvider('openrouter')).resolves.toBe('sk-or-v1-keep-me-please');
        await expect(SecurityManager.getApiKeyForProvider('openai')).resolves.toBeNull();
    });

    test('persists the key even when sync cleanup fails', async () => {
        (globalThis as { chrome?: unknown }).chrome = {
            storage: {
                local: createStorageArea(localStore),
                sync: {
                    ...createStorageArea(syncStore),
                    async remove() {
                        throw new Error('sync unavailable');
                    },
                },
            },
        };

        await SecurityManager.storeApiKey('sk-or-v1-local-only-key');
        expect((localStore.provider_api_keys as Record<string, string>).openrouter).toBe('sk-or-v1-local-only-key');
    });

    test('clearing one provider leaves the other key in place', async () => {
        await SecurityManager.storeApiKey('sk-or-v1-openrouter-key');
        await SecurityManager.storeApiKey('apikey_typesafe_test_key_123');
        await SecurityManager.clearApiKey('typesafe');

        await expect(SecurityManager.getApiKeyForProvider('typesafe')).resolves.toBeNull();
        await expect(SecurityManager.getApiKeyForProvider('openrouter')).resolves.toBe('sk-or-v1-openrouter-key');
    });
});
