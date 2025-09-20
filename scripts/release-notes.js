#!/usr/bin/env node
// Simple release notes extractor from CHANGELOG.md
// Usage: npm run release:notes -- <version>
const fs = require('fs');
const path = require('path');

const versionArg = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!versionArg) {
  console.error('Usage: release-notes <version> (e.g., 1.1.0)');
  process.exit(1);
}
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
if (!fs.existsSync(changelogPath)) {
  console.error('CHANGELOG.md not found');
  process.exit(1);
}
const content = fs.readFileSync(changelogPath, 'utf8');
const regex = new RegExp(`## \\[${versionArg}\\][\\s\\S]*?(?=\n## \\[`);
const match = content.match(regex) || content.match(new RegExp(`## \\[${versionArg}\\][\\s\\S]*$`));
if (!match) {
  console.error('Version section not found in CHANGELOG.md');
  process.exit(1);
}
console.log(match[0]);