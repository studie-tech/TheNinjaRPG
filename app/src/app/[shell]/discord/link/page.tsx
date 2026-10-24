"use client";

import { useUser } from "@clerk/nextjs";
import { CheckCircle2, Link2, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import {
  type DiscordLinkResult,
  describeDiscordLinkResult,
  isDiscordLinkResult,
} from "@/libs/discordLink";
import { useUserData } from "@/utils/UserContext";

/**
 * Discord Linked Roles verification page. Discord opens it when a member claims the
 * Verified Ninja role; the OAuth callback returns here with `?result=`.
 */
export default function DiscordLinkPage() {
  return (
    <ContentBox
      title="Discord"
      subtitle="Link your Discord account"
      defaultBackHref="/profile"
    >
      <Suspense fallback={<Loader explanation="Loading" />}>
        <DiscordLinkContent />
      </Suspense>
    </ContentBox>
  );
}

const DiscordLinkContent: React.FC = () => {
  const searchParams = useSearchParams();
  const result = searchParams.get("result");
  if (isDiscordLinkResult(result))
    return (
      <DiscordLinkOutcome
        result={result}
        hint={searchParams.get("hint") ?? undefined}
        until={searchParams.get("until") ?? undefined}
      />
    );
  return <DiscordLinkStart />;
};

/** Results the player can retry directly from this page. */
const RETRYABLE: DiscordLinkResult[] = [
  "cancelled",
  "invalid_state",
  "error",
  "signed_out",
];

const DiscordLinkOutcome: React.FC<{
  result: DiscordLinkResult;
  hint?: string;
  until?: string;
}> = ({ result, hint, until }) => {
  const copy = describeDiscordLinkResult(result, { hint, until });
  const Icon = copy.success ? CheckCircle2 : XCircle;
  return (
    <div className="flex flex-col items-center gap-3 p-4 text-center">
      <Icon
        className={`h-12 w-12 ${copy.success ? "text-green-600" : "text-red-600"}`}
        aria-hidden
      />
      <h2 className="font-bold text-lg">{copy.title}</h2>
      <p className="max-w-prose">{copy.description}</p>
      <div className="flex flex-row flex-wrap justify-center gap-2 pt-2">
        {RETRYABLE.includes(result) && (
          <Button asChild className="gap-2">
            <a href="/api/discord/authorize">
              <Link2 className="h-4 w-4" />
              Try again
            </a>
          </Button>
        )}
        <Link href="/profile?tab=edit">
          <Button variant="secondary">Profile settings</Button>
        </Link>
      </div>
    </div>
  );
};

const DiscordLinkStart: React.FC = () => {
  const { isLoaded, isSignedIn } = useUser();
  const { data: userData, status } = useUserData();
  const { data, isPending } = api.discord.getStatus.useQuery();

  if (!isLoaded || isPending) return <Loader explanation="Loading" />;
  if (!data?.enabled) return <DiscordLinkOutcome result="disabled" />;
  if (!isSignedIn)
    return (
      <div className="flex flex-col items-center gap-3 p-4 text-center">
        <p className="max-w-prose">
          Sign in to TheNinja-RPG to link your Discord account to your character.
        </p>
        <Link href={`/login?redirect_url=${encodeURIComponent("/discord/link")}`}>
          <Button>Sign in</Button>
        </Link>
      </div>
    );
  if (!userData && status === "pending")
    return <Loader explanation="Loading character" />;
  if (!userData) return <DiscordLinkOutcome result="no_character" />;

  return (
    <div className="flex flex-col gap-3 p-4">
      {data.link ? (
        <p>
          Your character <span className="font-bold">{userData.username}</span> is
          linked to <span className="font-bold">{data.link.discordUsername}</span>.
          Continue with Discord to refresh your roles and nickname.
        </p>
      ) : (
        <p>
          Link the Discord account you use for the TheNinja-RPG server to your character{" "}
          <span className="font-bold">{userData.username}</span>. Linking grants the
          Verified Ninja role, sets your server nickname to your character name and adds
          your village role.
        </p>
      )}
      <ul className="list-disc pl-5 text-muted-foreground text-sm">
        <li>
          One Discord account per character, and one character per Discord account.
        </li>
        <li>
          Discord accounts must be at least {DISCORD_MIN_ACCOUNT_AGE_DAYS} days old.
        </li>
        <li>
          After unlinking, linking to a different partner takes{" "}
          {DISCORD_UNLINK_COOLDOWN_DAYS} days.
        </li>
        <li>Indefinite bans and silences in the game also apply on Discord.</li>
      </ul>
      <div>
        <Button asChild className="gap-2">
          <a href="/api/discord/authorize">
            <Link2 className="h-4 w-4" />
            Continue with Discord
          </a>
        </Button>
      </div>
    </div>
  );
};
