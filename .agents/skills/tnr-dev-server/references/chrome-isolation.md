# Isolated Chrome tests

Use Chrome DevTools MCP with the installed Google Chrome for disposable-account UI
tests. The server's `--isolated` option creates a temporary user-data directory per MCP
process and removes it when that browser closes. It avoids the default shared
`chrome-profile` directory. It does not attach to the personal Chrome profile.

## Connection setup

Configure the host's `chrome-devtools` MCP server to use its installed Node runtime and
Chrome DevTools MCP entrypoint, with `--isolated`. Prefer a fixed installed version over
downloading a package on every connection. Ensure the command exists in the MCP host's
PATH, or use an absolute path. Optional `--no-usage-statistics` and
`--no-performance-crux` disable tool telemetry and trace-URL lookups.

In the desktop app's combined settings, open **Settings → Plugins → MCPs**. Select the
execution host that owns the configuration (normally **Local**) and find `chrome-devtools`
under **Servers**. **Hooks** configures lifecycle handlers and does not manage browser
connections.

Configuration changes require reloading the MCP connections; existing connections keep
their original options. The **Restart** control in the Servers header restarts the
selected host's app server and its MCP connections, rather than one browser server.
Use it when active tool work can be interrupted.

## Account and page isolation

1. Start or reuse this worktree's server with `make dev-up`. Read `browserSession` and
   `url` from `make dev-status`. Provision disposable users through `make dev-user`.
2. Create each actor's page with `new_page`, setting `isolatedContext` to
   `<browserSession>-<chat ID>-<actor key>`. Never omit this argument or reuse another
   chat's context name. Tabs with the same context name share cookies and storage;
   different names separate them. Use `background: true` when supported.
3. Navigate only that actor's page to their private `loginUrl`, then check the visible
   username against the broker artifact. Do not print tickets or passwords. Use
   `http://localhost:<port>` for every app page.
4. Keep the returned page IDs and supply `pageId` on tools that accept it. When a tool
   requires a selected page, select your own page explicitly. Do not rely on whichever
   page another operation selected. Use a second context for a second simultaneous user.
5. After signing in another actor, recheck both visible usernames before collecting
   evidence. A context name confirms storage separation, not that sign-in succeeded.

Isolated browser storage does not isolate the shared database. Keep generated users and
scenario data distinct across worktrees; avoid resetting another chat's explicit run ID.

## Cleanup

Close only pages created by this chat. If Chrome DevTools refuses to close the browser's
last page, navigate that owned page to `about:blank` so its ticket or game screen is not
left visible; the temporary profile is cleaned up when its owning MCP process exits.
Do not disconnect a shared MCP process to remove one context. These sessions are
ephemeral, so provision a fresh ticket when reconnecting rather than expecting a saved
login. Isolation in the DevTools connection does not isolate extension tabs.
