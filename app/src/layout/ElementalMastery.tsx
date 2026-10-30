"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type BasicElement,
  BasicElementName,
  ELEMENTAL_MASTERY_BOOST,
  ELEMENTAL_MASTERY_CAP,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { activeTrainedElement, providedElements } from "@/libs/elementalMastery";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

export const ElementalMastery = () => {
  const { data: user, prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();
  const [message, setMessage] = useState("");
  const onSuccess = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    setMessage(result.message);
    showMutationToast(result);
    await Promise.all([
      ...(result.success
        ? [updateUser(result.userPatch, { revision })]
        : [utils.profile.getUser.invalidate()]),
      utils.profile.getPublicUser.invalidate(),
    ]);
  };
  const onError = () => {
    setMessage("Could not save. Please try again.");
    void utils.profile.getUser.invalidate();
  };
  const select = api.train.selectTrainedElement.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess,
    onError,
  });
  const isPending = select.isPending;
  if (!user) return null;
  const active = activeTrainedElement(user);
  const blocked = providedElements(user);
  const unlocked = BasicElementName.filter(
    (element) =>
      (user.elementalMastery[element] ?? 0) >= ELEMENTAL_MASTERY_CAP &&
      !blocked.includes(element),
  );

  return (
    <ContentBox title="Elemental Mastery" subtitle="Choose your active trained element">
      <p className="mb-3 text-sm text-muted-foreground">
        Each element caps at {ELEMENTAL_MASTERY_CAP.toLocaleString()} mastery and
        unlocks at its cap with a {ELEMENTAL_MASTERY_BOOST}% damage boost. One
        additional trained element can be active. Elemental progress adds no character
        XP and has its own cap. Bloodline elements replace your primary and secondary
        elements; any element not currently provided can be trained.
      </p>
      {message && (
        <p role="status" className="mb-3 text-sm">
          {message}
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="active-trained-element" className="text-sm font-semibold">
          Active trained element
        </label>
        <Select
          value={active ?? "none"}
          disabled={isPending || user.status !== "AWAKE"}
          onValueChange={(value) =>
            select.mutate({
              element: value === "none" ? null : (value as BasicElement),
            })
          }
        >
          <SelectTrigger id="active-trained-element">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {unlocked.map((element) => (
              <SelectItem key={element} value={element}>
                {element} (+{ELEMENTAL_MASTERY_BOOST}% damage)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {user.activeTrainedElement && !active && (
          <p className="text-sm">
            Your saved element is now provided by your innate elements or bloodline.
            Choose another mastered element.
          </p>
        )}
        {unlocked.length === 0 && (
          <p className="text-sm">
            Fully train an element at the{" "}
            <Link href="/traininggrounds" className="underline">
              Training Grounds
            </Link>{" "}
            to select it here.
          </p>
        )}
      </div>
    </ContentBox>
  );
};
