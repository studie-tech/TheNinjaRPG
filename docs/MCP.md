# Playing TheNinja-RPG through MCP

The main game provides a Streamable HTTP Model Context Protocol (MCP) server:

```text
https://www.theninja-rpg.com/api/mcp
```

Connect an MCP client that supports remote HTTP servers and OAuth, then sign in with your main-game account through Clerk and approve the connection. Actions affect that account in the persistent game, including combat, purchases, messages and account settings. Review actions before allowing your assistant to execute them.

## Client setup

In your client's remote MCP server settings, add the URL above. Complete its browser-based authentication flow. Client configuration formats differ; use the client's HTTP/OAuth instructions rather than a local stdio server configuration.

For example, [VS Code supports HTTP MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers). Add this to `.vscode/mcp.json`:

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

Start the server in the client and follow the sign-in prompt. Never put game passwords, Clerk secret keys or database credentials into client configuration.

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
