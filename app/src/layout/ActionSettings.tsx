import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Switch } from "@/components/ui/switch";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Persist how awake-only actions handle a sleeping character. */
export const ActionSettings = () => {
  const { data: user, actionPreferences } = useRequiredUserDataSelector((u) => ({
    autoWakeUp: u.autoWakeUp,
  }));
  const [error, setError] = useState<string>();
  const { mutate, isPending } = api.profile.updatePreferences.useMutation({
    onMutate: (input) => {
      setError(undefined);
      return actionPreferences.prepareUpdate(input);
    },
    onSuccess: async (result, _input, snapshot) => {
      if (!result.success) {
        setError(result.message);
        return;
      }
      if (await actionPreferences.updateCache(result, snapshot))
        showMutationToast(result);
      else
        setError(
          "Your preference was saved, but could not be applied to this page. Check the setting and try again.",
        );
    },
    onError: (error) => setError(error.message),
    onSettled: (_result, _error, _input, snapshot) => snapshot?.release(),
  });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          id="auto-wake-up"
          checked={user?.autoWakeUp ?? true}
          disabled={isPending}
          onCheckedChange={(autoWakeUp) => mutate({ autoWakeUp })}
        />
        <label htmlFor="auto-wake-up">Wake up automatically for actions</label>
      </div>
      {isPending && (
        <p role="status" className="text-muted-foreground text-sm">
          Saving preference…
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Actions that require you to be awake will wake you up and tell you. Turn this
        off to stay asleep until you wake up manually.
      </p>
      <p className="text-muted-foreground text-sm">
        If you can leave the hospital for free, these actions will check you out
        automatically.
      </p>
    </div>
  );
};
