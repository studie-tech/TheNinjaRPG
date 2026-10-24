"use client";

import { Link2, Unlink } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
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
            One Discord account per character, and one character per Discord account.
          </li>
          <li>
            Discord accounts must be at least {DISCORD_MIN_ACCOUNT_AGE_DAYS} days old.
          </li>
          <li>
            After unlinking, linking a different account takes{" "}
            {DISCORD_UNLINK_COOLDOWN_DAYS} days.
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
        Linked to <span className="font-bold">{data.link.discordUsername}</span> since{" "}
        {new Date(data.link.linkedAt).toLocaleDateString()}.
      </p>
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
          Unlinking removes your Verified Ninja role, so the Discord server channels
          lock again.
        </p>
        <p className="pt-2 font-bold">
          For {DISCORD_UNLINK_COOLDOWN_DAYS} days afterwards you cannot link a different
          Discord account, and {data.link.discordUsername} cannot be linked to another
          character. Relinking {data.link.discordUsername} to this character stays
          possible.
        </p>
      </Confirm>
    </div>
  );
};
