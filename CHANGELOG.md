# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and adheres to Semantic Versioning (SemVer).

## [1.2.0] - 2026-04-12
### Added
- Auto-classify toggle for new bookmarks, powered by a background bookmark listener that classifies and moves new saves when enabled.
- Confidence-aware re-classification workflow with a detailed result modal and one-click model override for retries.

### Changed
- Popup now uses background message actions for key save, settings hydration, classification, model listing, and re-classification to keep configuration state consistent across popup reopen.
- Classification feedback was redesigned with richer result summaries and detail views showing bookmark name, destination folder, provider/model, tags, and confidence.

### Fixed
- API key and OpenRouter model persistence now rehydrates reliably in the popup, including stale model messaging when a saved model disappears from OpenRouter.
- Classification actions now return explicit affected-bookmark details so users always know what changed and where.
- Service worker now validates runtime message payloads and URL schemes before classifying or mutating bookmarks.

### Security
- Removed `notifications` permission, added missing Groq host permission, and tightened API key handling to avoid exposing stored keys in popup state.
- Added timeout/retry handling for OpenRouter model fetches with stale-cache fallback to improve resilience against rate limits and transient failures.

## [1.1.1] - 2026-04-12
### Changed
- Unified configuration persistence to `chrome.storage.local` for API key, provider preference, and selected model with automatic migration from legacy synced keys.
- Improved popup settings loading with deterministic latest-request-wins sequencing and live storage change rehydration.

### Fixed
- API key and OpenRouter model settings now persist reliably across popup reopen and reflect immediately in the UI.
- Classification flow now validates background save responses before showing success toasts.
- Classification results now include saved bookmark title, final destination folder, and model confidence in the popup result panel.

### Security
- Removed sensitive API key logging and legacy misleading encryption behavior.
- Hardened popup rendering to avoid HTML injection in toast/result content by using text node rendering for dynamic values.

## [1.1.0] - 2025-09-20
### Added
- OpenRouter provider selection with dynamic model fetch and caching.
- Model selection persistence and manual refresh.
- Automatic fallback model strategy on 404/deprecated models.

### Changed
- Default OpenRouter model updated to `openai/gpt-4o-mini` from deprecated `openrouter/horizon-beta`.

### Fixed
- Handling of missing / deprecated models resulting in classification errors.

## [1.0.0] - 2025-09-20
### Added
- Initial release: bookmark classification, provider auto-detection, secure API key storage, basic UI.

---

## Release Strategy
- Use `MAJOR.MINOR.PATCH` (SemVer).
- Increment `MINOR` for new features (e.g., provider additions, new UI components) that are backward compatible.
- Increment `PATCH` for bug fixes or internal refactors without user-visible feature changes.
- Reserve `MAJOR` for breaking storage schema changes or permission scope changes in the manifest.

### Suggested Future Tags
- 1.1.x: Hardening & analytics events.
- 1.2.0: Model capability filtering & search.
- 1.3.0: Additional providers (Anthropic direct, Google Gemini) if added.

### Release Checklist Template
1. Update dependencies (optional) & run tests.
2. Update `CHANGELOG.md` with new version section.
3. Bump version in `package.json`.
4. Build extension: `bun run build`.
5. Smoke test classification with at least 2 providers.
6. Create git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push --tags`.
7. Package zip for store: `bun run build:store`.
8. Draft release notes (use CHANGELOG content).

### Release Notes Template
```
## vX.Y.Z - YYYY-MM-DD
### Added
- ...
### Changed
- ...
### Fixed
- ...
### Deprecated
- ... (if any)
### Removed
- ... (if any)
### Security
- ... (if any)
```