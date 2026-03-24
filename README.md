# Ultimate Markdown Viewer

A pure `HTML` / `CSS` / `JavaScript` Markdown viewer with no backend and no app framework.

The app is designed to stay simple:
- left navigation
- main markdown content area
- no unnecessary chrome
- local browser storage for saved state

## What It Does

- Open individual Markdown files
- Open entire folders of Markdown files
- Keep previously added files and folders in the sidebar
- Render nested folders in the sidebar tree
- Persist sidebar items across refresh
- Detect missing files and strike them through instead of silently removing them
- Support drag and drop into the sidebar
- Sort by add order or by name
- Render Mermaid diagrams
- Zoom and pan Mermaid diagrams
- Remember Mermaid zoom per diagram
- Resize the sidebar and remember its width
- Work offline using local vendored browser libraries
- Send page-view analytics when the app is deployed on Vercel

## How To Use

1. Open [index.html](/Users/suhi/Downloads/Repo/ultimate-md-viewer/index.html) in a modern browser.
2. Use the open icon in the sidebar header.
3. Choose:
   - `File` to add one or more Markdown files
   - `Folder` to add a directory of Markdown files
4. Click any file in the sidebar to display it in the main content area.
5. Expand or collapse folders in the sidebar as needed.
6. Remove items with the `x` button on the right.

You can also drag files or folders into the sidebar.

## Best Browser Support

The viewer is static and has no server requirement, but some features depend on modern browser file APIs.

Best experience:
- Chromium-based browsers such as Chrome, Edge, Arc, Brave

Why:
- file and folder pickers are better supported
- persistent file/folder handles across refresh are more reliable
- deleted-file detection works best with File System Access support

Fallback behavior:
- If full file-system handles are not available, the app still supports basic file input and folder input where the browser allows it
- some persistence behavior may be more limited in non-Chromium browsers

## Mermaid Support

Mermaid blocks in Markdown are rendered automatically.

Supported interactions:
- toolbar zoom in
- toolbar zoom out
- toolbar reset
- mouse wheel zoom
- click and drag pan
- keyboard zoom on the active Mermaid diagram

The Mermaid viewport keeps a fixed box height so zooming does not cause the card height to jump.

## Keyboard Shortcuts

- `Ctrl/Cmd + O`: open file picker
- `Ctrl/Cmd + Shift + O`: open folder picker
- `Ctrl/Cmd + \`: collapse or expand the sidebar
- `+`: zoom in active Mermaid diagram
- `-`: zoom out active Mermaid diagram
- `0`: reset active Mermaid diagram zoom

Mermaid keyboard zoom also works with `Ctrl/Cmd` held.

## Persistence

The app stores UI state in browser storage:
- saved sidebar items
- selected item
- sort mode
- sidebar collapsed state
- sidebar width
- Mermaid zoom state

For file-system-backed items, the app also stores file and folder handles in IndexedDB when the browser supports it.

That allows refresh to keep your sidebar without immediately losing all opened items.

## Vercel Analytics

The app includes Vercel Web Analytics for hosted deployments.

How it works:
- `index.html` defines the `window.va` queue function
- `index.html` loads `/_vercel/insights/script.js`
- page views are tracked automatically when the site is deployed on Vercel with Web Analytics enabled

Important behavior:
- opening [index.html](/Users/suhi/Downloads/Repo/ultimate-md-viewer/index.html) directly still works for the viewer itself
- the analytics script is only expected to resolve on a Vercel deployment
- if you host the app somewhere else, the analytics endpoint will not be available unless you add an equivalent integration for that platform

## What `package.json` Is For

This project runs as plain static files in the browser. It does not need `npm start`, a bundler, or a server to run.

`package.json` is here to track project dependencies.

Vendored browser libraries:
- `dompurify`
- `marked`
- `mermaid`

Hosted integration dependency:
- `@vercel/analytics`

At runtime, the app loads the local files in [vendor](/Users/suhi/Downloads/Repo/ultimate-md-viewer/vendor), not `node_modules`.

So:
- `vendor/` is used by the app
- the Markdown and Mermaid runtime libraries are loaded from local vendored files
- Vercel Analytics is loaded by the script tag in [index.html](/Users/suhi/Downloads/Repo/ultimate-md-viewer/index.html#L1)
- `package.json` and `package-lock.json` are used for dependency version tracking and future updates
- `node_modules/` is only a local install directory and is not needed to run the viewer

## Updating Vendored Libraries

If you want to update the local browser libraries later:

1. Run:

```bash
npm install
```

2. Copy updated browser bundles into `vendor/`

Current vendored files:
- `node_modules/dompurify/dist/purify.min.js` -> `vendor/dompurify.min.js`
- `node_modules/marked/lib/marked.umd.js` -> `vendor/marked.umd.js`
- `node_modules/mermaid/dist/mermaid.min.js` -> `vendor/mermaid.min.js`

3. Commit the updated `vendor/` files and lockfile

If you are only updating Vercel Analytics, there are no vendored files to copy. Updating `package.json` and `package-lock.json` is enough.

## Project Files

- [index.html](/Users/suhi/Downloads/Repo/ultimate-md-viewer/index.html): page structure, vendored library loading, and Vercel Analytics script tags
- [styles.css](/Users/suhi/Downloads/Repo/ultimate-md-viewer/styles.css): layout and visual styling
- [app.js](/Users/suhi/Downloads/Repo/ultimate-md-viewer/app.js): viewer logic, state, file handling, Mermaid behavior
- [vendor](/Users/suhi/Downloads/Repo/ultimate-md-viewer/vendor): local browser dependencies used at runtime
- [package.json](/Users/suhi/Downloads/Repo/ultimate-md-viewer/package.json): dependency metadata for vendored libraries and Vercel Analytics
- [package-lock.json](/Users/suhi/Downloads/Repo/ultimate-md-viewer/package-lock.json): exact dependency lockfile

## Notes

- This app does not use a backend.
- This app does not require a framework.
- This app does not require a build step to run.
- The browser is the runtime.
