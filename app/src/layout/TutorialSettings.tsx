"use client";

import { AlertCircle, BookOpenText, ChevronRight, LifeBuoy } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Link from "@/layout/Link";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useRequiredUserData } from "@/utils/UserContext";

/** Tutorial switch plus the player guide and support links, for the settings page. */
export function TutorialSettings() {
  const { data: userData, updateUser } = useRequiredUserData();
  const { mutate: toggleTutorial, isPending } =
    api.profile.updatePreferences.useMutation({
      onSuccess: async (result, input) => {
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        await updateUser(input);
      },
    });

  if (!userData) return null;
  const showReminder = hasTutorialReminder(userData);

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm">
        The tutorial helps new players learn the game mechanics. You can enable or
        disable it at any time.
      </p>
      {showReminder && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-500 bg-orange-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
          <div className="space-y-1">
            <p className="font-semibold text-orange-500">You have active quests!</p>
            <p className="text-muted-foreground text-sm">
              Enable the tutorial to get guidance on your current starter or tier
              quests. The tutorial assistant will help you complete them.
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <p className="font-semibold">Tutorial mode</p>
          <p className="text-muted-foreground text-sm">
            {userData.tutorialOn ? "Currently enabled" : "Currently disabled"}
          </p>
        </div>
        <Button
          onClick={() => toggleTutorial({ tutorialOn: !userData.tutorialOn })}
          disabled={isPending}
          variant={userData.tutorialOn ? "destructive" : "default"}
        >
          {isPending
            ? "Updating..."
            : userData.tutorialOn
              ? "Disable Tutorial"
              : "Enable Tutorial"}
        </Button>
      </div>
      <div className="divide-y rounded-lg border">
        <HelpLink href="/guide" icon={BookOpenText} label="Player guide" />
        <HelpLink href="/support" icon={LifeBuoy} label="Support tickets" />
      </div>
    </div>
  );
}

function HelpLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof BookOpenText;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-muted/50 flex min-h-11 items-center gap-3 px-4 text-sm"
    >
      <Icon className="text-muted-foreground h-4 w-4" aria-hidden="true" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="text-muted-foreground h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

/** Tutorial is off while starter or tier quests are still open. */
export const hasTutorialReminder = (userData?: UserWithRelations | null) =>
  userData?.tutorialOn === false &&
  userData.userQuests.some(
    (uq) => ["starter", "tier"].includes(uq.quest.questType) && uq.completed === 0,
  );
