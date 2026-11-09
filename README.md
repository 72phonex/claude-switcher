# Claude Switcher

Claude Switcher is an Electron desktop workspace for keeping multiple Claude.ai
accounts isolated on one device. Each account uses its own persistent browser
session, so switching accounts does not require signing in again.

## Features

- Separate persistent Claude.ai sessions per account
- Fast account switching from a desktop sidebar
- Account rename, session clearing, and removal controls
- Local token-usage estimates and limit indicators
- Desktop notification when a detected Claude usage limit is restored
- Optional system-tray background mode and launch-at-startup support
- Normal, Balanced, and Ultra-low memory modes control how many inactive account pages stay loaded while visible
- Configurable automatic usage refresh, account health indicators, and keyboard shortcuts
- Privacy-safe settings export/import without cookies or login sessions
- GitHub release checks from inside the app
- Recent Claude chat and project history
- Open the active Claude session in the system browser
- Content Security Policy, context isolation, and disabled renderer Node.js access

## Requirements

- Windows, macOS, or Linux
- Node.js 18 or newer
- An internet connection for Claude.ai

## Run locally

```bash
npm install
npm start
```

Add an account from the sidebar and complete the Claude.ai sign-in flow in
that account's isolated session.

When Claude exposes a future reset time while an account is limited, the app
schedules a local desktop notification for that account. The reminder depends
on Claude showing a parseable reset time; it does not contact a separate
notification service.

## Shortcuts

- `Ctrl+1` through `Ctrl+9`: switch to an account by sidebar order
- `Ctrl+R`: reload the active Claude session

Closing the window keeps the app in the system tray so reminders can continue.
Use the tray menu to reopen the window or quit completely.

Choose a memory mode from the Memory button: Normal keeps all inactive account
pages loaded while the window is visible, Balanced keeps the most recently
used inactive page, and Ultra-low unloads inactive pages. All account pages
unload when the window is minimized or hidden; their login sessions remain
isolated and persistent.

Set automatic usage refresh to every 1, 5, 15, or 30 minutes from the same
Memory settings dialog.

## Privacy

Claude Switcher does not send account names, session data, or usage estimates
to a project server. Account configuration is stored by Electron in the local
application data directory, while Claude.ai cookies remain in each account's
isolated persistent browser partition.

The repository contains no credentials, access tokens, or personal account
data. Do not commit exported cookies, screenshots containing private
information, or local application-data files.

## Development

The application has three runtime layers:

- `main.js` manages windows, isolated sessions, persistence, and IPC handlers.
- `preload.js` exposes the narrow renderer bridge.
- `renderer.js` and `styles.css` provide the account workspace UI.

Before opening a pull request, run:

```bash
node --check main.js
node --check preload.js
node --check renderer.js
```

## Roadmap

- Installer and signed release builds
- Optional configurable reminder lead time
- More detailed session diagnostics
- Automated end-to-end coverage for account switching

## Build installers

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Tagging a commit with a version such as `v1.1.0` triggers the GitHub Actions
release workflow and builds platform-specific artifacts.

## License

No license has been selected yet. Until a license is added, all rights are
reserved by the copyright holder.
