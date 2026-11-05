import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DISCORD_MAX_CHARACTERS_PER_ACCOUNT,
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";

/** The limits a player accepts by linking a Discord account. */
export const DiscordLinkRules: React.FC = () => (
  <ul className="list-disc pl-5 text-muted-foreground text-sm">
    <li>
      One Discord account per character; a Discord account can link up to{" "}
      {DISCORD_MAX_CHARACTERS_PER_ACCOUNT} characters.
    </li>
    <li>Discord accounts must be at least {DISCORD_MIN_ACCOUNT_AGE_DAYS} days old.</li>
    <li>
      After unlinking, linking a different Discord account takes{" "}
      {DISCORD_UNLINK_COOLDOWN_DAYS} days, and unlinked characters count toward the
      limit for as long.
    </li>
    <li>Indefinite bans and silences in the game also apply on Discord.</li>
  </ul>
);

/** Starts the Discord OAuth flow. A plain anchor: the route redirects off-site. */
export const DiscordAuthorizeButton: React.FC<{ label: string }> = ({ label }) => (
  <Button asChild className="gap-2">
    <a href="/api/discord/authorize">
      <Link2 className="h-4 w-4" />
      {label}
    </a>
  </Button>
);
