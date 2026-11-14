"use client";

import type React from "react";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { COST_CHANGE_USERNAME } from "@/drizzle/constants";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { showMutationToast } from "@/libs/toast";
import { useUserSearch } from "@/utils/search";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Namechange component
 */
export const NameChange: React.FC = () => {
  // State
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({ reputationPoints: u.reputationPoints }));
  const [showNameChangeConfirm, setShowNameChangeConfirm] = useState(false);
  const usernameFlight = useSingleFlight();
  const isChangingUsername = usernameFlight.isPending;

  // Username search
  const { form, searchTerm } = useUserSearch();
  const usernameDraft = useWatch({ control: form.control, name: "username" });

  // Queries
  const { data: databaseUsername } = api.profile.getUsername.useQuery(
    { username: searchTerm },
    {},
  );

  // Mutations
  const { mutateAsync: updateUsername } = api.profile.updateUsername.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _input, revision) => {
      if (data.success) {
        await updateUser(
          data.userPatch?.username !== undefined &&
            data.userPatch.reputationPoints !== undefined
            ? {
                username: data.userPatch.username,
                reputationPoints: data.userPatch.reputationPoints,
              }
            : undefined,
          { revision },
        );
      }
    },
  });

  const handleUsernameChange = async () => {
    const submittedUsername = usernameDraft;
    await usernameFlight.run(true, async () => {
      try {
        const data = await updateUsername({ username: submittedUsername });
        showMutationToast(data);
        if (data.success) {
          // The paid mutation has already committed. A failed cache refresh must
          // not leave the confirmation retryable and charge the user twice.
          setShowNameChangeConfirm(false);
        }
      } catch {
        // The shared tRPC error handler surfaces transport failures. Leave the
        // confirmation and draft open so the user can correct or retry it.
      }
    });
  };

  // Only show if we have userData
  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  // Derived data
  const errors = form.formState.errors;
  const canBuyUsername = userData.reputationPoints >= COST_CHANGE_USERNAME;
  const error = databaseUsername?.username
    ? `${databaseUsername?.username} already exists`
    : errors.username?.message;

  return (
    <div className="grid grid-cols-1">
      <Form {...form}>
        <form
          aria-busy={isChangingUsername}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !isChangingUsername &&
              canBuyUsername &&
              usernameDraft !== "" &&
              error === undefined
            ) {
              setShowNameChangeConfirm(true);
            }
          }}
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    {...field}
                    id="username"
                    placeholder="Search user"
                    readOnly={isChangingUsername}
                    aria-disabled={isChangingUsername}
                    className={
                      isChangingUsername ? "cursor-not-allowed opacity-50" : undefined
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            id="create"
            type="submit"
            className="my-3 w-full"
            disabled={
              isChangingUsername ||
              !canBuyUsername ||
              usernameDraft === "" ||
              error !== undefined
            }
          >
            {canBuyUsername ? "Update Username" : "Not enough points"}
          </Button>
          <Modal
            title="Confirm New Username"
            isOpen={showNameChangeConfirm}
            setIsOpen={setShowNameChangeConfirm}
            proceed_label="Change username"
            proceed_loading_label="Changing"
            isLoading={isChangingUsername}
            keepOpenOnAccept
            onAccept={(e) => {
              e.preventDefault();
              void handleUsernameChange();
            }}
          >
            Changing your username costs {COST_CHANGE_USERNAME} reputation points, and
            can only be reverted by purchasing another name change. Are you sure you
            want to change your username to {usernameDraft}?
          </Modal>
        </form>
      </Form>
    </div>
  );
};
