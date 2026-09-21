type StorageRecord = Record<string, unknown>;

export function createStorageArea(store: StorageRecord) {
    return {
        async get(key: string | string[]) {
            if (Array.isArray(key)) {
                return key.reduce<Record<string, unknown>>((acc, item) => {
                    acc[item] = store[item];
                    return acc;
                }, {});
            }
            return { [key]: store[key] };
        },
        async set(values: Record<string, unknown>) {
            Object.assign(store, values);
        },
        async remove(key: string | string[]) {
            if (Array.isArray(key)) {
                key.forEach((item) => delete store[item]);
                return;
            }
            delete store[key];
        },
    };
}

export function installChromeStorage(localStore: StorageRecord, syncStore: StorageRecord, sessionStore?: StorageRecord) {
    (globalThis as any).chrome = {
        ...(globalThis as any).chrome,
        storage: {
            local: createStorageArea(localStore),
            sync: createStorageArea(syncStore),
            session: createStorageArea(sessionStore ?? {}),
        },
    };
}
