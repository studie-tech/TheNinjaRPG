/**
 * Register the Linked Roles metadata schema of the Discord application, so the server's
 * Verified Ninja role can require "Linked ninja" (and optionally a minimum character level).
 * Run it once per application, and again whenever ROLE_CONNECTION_METADATA changes.
 *
 * Usage (reads DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN from app/.env or the environment):
 *   make discord-register-metadata
 *   bun run discord:register-metadata
 */
import {
  ROLE_CONNECTION_METADATA,
  registerRoleConnectionMetadata,
} from "@/server/utils/discord/rest";

const clientId = process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
if (!clientId || !botToken) {
  console.error("DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN must be set.");
  process.exit(1);
}

const registered = await registerRoleConnectionMetadata({ clientId, botToken });
console.log("Registered Linked Roles metadata:");
console.log(JSON.stringify(registered ?? ROLE_CONNECTION_METADATA, null, 2));
