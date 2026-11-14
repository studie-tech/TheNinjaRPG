"use client";

import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Lets staff play as a regular player: unreleased quests, skills, jutsu and items stay out
 * of their game while staff tools keep working.
 */
export const StaffPlayerViewSwitch = () => {
  const { data: userData, updateUser } = useUserDataSelector((user) => ({
    playsAsPlayer: user.playsAsPlayer,
  }));
  const queryClient = useQueryClient();
  const { mutateAsync: updatePreferences, isPending } =
    api.profile.updatePreferences.useMutation();
  const flight = useSingleFlight();

  const onChange = (playsAsPlayer: boolean) =>
    flight.run(true, async () => {
      try {
        const result = await updatePreferences({ playsAsPlayer });
        showMutationToast(result);
        if (!result.success) return;
        await updateUser({ playsAsPlayer });
        // Every query may hold content loaded for the other view; the profile is patched.
        await queryClient.invalidateQueries({
          predicate: (query) => !isProfileQuery(query.queryKey),
        });
      } catch {
        // Mutation errors are surfaced by the shared tRPC error handler.
      }
    });

  if (!userData) return null;
  return (
    <div className="flex flex-col gap-1 pb-3">
      <div className="flex min-h-8 items-center gap-2" aria-busy={isPending}>
        <Switch
          id="plays-as-player"
          checked={userData.playsAsPlayer}
          disabled={isPending}
          onCheckedChange={(checked) => void onChange(checked)}
        />
        <Label htmlFor="plays-as-player">Play as a regular player</Label>
        {isPending && (
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" role="status" />
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        Unreleased quests, skills, jutsu and items stay out of your game while this is
        on. Staff tools keep working; switch it off to see or edit unreleased content.
      </p>
    </div>
  );
};

/** The profile query, already patched with the new setting. */
const isProfileQuery = (queryKey: QueryKey) => {
  const [path] = queryKey as [unknown];
  return Array.isArray(path) && path[0] === "profile" && path[1] === "getUser";
};
