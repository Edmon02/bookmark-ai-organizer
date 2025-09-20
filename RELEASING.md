# Releasing

This document describes how to create a new release of AI Bookmark Organizer.

## 1. Versioning
Semantic Versioning is used: MAJOR.MINOR.PATCH.

Guidelines:
- Increment MINOR for new features (e.g., provider additions, UI enhancements) that don't break existing functionality.
- Increment PATCH for bug fixes / internal improvements.
- Reserve MAJOR for breaking storage schema changes or required new permissions in `manifest.json`.

## 2. Prepare the Release
1. Update `CHANGELOG.md` with a new section (unreleased changes moved under the new version heading). Date: YYYY-MM-DD.
2. Bump `version` in `package.json` accordingly.
3. Ensure tests & type checks pass:
```bash
npm ci
npm run type-check
npm test -- --passWithNoTests
```
4. Build locally & smoke test:
```bash
npm run build
```

## 3. Tag and Push
Create an annotated tag:
```bash
git add .
git commit -m "chore: release v1.2.0"
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin main --follow-tags
```

Pushing the `vX.Y.Z` tag triggers the GitHub Actions release workflow (`.github/workflows/release.yml`).

## 4. Automated Workflow Actions
The workflow will:
1. Install dependencies
2. Type check & run tests
3. Build & package the extension (`extension.zip`)
4. Extract release notes from `CHANGELOG.md`
5. Create a GitHub Release attaching `extension.zip`

## 5. Manual Release (Fallback)
If automation fails:
1. Run locally:
   ```bash
   npm ci
   npm run build:store
   ```
2. Draft a release at: GitHub UI → Releases → Draft new release.
3. Upload `extension.zip` and paste the relevant `CHANGELOG` section.

## 6. Generating Release Notes Locally
```bash
npm run release:notes -- 1.1.0
```

## 7. Post-Release Tasks
- Announce new features (if applicable).
- Open issues / milestones for upcoming iteration.
- Monitor for regression reports.

## 8. Future Automation Ideas
- Auto-open PR for version bump & changelog via a bot.
- Validate that CHANGELOG section exists before allowing tag push (pre-push hook or CI job).
- Separate canary/beta channels using `v1.2.0-beta.1` prerelease tags.

## 9. Chrome Web Store Publishing (Manual)
Currently out-of-scope for automation. Use Developer Dashboard to upload the `extension.zip` and follow store review guidelines.

---

Happy releasing!
