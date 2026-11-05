import { clerkClient } from "@clerk/nextjs/server";
import { isClerkNotFound, normalizeClerkProvider } from "@/server/utils/clerk";

/**
 * Discord tokens from the player's Clerk Discord sign-in. Clerk signs in with the same
 * Discord application as linking (see docs/DiscordLinking.md), so once its Discord
 * connection requests `role_connections.write`, its token can push Linked Roles metadata and
 * a link needs no second consent screen. Clerk stores and refreshes that token; the game
 * never stores or revokes it.
 */

export const isClerkDiscordProvider = (provider: string) =>
  normalizeClerkProvider(provider) === "discord";

export type ClerkDiscordToken = {
  accessToken: string;
  scopes: string[];
  /** Discord user id of the Clerk external account the token belongs to. */
  discordId: string;
};

/**
 * Clerk's current Discord access token for a user, or null when the user has no Discord
 * sign-in (or not the given Discord account) or Clerk holds no token for it. Matching the
 * token to the external account keeps a token for a different Discord account, connected
 * after the link was made, from ever being used for the link.
 */
export const fetchClerkDiscordToken = async (
  userId: string,
  discordId?: string,
): Promise<ClerkDiscordToken | null> => {
  try {
    const clerk = await clerkClient();
    const [user, tokens] = await Promise.all([
      clerk.users.getUser(userId),
      clerk.users.getUserOauthAccessToken(userId, "discord"),
    ]);
    const account = user.externalAccounts.find(
      (entry) =>
        isClerkDiscordProvider(entry.provider) &&
        (!discordId || entry.providerUserId === discordId),
    );
    if (!account) return null;
    const token = tokens.data.find((entry) => entry.externalAccountId === account.id);
    if (!token?.token) return null;
    return {
      accessToken: token.token,
      scopes: token.scopes ?? [],
      discordId: account.providerUserId,
    };
  } catch (error) {
    if (isClerkNotFound(error)) return null;
    throw error;
  }
};
