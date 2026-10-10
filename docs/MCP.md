# Playing TheNinja-RPG through MCP

The main game provides a Streamable HTTP Model Context Protocol (MCP) server:

```text
https://www.theninja-rpg.com/api/mcp
```

Connect an MCP client that supports remote HTTP servers and OAuth, then sign in with your main-game account through Clerk and approve the connection. Actions affect that account in the persistent game, including combat, purchases, messages and account settings. Review the scope of actions you authorize your assistant to perform.

## Fair play for AI players

With authorization from their human owner, AI players may choose and execute game actions through this official MCP server without approval for each action or the owner remaining continuously present. Follow the server's rate limits, game cooldowns and endpoint permissions; do not bypass limits or restrictions. This official API allowance is governed by those limits rather than the human-sustainable pacing and duration requirement for other AI-assisted play.

All other [game rules](https://www.theninja-rpg.com/rules), including account limits, identification of AI players and their human owner, authorized information access, bug reporting and conduct, still apply. The human owner remains responsible for the account. Outside the official API allowance, automated play and scripted presence remain prohibited, even under human supervision.

API and MCP clients accessing the official server within this allowance are authorized tools. Each human owner may own up to two accounts in total, including AI-played accounts; using multiple agents or clients does not increase that limit. Permitted AI play does not count as sharing with another human player. Multiple accounts on the same IP must still be reported to moderators, but a shared IP, including shared API hosting, does not by itself establish account sharing or common ownership.

## Client setup

Use an up-to-date client with **Streamable HTTP and OAuth** support. No game checkout or local game server is needed. Pick your client below, add the server, then complete browser sign-in with the main-game account you want the assistant to use. Your AI-provider login and your game login are separate.

| Setting | Value |
| --- | --- |
| Server name | `theninja-rpg` |
| Server URL | `https://www.theninja-rpg.com/api/mcp` |
| Transport | Streamable HTTP (called `http` or `remote` by some clients) |
| Authentication | OAuth through the main game's Clerk sign-in |

Never put game passwords, Clerk secret keys or database credentials into client configuration. Merge configuration examples into existing files; keep your other servers and settings.

<details>
<summary><strong>Claude Code — terminal setup</strong></summary>

Run these commands in your terminal:

```sh
claude mcp add --transport http --scope user theninja-rpg https://www.theninja-rpg.com/api/mcp
claude mcp get theninja-rpg
claude
```

Inside Claude Code, enter `/mcp`, select `theninja-rpg`, and follow the authentication prompt. Sign in to the game in the browser and approve the connection, then return to Claude Code.

`--scope user` makes this personal connection available across projects. Use `--scope project` instead if you want the server definition in a project's `.mcp.json`; each person still authenticates separately.

**Check:** `/mcp` should show the server connected. Try the [first connection prompt](#check-your-first-connection).

[Official Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

</details>

<details>
<summary><strong>Claude Desktop — remote connector setup</strong></summary>

1. Open **Customize → Connectors** in Claude Desktop or [Claude's connector settings](https://claude.ai/customize/connectors).
2. Choose **+ Add → Add custom connector**. Enter `TheNinja-RPG` as the name and `https://www.theninja-rpg.com/api/mcp` as the remote server URL.
3. Continue through the detected authentication settings. Choose **Sign in now**. If an OAuth client choice appears, choose **Register automatically** for Clerk DCR. **Use Claude's published identity** requires the game's Clerk application to support CIMD.
4. Finish adding the connector and complete the game's browser sign-in and consent flow. If it appears disconnected, choose **Connect**.
5. In a conversation, open **+ → Connectors** and enable **TheNinja-RPG**.

On Team or Enterprise accounts, an authorized organization administrator must add the connector first; members then connect their own game accounts.

**Check:** enable the connector in the conversation and try the [first connection prompt](#check-your-first-connection). This uses a remote connector; editing `claude_desktop_config.json` is unnecessary.

[Official Claude remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

</details>

<details>
<summary><strong>Codex — desktop app setup</strong></summary>

1. Open **Settings → MCP servers**, then **Add server**.
2. Enter `theninja-rpg`, choose **Streamable HTTP**, and enter `https://www.theninja-rpg.com/api/mcp`.
3. Save and use **Restart** when prompted to reload the servers.
4. Select **Authenticate** for `theninja-rpg`. Complete game sign-in and consent in the browser.
5. Open a local Codex conversation and try the [first connection prompt](#check-your-first-connection).

The desktop app and CLI share MCP configuration on the same Codex host. If your app exposes configuration through **config.toml** instead of an add-server form, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.theninja-rpg]
url = "https://www.theninja-rpg.com/api/mcp"
```

Reload the servers and authenticate. You can also use the CLI instructions below to configure the same host. A local configuration does not automatically configure a cloud task or another computer.

[Official OpenAI MCP guide](https://developers.openai.com/codex/mcp).

</details>

<details>
<summary><strong>Codex CLI — terminal setup</strong></summary>

Run these commands in your terminal:

```sh
codex mcp add theninja-rpg --url https://www.theninja-rpg.com/api/mcp
codex mcp login theninja-rpg
codex mcp list
codex
```

The login command starts browser authorization. Sign in to the game and approve the connection. Inside Codex, enter `/mcp` to inspect the active server and tools, then try the [first connection prompt](#check-your-first-connection).

If you already added the server in the desktop app or `~/.codex/config.toml`, skip `mcp add` and run `mcp login` on the same host. `codex mcp list` checks configuration; the read-only prompt below checks authenticated game access.

[Official OpenAI MCP guide](https://developers.openai.com/codex/mcp) and [HTTP server command example](https://developers.openai.com/learn/docs-mcp).

</details>

<details>
<summary><strong>OpenCode — remote server setup (V2 and V1)</strong></summary>

**OpenCode V2:** from the project that should use the game tools, run:

```sh
opencode mcp add theninja-rpg --url https://www.theninja-rpg.com/api/mcp
opencode mcp auth theninja-rpg
opencode mcp list
opencode
```

Add `--global` to `mcp add` to make the connection available across projects. Alternatively, merge this into `opencode.json` or `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "theninja-rpg": {
        "type": "remote",
        "url": "https://www.theninja-rpg.com/api/mcp"
      }
    }
  }
}
```

**OpenCode V1:** server names go directly under `mcp`. Merge this configuration into `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "theninja-rpg": {
      "type": "remote",
      "url": "https://www.theninja-rpg.com/api/mcp"
    }
  }
}
```

Then run `opencode mcp auth theninja-rpg` and `opencode mcp list`.

Keep OAuth enabled. Complete browser sign-in and consent, then try the [first connection prompt](#check-your-first-connection). In V2, `/mcps` also lets you select and authenticate the server.

[Official OpenCode V2 guide](https://opencode.ai/v2/docs/mcp-servers) and [V1 guide](https://opencode.ai/docs/mcp-servers/).

</details>

<details>
<summary><strong>VS Code — HTTP server configuration</strong></summary>

Add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "theninja-rpg": {
      "type": "http",
      "url": "https://www.theninja-rpg.com/api/mcp"
    }
  }
}
```

Start the server, follow the browser sign-in prompt, and enable its tools in your agent conversation.

[Official VS Code MCP guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

</details>

## Check your first connection

After authentication, send this prompt to your assistant:

```text
Use the theninja-rpg MCP server to listGameRouters, listRouterEndpoints for
routerName "profile", and getEndpointSchema for endpointName "profile.getUser".
Then callEndpoint for "profile.getUser" and tell me which game account is signed in.
Only read my profile; do not make changes or take game actions.
```

The assistant should use the game tools and return your main-game account. Tool names may have a client-specific server prefix. If it cannot find the tools, check that the server is enabled in the current conversation and reload or start a new session.

Staff sign in with their own staff game accounts using the same setup. Content editing uses the ordinary game endpoints and preserves staff-level permission checks. Confirm the account first, inspect the endpoint schema, and review the proposed edit before allowing it.

<details>
<summary><strong>Troubleshooting sign-in and connection problems</strong></summary>

| Symptom | What to check |
| --- | --- |
| No tools or server missing | Enable the server/connector in this conversation. Reload the client after changing configuration. Check the correct host, project and configuration format. |
| `401` or authentication required | Complete the client's OAuth sign-in; being logged into the game website alone does not authenticate MCP. Reconnect if the token has expired or been revoked. |
| Wrong game account | Disconnect or sign out of the server in the client, then authenticate again with the intended game account. Confirm it with `profile.getUser`. |
| OAuth client registration fails | Update the client. Ask the game operator to check Clerk client onboarding and callbacks. Claude Desktop's published identity uses CIMD; automatic registration uses DCR. |
| `403` or a game permission rejection | Confirm the signed-in account and required staff role or game prerequisites. Reconnecting cannot grant a missing role. |
| `429` | Wait for the rate-limit window before retrying; avoid parallel polling loops. |
| An HTML page or `404` instead of MCP | Use the exact HTTPS URL ending in `/api/mcp` and the HTTP transport. |

For OpenCode, use `opencode mcp logout theninja-rpg` followed by `opencode mcp auth theninja-rpg` to sign in again. For other clients, use their server authentication controls.

</details>

## Discovering and calling endpoints

The server exposes four tools that discover and invoke every registered game tRPC endpoint:

1. `listGameRouters`: list available routers.
2. `listRouterEndpoints`: supply `routerName`, for example `profile`.
3. `getEndpointSchema`: supply `endpointName`, for example `profile.getUser`, to inspect its arguments.
4. `callEndpoint`: supply `endpointName` and its `input` object when required.

A first read can use `callEndpoint` with `{"endpointName":"profile.getUser"}`. Ask your assistant to inspect schemas before performing mutations. Endpoint metadata supplies descriptions and custom response formats; endpoints without metadata are also available. The underlying tRPC caller enforces the same account authentication, staff permissions, prerequisites and Zod validation as the website. Listing an endpoint does not grant permission to use it.

Authenticated requests are limited to 30 requests per 60 seconds per IP and per user. A `429` means the client should wait before retrying. A connection that cannot authenticate should be reconnected through the client's OAuth flow; game-specific rejections are returned by the endpoint and should be shown to the player.

## Main-game deployment configuration

MCP and both OAuth discovery routes are always enabled; no separate deployment or MCP feature flag is needed:

- `/api/mcp`
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

The routes use the main game's Clerk keys, database and Upstash Redis configuration. Configure OAuth client onboarding in the **main game's** Clerk application according to [Clerk's MCP server guide](https://clerk.com/docs/guides/ai/mcp/build-mcp-server). Register supported clients and their callbacks, or enable the onboarding mechanism required by the client. Clerk documents [CIMD and dynamic client registration](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth); enable DCR only for clients that require it. Keep consent enabled and test authentication using a main-game account.

For local server setup, use `.agents/skills/tnr-dev-server/SKILL.md`. Use your local server's origin for client configuration and confirm OAuth resource/callback origins match it.
