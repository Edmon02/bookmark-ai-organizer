# AI Bookmark Organizer

A Chrome extension that uses an AI (Grok or Moonshot) to classify and organize bookmarks.

## 🚀 Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Build Extension**
   ```bash
   npm run build
   ```

3. **Load Extension**
   - Open `chrome://extensions/`
   - Enable Developer Mode
   - Load `dist` folder

4. **Configure API Key**
   - Obtain a Grok API key from https://x.ai/api
   - Enter in the extension's Settings panel

## 📋 Features
- One-click URL classification
- Automatic bookmark folder creation
- Secure API key storage
- Simple and intuitive UI

## 🔒 Privacy
- All data processed locally except for LLM API calls.
- API keys are stored securely using Chrome Storage.

## 🛠️ Troubleshooting
- Ensure a valid API key is configured.
- Check internet connectivity for API calls.

Organize bookmarks automatically using an AI classifier that infers folder hierarchy and tags.

## New: OpenRouter Provider & Model Selection
You can now select `OpenRouter` as a provider and choose from its available models.

### How It Works
1. Open the extension popup and expand `Settings`.
2. Enter and save your API key (OpenRouter keys usually begin with `sk-or-v1-`).
3. Choose `OpenRouter` in the `Provider` dropdown (or leave on `Auto Detect`).
4. When `OpenRouter` is selected, a model dropdown appears. The extension fetches models from `https://openrouter.ai/api/v1/models`.
5. Pick a model—your choice is persisted and used for subsequent bookmark classifications.

### Caching
- Model list cached for 15 minutes in `chrome.storage.local`.
- Manual refresh available via the ↻ button.
- If fetching fails, a stale cached list (if present) is used.

### Error Handling
| Scenario | Behavior |
|----------|----------|
| Invalid key (401) | Displays error in model status; keeps stale list if available |
| Rate limit (429) | Shows rate limit message; does not clear existing list |
| Network failure | Falls back to cached list; marks status accordingly |
| No models returned | Displays "No models available" |
| No key saved yet | Prompts to save API key before loading models |
| Deprecated / 404 model | Automatically clears selection, chooses fallback stable model, retries once |

### Security Notes
- API key stored (base64 encoded) in `chrome.storage.sync` (demo purpose—replace with stronger encryption for production).
- Model metadata trimmed to essentials (id, name, description, context length, architecture reference).
- No API keys or raw model lists are sent to analytics (future telemetry will hash model IDs if needed).

### Selecting Other Providers
If you choose another provider (OpenAI, Groq, Moonshot, Grok) or `Auto Detect`, the OpenRouter model UI is hidden. Auto detection still works based on key pattern if you prefer not to select a provider manually.

## Development
Install dependencies and build:
```bash
npm install
npm run build
```
Load the `dist` directory as an unpacked extension in Chrome.

## Fallback Strategy
If the selected OpenRouter model returns a 404 (e.g., alpha/stealth model retired), the extension:
1. Clears the invalid selection.
2. Fetches the current model list.
3. Chooses the first available from a preference list: `openai/gpt-4o-mini`, `openai/gpt-4o`, `anthropic/claude-*`, `google/gemini-*`, `meta/llama-*`.
4. Persists the new model and retries classification once.

If no model can be chosen, classification fails with a descriptive error.

## Optional Enhancements (Not Yet Implemented)
- Search/filter in large model lists.
- Pagination or grouping (OpenRouter may expose many models).
- Model capability badges (e.g., context size, vision support).
- Analytics events for model fetch success/failure and selection changes.
- Fallback model heuristics (auto choose nearest GPT-4 / Claude class if selection invalid).

## Testing
Run unit tests:
```bash
npm test
```

## Acceptance Criteria Summary
- Provider dropdown appears in settings.
- Selecting `OpenRouter` triggers model fetch (with caching + manual refresh).
- Model selection persisted and applied to classification calls.
- Graceful handling of 401, 429, offline, and empty responses.
- No runtime TypeScript errors in modified files.

## License
Licensed under the Apache License, Version 2.0. See `LICENSE` file for details.

"AI Bookmark Organizer" is distributed on an "AS IS" basis without warranties or conditions of any kind.