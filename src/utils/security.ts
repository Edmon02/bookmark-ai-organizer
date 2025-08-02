export class SecurityManager {
    private static readonly STORAGE_KEY = 'encrypted_api_key';

    static async storeApiKey(apiKey: string): Promise<void> {
        console.log('Storing API key (length):', apiKey.length);
        // Simplified encryption (use Web Crypto API in production)
        const encrypted = btoa(apiKey);
        await chrome.storage.sync.set({ [this.STORAGE_KEY]: encrypted });
        console.log('API key stored successfully');
    }

    static async getApiKey(): Promise<string | null> {
        try {
            const result = await chrome.storage.sync.get(this.STORAGE_KEY);
            const encryptedKey = result[this.STORAGE_KEY];
            
            if (!encryptedKey) {
                console.log('No API key found in storage');
                return null;
            }
            
            const decrypted = atob(encryptedKey);
            console.log('API key retrieved (length):', decrypted.length);
            return decrypted;
        } catch (error) {
            console.error('Error retrieving API key:', error);
            return null;
        }
    }
}