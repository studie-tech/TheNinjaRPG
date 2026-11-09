"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COST_CHANGE_GENDER } from "@/drizzle/constants";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import { type Gender, genders } from "@/validators/register";
import { type GenderChangeSchema, genderChangeSchema } from "@/validators/user";

/**
 * Change gender component
 */
export const ChangeGender: React.FC = () => {
  // State
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const [showGenderConfirmation, setShowGenderConfirmation] = useState(false);
  const genderChangeFlight = useSingleFlight();
  const isChangingGender = genderChangeFlight.isPending;

  // Mutations
  const { mutateAsync: changeGender } = api.blackmarket.changeUserGender.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _input, revision) => {
      if (data.success) {
        await updateUser(
          data.userPatch?.gender !== undefined &&
            data.userPatch.reputationPoints !== undefined
            ? {
                gender: data.userPatch.gender,
                reputationPoints: data.userPatch.reputationPoints,
              }
            : undefined,
          { revision },
        );
      }
    },
  });

  // Gender form
  const form = useForm<GenderChangeSchema>({
    resolver: zodResolver(genderChangeSchema),
    defaultValues: { gender: userData?.gender as Gender | undefined },
  });
  const watchGender = useWatch({ control: form.control, name: "gender" });

  // Set current user gender when the stored gender changes
  const storedGender = userData?.gender;
  useEffect(() => {
    if (storedGender) {
      form.setValue("gender", storedGender as Gender);
    }
  }, [storedGender, form]);

  // Form handlers
  const onSubmit = form.handleSubmit(() => {
    if (!isChangingGender) setShowGenderConfirmation(true);
  });

  const handleGenderChange = async () => {
    if (!userData) return;

    const submittedGender = form.getValues("gender");
    await genderChangeFlight.run(true, async () => {
      try {
        const data = await changeGender({ gender: submittedGender });
        showMutationToast(data);
        if (data.success) {
          // The purchase has committed. Close even if cache reconciliation fails
          // so retrying the dialog cannot charge again.
          setShowGenderConfirmation(false);
        } else {
          form.setValue("gender", submittedGender, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
      } catch {
        // The shared tRPC error handler surfaces transport failures. Keep the
        // confirmation and selected gender open so the user can retry.
        form.setValue("gender", submittedGender, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    });
  };

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Derived data
  const canBuyGender = userData.reputationPoints >= COST_CHANGE_GENDER;

  return (
    <div className="grid grid-cols-1">
      <Form {...form}>
        <form onSubmit={onSubmit} aria-busy={isChangingGender}>
          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <div className="flex w-full flex-row items-center">
                <FormItem className="w-full">
                  <FormLabel>Select gender</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    value={field.value}
                    disabled={isChangingGender}
                  >
                    <FormControl>
                      <SelectTrigger className="h-14 text-3xl">
                        <SelectValue placeholder={userData.gender} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {genders.map((gender, i) => (
                        <SelectItem key={`${gender}-${i}`} value={gender}>
                          {gender}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-row">
                    <FormDescription className="grow">
                      Gender of your ninja
                    </FormDescription>
                    <FormMessage />
                  </div>
                </FormItem>
                <div>
                  <div className="basis-full flex-row text-7xl">
                    {watchGender === "Male" && <p className="p-2 text-blue-500">♂</p>}
                    {watchGender === "Female" && <p className="p-2 text-pink-500">♀</p>}
                    {watchGender === "Other" && <p className="p-2 text-slate-500">⚥</p>}
                  </div>
                </div>
              </div>
            )}
          />
          <Button
            id="change-gender"
            type="submit"
            className="my-3 w-full"
            disabled={!canBuyGender || isChangingGender}
          >
            {canBuyGender ? "Set new gender" : "Not enough points"}
          </Button>
          <Modal
            title="Confirm Gender Change"
            isOpen={showGenderConfirmation}
            setIsOpen={setShowGenderConfirmation}
            proceed_label="Set new gender"
            proceed_loading_label="Changing"
            isLoading={isChangingGender}
            keepOpenOnAccept
            onAccept={(event) => {
              event.preventDefault();
              void handleGenderChange();
            }}
          >
            Changing your gender costs {COST_CHANGE_GENDER} reputation points, and can
            only be changed by requesting another change. Are you sure you want to
            change your gender to {watchGender}?
          </Modal>
        </form>
      </Form>
    </div>
  );
};
