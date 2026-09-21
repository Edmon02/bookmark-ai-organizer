// SPDX-License-Identifier: Apache-2.0
import {
    AUTO_PROVIDER_ORDER,
    detectProviderId,
    isProviderId,
    type ProviderId,
} from './providers';

export type ProviderKeyVault = Partial<Record<ProviderId, string>>;

export interface StoredKeyInfo {
    providerId: ProviderId;
    hint: string;
}

export class SecurityManager {
    static readonly VAULT_KEY = 'provider_api_keys';
    static readonly LAST_SAVED_PROVIDER_KEY = 'last_saved_provider';
    private static readonly LEGACY_LOCAL_KEY = 'api_key';
    private static readonly LEGACY_SYNC_KEY = 'encrypted_api_key';
    private static readonly MAX_KEY_LENGTH = 2048;

    static detectProviderId(apiKey: string): ProviderId | null {
        return detectProviderId(apiKey);
    }

    static async storeApiKey(apiKey: string, providerId?: ProviderId | string | null): Promise<StoredKeyInfo> {
        const normalized = this.normalizeApiKey(apiKey);
        this.validateApiKey(normalized);

        const resolvedProvider = this.resolveStoreProvider(normalized, providerId);
        const vault = await this.ensureVault();
        const nextVault: ProviderKeyVault = {
            ...vault,
            [resolvedProvider]: normalized,
        };

        await chrome.storage.local.set({
            [this.VAULT_KEY]: nextVault,
            [this.LAST_SAVED_PROVIDER_KEY]: resolvedProvider,
        });

        const persisted = await this.readVault();
        if (persisted[resolvedProvider] !== normalized) {
            throw new Error('Failed to persist API key on this device.');
        }

        await this.bestEffortRemove(chrome.storage.sync, this.LEGACY_SYNC_KEY);
        await this.bestEffortRemove(chrome.storage.local, this.LEGACY_LOCAL_KEY);

        return {
            providerId: resolvedProvider,
            hint: this.hintFor(normalized),
        };
    }

    static async getApiKey(providerId?: ProviderId | string | null): Promise<string | null> {
        const vault = await this.ensureVault();
        if (isProviderId(providerId)) {
            return vault[providerId] ?? null;
        }

        const resolved = await this.resolveAutoCredentials(vault);
        return resolved?.apiKey ?? null;
    }

    static async getApiKeyForProvider(providerId: ProviderId): Promise<string | null> {
        const vault = await this.ensureVault();
        return vault[providerId] ?? null;
    }

    static async hasApiKey(): Promise<boolean> {
        const vault = await this.ensureVault();
        return this.configuredProviders(vault).length > 0;
    }

    static async hasApiKeyForProvider(providerId: ProviderId): Promise<boolean> {
        return Boolean(await this.getApiKeyForProvider(providerId));
    }

    static async getApiKeyHint(providerId?: ProviderId | string | null): Promise<string | null> {
        const apiKey = await this.getApiKey(providerId);
        return apiKey ? this.hintFor(apiKey) : null;
    }

    static async listStoredKeys(): Promise<StoredKeyInfo[]> {
        const vault = await this.ensureVault();
        return this.configuredProviders(vault).map((id) => ({
            providerId: id,
            hint: this.hintFor(vault[id] as string),
        }));
    }

    static async resolveAutoCredentials(
        vaultOverride?: ProviderKeyVault,
    ): Promise<{ providerId: ProviderId; apiKey: string } | null> {
        const vault = vaultOverride ?? await this.ensureVault();
        const configured = this.configuredProviders(vault);
        if (!configured.length) {
            return null;
        }

        const lastSaved = await this.getLastSavedProvider();
        if (lastSaved && vault[lastSaved]) {
            return { providerId: lastSaved, apiKey: vault[lastSaved] as string };
        }

        for (const providerId of AUTO_PROVIDER_ORDER) {
            const apiKey = vault[providerId];
            if (apiKey) {
                return { providerId, apiKey };
            }
        }

        const fallbackId = configured[0];
        return { providerId: fallbackId, apiKey: vault[fallbackId] as string };
    }

    static async clearApiKey(providerId?: ProviderId | string | null): Promise<void> {
        if (isProviderId(providerId)) {
            const vault = await this.readVault();
            delete vault[providerId];
            await chrome.storage.local.set({ [this.VAULT_KEY]: vault });
            const lastSaved = await this.getLastSavedProvider();
            if (lastSaved === providerId) {
                await this.bestEffortRemove(chrome.storage.local, this.LAST_SAVED_PROVIDER_KEY);
            }
            return;
        }

        await Promise.all([
            this.bestEffortRemove(chrome.storage.local, this.VAULT_KEY),
            this.bestEffortRemove(chrome.storage.local, this.LAST_SAVED_PROVIDER_KEY),
            this.bestEffortRemove(chrome.storage.local, this.LEGACY_LOCAL_KEY),
            this.bestEffortRemove(chrome.storage.sync, this.LEGACY_SYNC_KEY),
        ]);
    }

