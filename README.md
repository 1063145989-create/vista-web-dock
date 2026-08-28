# VISTA Web Dock Extension

Chrome / Edge Manifest V3 extension that makes the VISTA workspace the browser new-tab page.

## Load locally

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Enable Developer mode.
3. Select Load unpacked and choose this `web-dock` folder.
4. Open a new tab to use VISTA as the workspace.

## Included

- New-tab workspace: the existing Dock, groups, search, timeline, Stack, background, and flow field.
- Toolbar popup: collect the active HTTP(S) page into the inbox and open the workspace.
- Bookmark import: available only within the installed extension.
- Local-first data: workspace data is held in `chrome.storage.local`; no backend or account is required.

## Privacy

The service worker increments a visit count only for sites already collected in VISTA. It does not transmit browsing data and does not record pages that have not been collected.
