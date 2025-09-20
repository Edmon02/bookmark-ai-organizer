import { LlmClassifier } from '../utils/llm-classifier';
import { SecurityManager } from '../utils/security';
import { fetchOpenRouterModels, getProviderPreference, setProviderPreference, getSelectedOpenRouterModel, setSelectedOpenRouterModel } from '../utils/openrouter';

class PopupController {
    private elements: { 
        classifyBtn: HTMLElement;
        saveApiKeyBtn: HTMLElement;
        apiKeyInput: HTMLInputElement;
        status: HTMLElement;
        progress: HTMLElement;
        pageTitle: HTMLElement;
        pageUrl: HTMLElement;
        providerSelect: HTMLSelectElement;
        openRouterModelSection: HTMLElement;
        openRouterModelsSelect: HTMLSelectElement;
        refreshModelsBtn: HTMLButtonElement;
        modelStatus: HTMLElement;
    } = {} as any;

    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.loadPageInfo();
        this.checkApiKey();
        this.initializeProviderPreference();
    }

    private initializeElements() {
        this.elements.classifyBtn = document.getElementById('classify-bookmark')!;
        this.elements.saveApiKeyBtn = document.getElementById('save-api-key')!;
        this.elements.apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
        this.elements.status = document.getElementById('status')!;
        this.elements.progress = document.getElementById('progress')!;
        this.elements.pageTitle = document.getElementById('page-title')!;
        this.elements.pageUrl = document.getElementById('page-url')!;
        this.elements.providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
        this.elements.openRouterModelSection = document.getElementById('openrouter-model-section')!;
        this.elements.openRouterModelsSelect = document.getElementById('openrouter-models') as HTMLSelectElement;
        this.elements.refreshModelsBtn = document.getElementById('refresh-models') as HTMLButtonElement;
        this.elements.modelStatus = document.getElementById('model-status')!;
    }

    private bindEvents() {
        this.elements.classifyBtn.addEventListener('click', () => this.classifyBookmark());
        this.elements.saveApiKeyBtn.addEventListener('click', () => this.saveApiKey());
        this.elements.providerSelect.addEventListener('change', () => this.onProviderChange());
        this.elements.openRouterModelsSelect.addEventListener('change', () => this.onModelSelected());
        this.elements.refreshModelsBtn.addEventListener('click', () => this.loadOpenRouterModels(true));
    }

    private async loadPageInfo() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        this.elements.pageTitle.textContent = tab.title || 'No Title';
        this.elements.pageUrl.textContent = tab.url || 'No URL';
    }

    private async initializeProviderPreference() {
        const pref = await getProviderPreference();
        if (pref) {
            this.elements.providerSelect.value = pref || 'auto';
        }
        if (pref === 'openrouter') {
            await this.loadOpenRouterModels(false);
        }
    }

    private async checkApiKey() {
        try {
            const apiKey = await SecurityManager.getApiKey();
            if (apiKey) {
                this.showMessage('API key loaded successfully', 'success');
                this.elements.classifyBtn.removeAttribute('disabled');
            } else {
                this.showMessage('Please configure your API key', 'info');
                this.elements.classifyBtn.setAttribute('disabled', 'true');
            }
        } catch (error) {
            this.showMessage('Error loading API key', 'error');
            this.elements.classifyBtn.setAttribute('disabled', 'true');
        }
    }

    private async saveApiKey() {
        const apiKey = this.elements.apiKeyInput.value.trim();
        if (!apiKey) {
            this.showMessage('Please enter a valid API key.', 'error');
            return;
        }

        // Show loading state
        this.elements.saveApiKeyBtn.textContent = 'Saving...';
        this.elements.saveApiKeyBtn.setAttribute('disabled', 'true');
        
        try {
            await SecurityManager.storeApiKey(apiKey);
            this.showMessage('API key saved successfully!', 'success');
            this.elements.apiKeyInput.value = '';
            this.elements.classifyBtn.removeAttribute('disabled');
            if (this.elements.providerSelect.value === 'openrouter') {
                await this.loadOpenRouterModels(true);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to save API key';
            this.showMessage(`Error: ${errorMessage}`, 'error');
        } finally {
            // Reset button state
            this.elements.saveApiKeyBtn.textContent = 'Save API Key';
            this.elements.saveApiKeyBtn.removeAttribute('disabled');
        }
    }

    private async onProviderChange() {
        const val = this.elements.providerSelect.value;
        await setProviderPreference(val === 'auto' ? '' : val);
        if (val === 'openrouter') {
            await this.loadOpenRouterModels(false);
        } else {
            this.elements.openRouterModelSection.style.display = 'none';
        }
    }

    private async onModelSelected() {
        const modelId = this.elements.openRouterModelsSelect.value;
        if (modelId) {
            await setSelectedOpenRouterModel(modelId);
            this.elements.modelStatus.textContent = `Selected: ${modelId}`;
        }
    }

    private async loadOpenRouterModels(force: boolean) {
        this.elements.openRouterModelSection.style.display = 'block';
        this.elements.modelStatus.textContent = 'Loading models...';
        this.elements.openRouterModelsSelect.innerHTML = '<option value="">Loading...</option>';
        try {
            const apiKey = await SecurityManager.getApiKey();
            if (!apiKey) {
                this.elements.modelStatus.textContent = 'Enter and save API key first.';
                return;
            }
            const models = await fetchOpenRouterModels(apiKey, force);
            if (!models.length) {
                this.elements.modelStatus.textContent = 'No models available.';
                return;
            }
            this.elements.openRouterModelsSelect.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name || m.id;
                this.elements.openRouterModelsSelect.appendChild(opt);
            });
            const selected = await getSelectedOpenRouterModel();
            if (selected && models.some(m => m.id === selected)) {
                this.elements.openRouterModelsSelect.value = selected;
                this.elements.modelStatus.textContent = `Selected: ${selected}`;
            } else {
                this.elements.modelStatus.textContent = 'Select a model';
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to load models';
            this.elements.modelStatus.textContent = msg;
        }
    }

    private async classifyBookmark() {
        this.showProgress('Classifying bookmark...');
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.url || !tab.title) throw new Error('No valid URL or title found.');

            // Create a fresh instance to ensure latest API key is loaded
            const classifier = new LlmClassifier();
            console.log('Starting classification for:', tab.title);
            
            const classification = await classifier.classifyUrl(tab.url, tab.title);
            console.log('Classification result:', classification);
            
            await chrome.runtime.sendMessage({
                action: 'CREATE_BOOKMARK',
                data: { url: tab.url, title: tab.title, classification }
            });
            this.showMessage('Bookmark classified and saved!', 'success');
        } catch (error) {
            console.error('Classification error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.showMessage(`Failed to classify bookmark: ${errorMessage}`, 'error');
        } finally {
            this.hideProgress();
        }
    }

    private showMessage(message: string, type: 'success' | 'error' | 'info' = 'info') {
        // Remove existing notifications
        document.querySelectorAll('.notification').forEach(n => n.remove());
        
        // Update status element
        this.elements.status.textContent = message;
        this.elements.status.className = `status status-${type}`;
        
        // Create toast notification
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.className = 'notification-close';
        closeBtn.onclick = () => notification.remove();
        notification.appendChild(closeBtn);
        
        document.body.appendChild(notification);
        
        // Auto-remove after 4 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
            // Reset status to ready
            if (this.elements.status.textContent === message) {
                this.elements.status.textContent = 'Ready';
                this.elements.status.className = 'status';
            }
        }, 4000);
    }

    private showProgress(message: string) {
        this.elements.progress.style.display = 'block';
        this.elements.progress.querySelector('.progress-text')!.textContent = message;
    }

    private hideProgress() {
        this.elements.progress.style.display = 'none';
    }
}

new PopupController();