# Contributing

Thanks for helping improve Claude Switcher.

## Before you start

1. Check existing issues and pull requests before opening a duplicate.
2. Keep changes focused and explain user-visible behavior.
3. Never include credentials, cookies, account exports, or other personal data
   in issues, screenshots, commits, or pull requests.

## Local checks

Install dependencies and run the syntax checks:

```bash
npm install
node --check main.js
node --check preload.js
node --check renderer.js
```

## Pull requests

Please include:

- A short summary of the change
- How it was tested
- Screenshots for visible UI changes
- Any privacy or data-storage implications

Use small, descriptive commits where practical. Do not commit generated
directories such as `node_modules`, `out`, `dist`, or `release`.
