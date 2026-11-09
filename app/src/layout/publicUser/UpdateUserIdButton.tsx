"use client";

import { IdCard } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Confirm from "@/layout/Confirm";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { showMutationToast } from "@/libs/toast";

interface UpdateUserIdButtonProps {
  userId: string;
  username: string;
  updateUserIdMutation: ReturnType<typeof api.staff.updateUserId.useMutation>;
}

/** Submit staff account-ID changes and keep responses tied to the original account. */
export const UpdateUserIdButton: React.FC<UpdateUserIdButtonProps> = ({
  userId,
  username,
  updateUserIdMutation,
}) => {
  const router = useRouter();
  const utils = api.useUtils();
  const userIdFlight = useSingleFlight<{
    userId: string;
    username: string;
    newUserId: string;
  }>();
  const isPending = userIdFlight.isPending;
  const [committedSourceId, setCommittedSourceId] = useState<string | null>(null);

  const userIdForm = useForm<{ newUserId: string }>({
    mode: "onChange",
    defaultValues: {
      newUserId: userId,
    },
  });
  const requestedId = useWatch({
    control: userIdForm.control,
    name: "newUserId",
  }).trim();

  const handleUpdateUserId = userIdForm.handleSubmit(async (data) => {
    if (committedSourceId === userId) return;
    const request = {
      userId,
      username,
      newUserId: data.newUserId.trim(),
    };

    await userIdFlight.run(request, async () => {
      try {
        const result = await updateUserIdMutation.mutateAsync({
          userId: request.userId,
          newUserId: request.newUserId,
        });
        showMutationToast(result);
        if (!result.success) return;

        // The old identity no longer exists. Suppress this stale action and close the confirmation
        // before cache/network work; every later move requires a fresh profile and confirmation.
        setCommittedSourceId(request.userId);
        void Promise.allSettled([
          utils.profile.getPublicUser.invalidate({ userId: request.userId }),
          utils.profile.getPublicUser.invalidate({ userId: request.newUserId }),
          utils.profile.getPublicUsers.invalidate(),
        ]);
        router.replace(`/userid/${encodeURIComponent(request.newUserId)}`);
      } catch (error) {
        // The exact old/new pair stays in the open form for a retry.
        showRetryableErrorToast(
          error,
          "Could not update the user ID. Check your connection and try again.",
        );
      }
    });
  });

  if (committedSourceId === userId) return null;

  return (
    <Confirm
      id="update-user-id"
      title="Update User ID"
      proceed_label="Update user ID"
      proceed_loading_label="Updating"
      button={<IdCard className="h-6 w-6 cursor-pointer hover:text-orange-500" />}
      onAccept={handleUpdateUserId}
      isValid={
        userIdForm.formState.isValid && requestedId.length > 0 && requestedId !== userId
      }
      isLoading={isPending}
      keepOpenOnAccept
      disabled={isPending}
      confirmClassName="bg-red-600 text-white hover:bg-red-700"
    >
      <Form {...userIdForm}>
        <form className="space-y-4" aria-busy={isPending}>
          <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
            <p className="font-semibold text-red-700 dark:text-red-300">
              This changes the application identity for {username}.
            </p>
            <p className="text-sm">
              Current user ID: <code className="break-all">{userId}</code>
            </p>
            <p className="text-muted-foreground text-sm">
              All application records will move to the new ID. The old Clerk account
              will stop opening this character, and the server cannot verify that the
              new Clerk account exists or belongs to the intended person. This action
              cannot be undone from this screen.
            </p>
          </div>
          <FormField
            control={userIdForm.control}
            name="newUserId"
            rules={{
              required: "A new user ID is required",
              maxLength: { value: 191, message: "User ID is too long" },
              pattern: {
                value: /^[A-Za-z0-9_-]+$/,
                message: "Use only letters, numbers, underscores, and hyphens",
              },
              validate: (value) =>
                value.trim() !== userId || "The new user ID must be different",
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>New Clerk user ID</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    disabled={isPending}
                    aria-describedby="update-user-id-consequence"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p id="update-user-id-consequence" className="text-muted-foreground text-xs">
            Confirm that the destination ID was copied from the intended Clerk account.
          </p>
        </form>
      </Form>
    </Confirm>
  );
};
