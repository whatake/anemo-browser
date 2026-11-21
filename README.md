# Anemo

A privacy-first, keyboard-driven desktop browser with a tree of tabs, isolated workspaces, hibernation, ad/tracker blocking and a local-AI assistant.

**Phase 1 — Core Shell** is implemented: Electron main process, SQLite storage, tree tabs with hibernation, workspace partitions, privacy engine, typed IPC bridge and the React/Tailwind chrome UI.

## Stack

- Electron 45 with `BaseWindow` + `WebContentsView` (no `<webview>` tags)
- TypeScript (strict) main/preload + React 19 chrome UI with Tailwind CSS 4
- Vite for the renderer, esbuild for main/preload
- `better-sqlite3` at `~/.anemo/anemo.db`
- JSON config at `~/.anemo/config.json`, watched live
- `@ghostery/adblocker-electron` per workspace partition

## Setup

```bash
npm install
npm run dev       # Vite HMR + Electron, restarts on main/preload edits
```

Production build / run:

```bash
npm run build
npm start
```

Checks:

```bash
npm run typecheck   # main, preload, shared and renderer
npm run smoke:db    # migrations, tree, hibernation, history, bookmarks
```

`better-sqlite3` 13 ships ABI-independent prebuilds, so no native rebuild is normally needed. If your platform loads the wrong binary, `npm run rebuild` compiles it against Electron's ABI (requires a C++ toolchain) and `npm rebuild better-sqlite3` switches it back for the Node-based smoke test.

## Architecture

```
src/
  main/
    index.ts                app bootstrap, window, lifecycle
    ipc.ts                  validated IPC handlers
    tabs/TabManager.ts      tree, partitions, hibernation, view lifecycle
    network/PrivacyEngine.ts adblocker, GPC headers, media sniffer
    storage/Database.ts     schema + migrations (PRAGMA user_version)
    ai/LocalBridge.ts       Ollama/OpenAI-compatible streaming + webhooks
    config/ConfigStore.ts   JSON config + file watcher
    export/markdown.ts      dependency-free HTML→Markdown
  preload/index.ts          contextBridge, typed window.anemo API
  renderer/                 React chrome UI
  shared/                   types, IPC contract, URL helpers
```

Every page runs in a `WebContentsView` with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. Windows open through `setWindowOpenHandler` become **child tabs**, which is what builds the browsing tree. Each workspace gets its own `persist:workspace_<id>` session, so cookies, cache and storage never cross workspace boundaries.

Only the active tab owns a visible view. Selecting a hibernated tab recreates its view and restores the saved URL/scroll position; hibernating destroys the view and persists `url`, `title`, `favicon`, scroll offset and tree position in SQLite. Every tab starts hibernated on launch and only the active tab wakes.

## Configuration

`~/.anemo/config.json` is created on first run and watched for edits:

```json
{
  "searchEngine": "https://duckduckgo.com/?q={query}",
  "autoHibernateMinutes": 30,
  "ai": {
    "enabled": true,
    "provider": "ollama",
    "baseUrl": "http://127.0.0.1:11434",
    "model": "llama3.2",
    "apiKey": "",
    "webhookUrl": ""
  },
  "privacy": {
    "blockAdsAndTrackers": true,
    "sendGlobalPrivacyControl": true
  }
}
```

- `provider` is `ollama` or `openai` (any OpenAI-compatible `/chat/completions` endpoint).
- `webhookUrl` receives a JSON POST after each completed AI answer — leave empty to disable.
- Set `autoHibernateMinutes` to `0` to disable idle hibernation. Active tabs and tabs playing audio are never auto-hibernated.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ + K` | Command palette |
| `Ctrl/⌘ + L` | Focus omnibox |
| `Ctrl/⌘ + T` | New tab |
| `Ctrl/⌘ + W` | Close tab |
| `Ctrl/⌘ + R` | Reload |
| `Ctrl/⌘ + B` | Toggle sidebar |
| `Ctrl/⌘ + J` | Local AI panel |
| `Ctrl/⌘ + E` | Export page as Markdown |
| `Ctrl/⌘ + Shift + H` | Hibernate inactive tabs |
| `Ctrl/⌘ + Shift + F` | Toggle chromeless mode |
| `Alt + ← / →` | Back / forward |
| `Esc` | Close palette/drawer |

Shortcuts are captured inside page views through `before-input-event`, so they work without clicking the chrome first. In chromeless mode use `Ctrl/⌘ + Shift + F` or `Ctrl/⌘ + K` to get the chrome back.

## Privacy

- No telemetry, analytics, accounts, cloud sync or external auto-updaters.
- Ghostery ad/tracker lists are applied to every workspace session.
- Requests carry `DNT: 1` and `Sec-GPC: 1`; `X-Client-Data` is stripped.
- Permissions default to deny (fullscreen, clipboard write and pointer lock are allowed).
- AI requests go only to the endpoint configured by the user.