    private static resolveStoreProvider(apiKey: string, providerId?: ProviderId | string | null): ProviderId {
        if (isProviderId(providerId)) {
            return providerId;
        }
        const detected = detectProviderId(apiKey);
        if (!detected) {
            throw new Error('Could not detect the AI provider. Choose a provider and try again.');
        }
        return detected;
    }

    private static async ensureVault(): Promise<ProviderKeyVault> {
        const vault = await this.readVault();
        await this.migrateLegacyKeys(vault);
        return this.readVault();
    }

    private static async migrateLegacyKeys(currentVault: ProviderKeyVault): Promise<void> {
        const localLegacy = await this.readLegacyLocalKey();
        if (localLegacy) {
            await this.absorbLegacyKey(currentVault, localLegacy);
        }

        const syncLegacy = await this.readLegacySyncKey();
        if (syncLegacy) {
            const latest = await this.readVault();
            await this.absorbLegacyKey(latest, syncLegacy);
            await this.bestEffortRemove(chrome.storage.sync, this.LEGACY_SYNC_KEY);
        }
    }

    private static async absorbLegacyKey(currentVault: ProviderKeyVault, apiKey: string): Promise<void> {
        const providerId = detectProviderId(apiKey) ?? 'openrouter';
        if (currentVault[providerId]) {
            await this.bestEffortRemove(chrome.storage.local, this.LEGACY_LOCAL_KEY);
            return;
        }

        const nextVault: ProviderKeyVault = {
            ...currentVault,
            [providerId]: apiKey,
        };
        await chrome.storage.local.set({
            [this.VAULT_KEY]: nextVault,
            [this.LAST_SAVED_PROVIDER_KEY]: providerId,
        });
        const persisted = await this.readVault();
        if (persisted[providerId] === apiKey) {
            await this.bestEffortRemove(chrome.storage.local, this.LEGACY_LOCAL_KEY);
        }
    }

    private static async readVault(): Promise<ProviderKeyVault> {
        try {
            const result = await chrome.storage.local.get(this.VAULT_KEY);
            const raw = result[this.VAULT_KEY];
            return this.normalizeVault(raw);
        } catch {
            return {};
        }
    }

    private static normalizeVault(raw: unknown): ProviderKeyVault {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return {};
        }

        const vault: ProviderKeyVault = {};
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (!isProviderId(key) || typeof value !== 'string') {
                continue;
            }
            try {
                const normalized = this.normalizeApiKey(value);
                this.validateApiKey(normalized);
                vault[key] = normalized;
            } catch {
                // Keep other providers; skip the invalid slot.
            }
        }
        return vault;
    }

    private static configuredProviders(vault: ProviderKeyVault): ProviderId[] {
        return AUTO_PROVIDER_ORDER.filter((id) => Boolean(vault[id]));
    }

    private static async getLastSavedProvider(): Promise<ProviderId | null> {
        try {
            const result = await chrome.storage.local.get(this.LAST_SAVED_PROVIDER_KEY);
            const value = result[this.LAST_SAVED_PROVIDER_KEY];
            return isProviderId(value) ? value : null;
        } catch {
            return null;
        }
    }

    private static async readLegacyLocalKey(): Promise<string | null> {
        try {
            const result = await chrome.storage.local.get(this.LEGACY_LOCAL_KEY);
            const storedKey = result[this.LEGACY_LOCAL_KEY];
            if (typeof storedKey !== 'string' || !storedKey) {
                return null;
            }
            const normalized = this.normalizeApiKey(storedKey);
            this.validateApiKey(normalized);
            return normalized;
        } catch {
            return null;
        }
    }

    private static async readLegacySyncKey(): Promise<string | null> {
        try {
            const result = await chrome.storage.sync.get(this.LEGACY_SYNC_KEY);
            const legacyEncoded = result[this.LEGACY_SYNC_KEY];
            if (typeof legacyEncoded !== 'string' || !legacyEncoded) {
                return null;
            }
            const migrated = this.normalizeApiKey(atob(legacyEncoded));
            this.validateApiKey(migrated);
            return migrated;
        } catch {
            await this.bestEffortRemove(chrome.storage.sync, this.LEGACY_SYNC_KEY);
            return null;
        }
    }

    private static normalizeApiKey(apiKey: string): string {
        return apiKey.trim();
    }

    private static validateApiKey(apiKey: string): void {
        if (!apiKey) {
            throw new Error('API key is required.');
        }
        if (apiKey.length < 10) {
            throw new Error('API key looks too short.');
        }
        if (apiKey.length > this.MAX_KEY_LENGTH) {
            throw new Error('API key looks invalid.');
        }
        if (/\s/.test(apiKey)) {
            throw new Error('API key must not contain spaces.');
        }
    }

    private static hintFor(apiKey: string): string {
        return `ends with ${apiKey.slice(-4)}`;
    }

    private static async bestEffortRemove(
        area: { remove: (keys: string | string[]) => Promise<void> } | undefined,
        key: string,
    ): Promise<void> {
        if (!area) {
            return;
        }
        try {
            await area.remove(key);
        } catch {
            // Sync storage can be unavailable; local persistence already succeeded.
        }
    }
}
