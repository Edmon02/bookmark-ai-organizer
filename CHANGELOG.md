# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and adheres to Semantic Versioning (SemVer).

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
4. Build extension: `npm run build`.
5. Smoke test classification with at least 2 providers.
6. Create git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push --tags`.
7. Package zip for store: `npm run build:store`.
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