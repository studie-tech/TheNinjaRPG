"use client";

import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Loader from "@/layout/Loader";
import { describeTitleEffect } from "@/libs/titles";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Choose the public label from profile-loaded titles while all collected bonuses stay active. */
export const Titles = () => {
  const {
    data: user,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({
    activeTitleId: u.activeTitleId,
    titles: u.titles,
  }));
  const data = user?.titles ?? [];
  const utils = api.useUtils();
  const select = api.title.select.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _input, revision) => {
      showMutationToast(result);
      if (result.success)
        await Promise.all([
          updateUser(undefined, { revision }),
          utils.profile.getPublicUser.invalidate(),
          utils.comments.invalidate(),
        ]);
    },
  });
  if (!user) return <Loader explanation="Loading collected titles" />;
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm">
        Bonuses from every collected title stack and stay active when you change or
        clear your displayed title.
      </p>
      <Button
        variant="outline"
        disabled={!user?.activeTitleId || select.isPending}
        onClick={() => select.mutate({ titleId: null })}
      >
        Clear displayed title
      </Button>
      {select.data?.success === false && (
        <p role="alert" className="text-destructive">
          {select.data.message}
        </p>
      )}
      {!data.length && (
        <p>You have not collected any titles yet. Earn titles from quest rewards.</p>
      )}
      {data.map((owned) => (
        <div
          key={owned.titleId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
        >
          <div>
            <h3 className="font-semibold">{owned.title?.name ?? "Collected title"}</h3>
            <p className="text-sm">{owned.title?.description}</p>
            {owned.effects.map((effect, index) => (
              <p key={index} className="text-muted-foreground text-sm">
                {describeTitleEffect(effect)}
              </p>
            ))}
            {!owned.effects.length && (
              <p className="text-muted-foreground text-sm">Cosmetic title</p>
            )}
          </div>
          <Button
            disabled={user?.activeTitleId === owned.titleId || select.isPending}
            onClick={() => select.mutate({ titleId: owned.titleId })}
          >
            {user?.activeTitleId === owned.titleId ? "Active" : "Display title"}
          </Button>
        </div>
      ))}
    </div>
  );
};
