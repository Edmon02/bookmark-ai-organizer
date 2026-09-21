# AI Bookmark Organizer

AI-powered Chrome extension that classifies and organizes bookmarks using your preferred LLM provider.

## About

AI Bookmark Organizer helps you keep browser bookmarks clean and searchable with one-click AI classification, confidence-aware reclassification, and optional auto-classification for newly saved bookmarks.

### Core principles
- Privacy-first by default (API key stored locally on your device).
- Clear, non-technical UX with actionable feedback.
- Safe automation with explicit controls and robust fallbacks.

## Highlights (v1.2.0)

- One-click `Classify & Save` with folder and tag suggestions.
- Rich feedback after every action:
  - bookmark affected
  - destination folder
  - tags
  - confidence score
  - provider + model used
- Re-classify any newly saved bookmark with a different model from the details modal.
- Optional auto-classify for newly created bookmarks.
- OpenRouter model picker with cache, refresh, retry, and stale-fallback support.

## Provider Support

- Auto Detect
- OpenRouter
- OpenAI
- Groq
- Moonshot (Kimi)
- Grok

## Quick Start

1. Install dependencies
   ```bash
   bun install
   ```
2. Build extension
   ```bash
   bun run build
   ```
3. Load unpacked extension
   - Open `chrome://extensions/`
   - Enable Developer Mode
   - Click `Load unpacked`
   - Select the `dist` directory
4. Open the popup and complete onboarding with your API key.

## How It Works

1. Popup sends typed runtime actions to the MV3 service worker.
2. Service worker validates payloads and runs classification.
3. Bookmark operations happen through `chrome.bookmarks`.
4. State persists in `chrome.storage.local` and rehydrates on popup reopen.
5. Popup renders clear status + detailed result UI.

## Security & Reliability

- API key persistence is local-only (`chrome.storage.local`).
- Popup no longer needs to read raw key values for day-to-day actions.
- Runtime message payload validation and URL protocol checks are enforced.
- OpenRouter model fetches include timeout + retry/backoff (`429/5xx`) + stale-cache fallback.
- Legacy sync key migration is handled defensively.
- Host permissions are constrained to supported provider endpoints.

## Settings

- Provider preference (`Auto Detect` or manual provider).
- OpenRouter model selection (persisted across popup reopen).
- Auto-classify toggle for newly created bookmarks.
- Theme toggle (`Auto`/`Dark` behavior via `ui_theme`).

## Development

### Scripts
- `bun run type-check` - TypeScript checks.
- `bun run test` - unit tests.
- `bun run build` - production webpack build.
- `bun run build:store` - clean, build, and package `extension.zip`.
- `bun run release:notes -- <version>` - generate release notes from changelog.

### Test coverage includes
- Bookmark creation/move/path behavior.
- API key validation + migration behavior.
- OpenRouter cache/retry/fallback behavior.

## Release Workflow

1. Update `CHANGELOG.md`.
2. Bump versions in `manifest.json` and `package.json`.
3. Run:
   ```bash
   bun run type-check
   bun run test
   bun run build
   ```
4. Create release artifact:
   ```bash
   bun run build:store
   ```
5. Open PR and publish release notes.

See `RELEASING.md` for the full release process.

## License

Licensed under Apache 2.0. See `LICENSE` and `NOTICE`.