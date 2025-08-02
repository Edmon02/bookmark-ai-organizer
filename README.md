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