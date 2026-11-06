import { api } from "@/app/_trpc/client";
import { Switch } from "@/components/ui/switch";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/** Persist how awake-only actions handle a sleeping character. */
export const ActionSettings = () => {
  const { data: user, prepareUserUpdate, updateUser } = useRequiredUserData();
  const { mutate, isPending } = api.profile.updatePreferences.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _input, revision) => {
      if (result.success) await updateUser(result, { revision, refetch: false });
      showMutationToast(result);
    },
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
