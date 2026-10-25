"use client";

import { Link2, Star, Unlink } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  DISCORD_MAX_CHARACTERS_PER_ACCOUNT,
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { DISCORD_AUTOMATIC_LINK_TEXT } from "@/libs/discordLink";
import { showMutationToast } from "@/libs/toast";

/** Link status and actions for the signed-in character's Discord account. */
export const DiscordLinkSettings: React.FC = () => {
  const utils = api.useUtils();
  const { data, isPending } = api.discord.getStatus.useQuery();
  const { mutate: unlink, isPending: isUnlinking } = api.discord.unlink.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) await utils.discord.getStatus.invalidate();
    },
  });
  const { mutate: setPrimary, isPending: isSettingPrimary } =
    api.discord.setPrimary.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) await utils.discord.getStatus.invalidate();
      },
    });

  if (isPending) return <Loader explanation="Loading Discord link" />;
  if (!data?.enabled) return null;

  if (!data.link) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm">
          Link your Discord account to unlock the TheNinja-RPG Discord server. Your
          server nickname follows your character name and you receive your village role.
        </p>
        <ul className="list-disc pl-5 text-muted-foreground text-sm">
          <li>
            One Discord account per character; a Discord account can link up to{" "}
            {DISCORD_MAX_CHARACTERS_PER_ACCOUNT} characters.
          </li>
          <li>
            Discord accounts must be at least {DISCORD_MIN_ACCOUNT_AGE_DAYS} days old.
          </li>
          <li>
            After unlinking, linking a different account takes{" "}
            {DISCORD_UNLINK_COOLDOWN_DAYS} days.
          </li>
          <li>
            <Link className="font-bold" href="/privacy#discord">
              What we share with Discord
            </Link>
          </li>
        </ul>
        <Button asChild className="gap-2">
          <a href="/api/discord/authorize">
            <Link2 className="h-4 w-4" />
            Link Discord account
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm">
        Linked to Discord <span className="font-bold">{data.link.discordUsername}</span>{" "}
        since {new Date(data.link.linkedAt).toLocaleDateString()}
        {data.link.sibling && (
          <>
            {" "}
            · also linked: <span className="font-bold">{data.link.sibling}</span>
          </>
        )}
        .{data.link.tokenSource === "CLERK" && ` ${DISCORD_AUTOMATIC_LINK_TEXT}`}
      </p>
      {data.link.sibling && (
        <div className="flex flex-row flex-wrap items-center gap-2">
          <p className="text-muted-foreground text-sm">
            {data.link.isPrimary
              ? "Primary: your server nickname and village role follow this character."
              : `Your server nickname and village role follow ${data.link.sibling}.`}
          </p>
          {!data.link.isPrimary && (
            <Button
              variant="secondary"
              className="gap-2"
              disabled={isSettingPrimary}
              onClick={() => setPrimary()}
            >
              <Star className="h-4 w-4" />
              Set as primary for Discord
            </Button>
          )}
        </div>
      )}
      {data.link.needsRelink && (
        <div className="space-y-2">
          <p className="text-red-600 text-sm">
            Discord no longer accepts updates for this link, so your Verified Ninja role
            may lapse. Re-link to restore it.
          </p>
          <Button asChild className="gap-2">
            <a href="/api/discord/authorize">
              <Link2 className="h-4 w-4" />
              Re-link Discord
            </a>
          </Button>
        </div>
      )}
      <Confirm
        title="Unlink Discord"
        proceed_label={isUnlinking ? null : "Unlink"}
        isLoading={isUnlinking}
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        button={
          <Button variant="destructive" className="gap-2" disabled={isUnlinking}>
            <Unlink className="h-4 w-4" />
            Unlink Discord
          </Button>
        }
        onAccept={(e) => {
          e.preventDefault();
          unlink();
        }}
      >
        <p>
          {data.link.sibling
            ? `${data.link.discordUsername} stays linked to ${data.link.sibling}, which keeps the Verified Ninja role and becomes primary.`
            : "Unlinking removes your Verified Ninja role, so the Discord server channels lock again."}
        </p>
        <p className="pt-2 font-bold">
          For {DISCORD_UNLINK_COOLDOWN_DAYS} days afterwards you cannot link a different
          Discord account, and this character still counts toward the{" "}
          {DISCORD_MAX_CHARACTERS_PER_ACCOUNT}-character limit of{" "}
          {data.link.discordUsername}. Relinking {data.link.discordUsername} to this
          character stays possible.
        </p>
      </Confirm>
      <p className="text-muted-foreground text-sm">
        <Link className="font-bold" href="/privacy#discord">
          What we share with Discord
        </Link>
      </p>
    </div>
  );
};
