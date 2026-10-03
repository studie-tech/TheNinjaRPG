# Retiring the separate AI deployment

MCP runs on the main game at `https://www.theninja-rpg.com/api/mcp`. Its setup is documented in [MCP.md](MCP.md). The main game's data remains persistent; the separate server's monthly wipe route and Vercel cron are removed.

This checklist identifies resources from repository configuration, not a verified cloud inventory. Resolve the actual project/application IDs and compare credentials and consumers before deleting resources. Do not copy the retired server's database or Clerk credentials into the main deployment.

## Cutover order

1. Pause the separate Vercel project and any external schedules that call it, especially `/api/monthly-mcp-reset`, so the retired deployment stops accepting writes. Export any data that needs retention before its next reset.
2. Deploy the consolidation PR to the main game's Vercel project. Keep `DATABASE_URL` connected to PlanetScale `nano-mathias/tnr/main-1`, the main game's Clerk application and its Redis instance. Keep `NEXT_PUBLIC_BASE_URL=https://www.theninja-rpg.com`.
3. Configure main-game Clerk OAuth onboarding as described in [MCP.md](MCP.md). Check both discovery documents return JSON with the main game's resource URL and Clerk authorization server. Connect a real OAuth client, list routers, inspect `profile.getUser`, and read the signed-in account. Verify an unauthenticated MCP request is rejected and a non-staff account cannot perform a staff action. Use a harmless reversible action to check mutations. Check normal login, signup and both landing-page layouts.
4. Change saved MCP client URLs to the main game and authenticate again. Accounts/tokens from a separate Clerk application do not automatically become main-game accounts. No player-data merge is implemented by this PR.
5. After the main-game connection works and retention exports are secured, remove the dedicated resources below. Keep a record of resource IDs and exports outside repository source; verify billing afterward.

## Resources to remove

| Provider | Retired resource / action | Resources to preserve |
| --- | --- | --- |
| Vercel | Identify the project owning `www.theninja-rpg.ai` in Domains; pause it first, then delete that project from Settings after cutover. Remove its deployment aliases, domain assignments, cron jobs, project-scoped environment variables and integrations. Verify apex `theninja-rpg.ai` too. See [Vercel project management](https://vercel.com/docs/projects/managing-projects). | The main game's `tnr` project, production/preview deployments, main domain and ordinary game crons. |
| PlanetScale | In organization `nano-mathias`, export required data from `theninja-ai/main` to storage outside the database, verify the export, then remove dedicated database credentials, webhooks/integrations and the `theninja-ai` database once no consumer remains. If deletion protection is enabled, disable it for the retired resource only; see [PlanetScale deletion protection](https://planetscale.com/changelog/database-and-branch-deletion-protection). Do not rely on in-service backups surviving database deletion. | `tnr/main-1` and `tnr/development`, their credentials and backups. |
| Clerk | Identify the application/instance whose domains and publishable key served the AI site. Revoke its dedicated OAuth clients/tokens, remove its domain/callback configuration and webhooks, and delete the application only if it is exclusive to the retired deployment and any identity retention is complete. If shared, remove only the AI site's configuration. | The main game's Clerk application, keys, native authentication and main-game OAuth clients. |
| DNS / registrar | Remove AI-site A/AAAA/CNAME records and AI-only Clerk DNS records after domain removal, or deliberately retain a redirect/retirement page on a separate minimal host. Old MCP clients must change URLs and reauthenticate; do not rely on an HTTP redirect for OAuth migration. Disable AI-domain renewal only if the domain itself is to be relinquished. | All `.com` records, main-game Clerk records and other unrelated subdomains. |
| Upstash | Inspect the retired project's `UPSTASH_REDIS_REST_URL` to identify its Redis database. Delete it and its integration only if exclusive to the AI deployment; otherwise retain it and remove dedicated credentials where supported. See [Upstash database deletion](https://upstash.com/docs/devops/developer-api/redis/delete_database). | Main-game Redis, used for tRPC and MCP rate limits and other game functions. |
| Pusher / realtime | Identify AI-only apps by the retired project's Pusher keys; remove dedicated apps and webhooks after checking consumers. Inspect any separate SpacetimeDB module configured there as well. | Main-game Pusher/soketi and Tower Defense SpacetimeDB resources. |
| Storage / CDN | Inspect UploadThing apps, Bunny zones/storage, and any Vercel storage linked exclusively to the retired project. Archive needed assets and remove only AI-exclusive resources after checking references from the main game. | Shared game assets, uploads and the main game's Bunny static-asset pull zone. |
| Monitoring / integrations | Remove AI-only Sentry projects/alerts, analytics streams, uptime checks, external schedulers, webhook destinations and dedicated API keys for SendGrid, Replicate, OpenAI or other providers. Inspect PayPal/webhook registrations if the retired project had its own. Cancel dedicated subscriptions after checking for shared consumers. | Shared accounts, main-game integrations, payment hooks and production monitoring. |

The repository does not establish whether the last five provider groups have separate billable resources. Treat them as dashboard checks, not instructions to delete shared services.

## Remove stale configuration

Remove `NEXT_PUBLIC_MCP_ENABLED` and `AI_DATABASE_URL` from Vercel production/preview/development settings, CI secrets and local environment files. Neither is used by the application. The staff backup sync now targets only `DEV_DATABASE_URL`; keep that development credential.

Remove external schedules and checks for `/api/monthly-mcp-reset`. Do not repoint that old reset job at the main game. The removed route should return `404` after deployment, and the cron must be absent from the main project's schedule list. Other monthly game resets are independent and remain configured.

Keep shared organization-level credentials unless you have verified they belong exclusively to the retired project. If a retired deployment held shared secrets, first remove all accessible old deployments and then rotate affected credentials through their existing main-game configuration procedure.

## Recovery boundary

Until deletion, the paused AI project and its exported configuration can be retained for recovery. Its monthly wipe must remain disabled if it is resumed. After deleting the database or Clerk application, recovery requires verified external exports and a separately planned restore; reverting Git does not restore cloud data. Do not redeploy an older revision to the main game with stale MCP flags: the retired reset code must never be paired with the main database.
