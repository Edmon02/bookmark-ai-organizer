# AI Bookmark Organizer

AI-powered Chrome extension for saving, finding, and reorganizing bookmarks with natural language.

## Features

- Classify the current page into a bookmark folder path with AI-generated tags.
- Detect when the current page is already saved and show its bookmark path immediately.
- Reveal the saved bookmark directly in `chrome://bookmarks/`.
- Search bookmarks by describing the page in plain language.
- Chat with your bookmark library to find, review, and reorganize items.
- Require explicit Apply confirmation before any AI-suggested bookmark change is executed.
- Support OpenRouter, OpenAI, Groq, Moonshot, Grok, or auto-detected providers.

## Quick Start

1. Install dependencies:
   ```bash
   bun install
   ```
2. Build the extension:
   ```bash
   bun run build
   ```
3. Open `chrome://extensions/`, enable Developer Mode, and load the `dist` folder as an unpacked extension.
4. Open the popup, save your API key, and optionally choose a provider and model.

## Using The Extension

### Save the current page

- Open the popup on any page.
- If the page is already bookmarked, the popup shows where it is saved and enables `Reveal`.
- If the page is not saved, click `Classify & Save`.

### Search by description

Open `Search & AI Chat`, then describe the page you want to find. Example prompts:

- `an article about climate policy I saved last month`
- `the React docs page about hooks`
- `that GitHub repo for Chrome extension examples`

### Chat with bookmarks

The chat view is designed for search and safe reorganization. Example prompts:

- `Show me the top 10 most organized bookmarks`
- `Find the bookmark about TypeScript decorators`
- `Move my Python bookmarks into a new folder called Learning / Python`
- `Which bookmarks are deeply nested and should probably be simplified?`

Bookmark edits are proposed first. Nothing changes until you click `Apply`.

## OpenRouter Notes

- The model list is cached for 15 minutes in `chrome.storage.local`.
- The picker filters out obviously batch-only or non-chat models.
- If the selected model returns a 404 or cannot serve chat requests, the extension clears that selection, picks a stable fallback model, persists it, and retries once.

## Development

Run the main development commands with Bun:

```bash
bun run type-check
bun run test
bun run build
```

## Release Notes

Generate release notes for a version from `CHANGELOG.md`:

```bash
bun run release:notes -- 1.2.0
```

## Privacy

- Bookmark operations happen locally in the extension.
- Only the selected AI provider receives bookmark metadata needed for classification, search, or chat.
- API keys are currently stored in Chrome storage using base64 encoding. This is acceptable for local development, but stronger encryption should be added before a production-grade release.

## License

Licensed under the Apache License, Version 2.0. See `LICENSE` for details.