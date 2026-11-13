"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleArrowUp, DoorClosed, ShieldPlus } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { Label } from "@/components/ui/label";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { KageDefense } from "@/layout/KageDefense";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import PublicUserComponent from "@/layout/PublicUser";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { canTakeKage } from "@/utils/permissions";
import { useRequiredUserInfo } from "@/utils/UserContext";
import {
  createPrestigeTransferSchema,
  type PrestigeTransferSchema,
  type PrestigeTransferSchemaInput,
} from "@/validators/misc";

/** Incumbent controls for village structures, diplomacy and prestige transfers. */
export const KageHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  // Ability to update user
  const { updateUser } = useRequiredUserInfo();

  // tRPC utility
  const utils = api.useUtils();

  // Query
  const { data: village, isPending } = api.village.get.useQuery(
    { id: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId },
  );

  const { mutate: resign, isPending: isResigning } = api.kage.resignKage.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.village.get.invalidate();
      }
    },
  });

  const { mutate: sendKagePrestige, isPending: isSendingPrestige } =
    api.kage.sendKagePrestige.useMutation({
      onSuccess: async (data, variables) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser({
            villagePrestige: user.villagePrestige - variables.amount,
          });
        }
      },
    });

  // Derived
  const isKage = user.userId === village?.villageData.kageId;
  const isElder = user.rank === "ELDER";

  // Schema for prestige sending
  const prestigeSchema = createPrestigeTransferSchema(user.villagePrestige ?? 0);

  // Form for prestige sending
  const prestigeForm = useForm<
    PrestigeTransferSchemaInput,
    unknown,
    PrestigeTransferSchema
  >({
    resolver: zodResolver(prestigeSchema),
  });

  // Submit handler for prestige
  const onSendPrestige = prestigeForm.handleSubmit((data) => {
    sendKagePrestige({
      kageId: village?.villageData.kageId ?? "",
      amount: data.amount ?? 0,
    });
    prestigeForm.reset();
  });

  // Checks
  if (!user.villageId) return <Loader explanation="Join a village first" />;
  if (isPending || !village) return <Loader explanation="Loading village" />;

  // Render
  return (
    <>
      <ContentBox
        title="Town Hall"
        subtitle="Kage Challenge"
        defaultBackHref="/village"
        topRightContent={navTabs}
      >
        <p>
          The &quot;Kage&quot; is the village&apos;s most potent and skilled ninja,
          given the esteemed responsibility of safeguarding its people. As the
          highest-ranking authority in the village, the Kage carries the burden of
          making critical decisions and ensures the village&apos;s prosperity. Their
          duty includes defending the village from external threats, maintaining order
          within, deciding missions for their fellow ninjas, and training the next
          generation of warriors. The Kage is a symbol of strength, wisdom, and dignity,
          known to have the power to shape the destiny of the village.
        </p>
        {isKage && (
          <Confirm
            title="Resign as Kage"
            proceed_label="Resign"
            proceed_loading_label="Resigning"
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
            triggerClassName="my-2 w-full"
            disabled={isResigning}
            isLoading={isResigning}
            keepOpenOnAccept
            button={
              <Button id="challenge" variant="destructive" className="w-full">
                <DoorClosed className="mr-2 h-6 w-6" />
                {isResigning ? "Resigning as Kage" : "Resign as Kage"}
              </Button>
            }
            onAccept={(_, { close }) =>
              resign(
                { villageId: village.villageData.id },
                { onSettled: () => close() },
              )
            }
          >
            Do you confirm that you wish to resign as Kage? The position passes
            immediately to the village elder next in line, and it cannot be undone.
          </Confirm>
        )}

        {isElder && (
          <Form {...prestigeForm}>
            <form
              onSubmit={onSendPrestige}
              className="relative my-2"
              aria-busy={isSendingPrestige}
            >
              <FormField
                control={prestigeForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="flex w-full flex-col">
                    <FormControl>
                      <Input
                        id="amount"
                        disabled={isSendingPrestige}
                        placeholder={`Send prestige (max ${user.villagePrestige})`}
                        {...field}
                        value={field.value as number | undefined}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                className="absolute top-0 right-0"
                type="submit"
                aria-label="Send prestige"
                loading={isSendingPrestige}
              >
                <CircleArrowUp className="h-5 w-5" />
              </Button>
            </form>
          </Form>
        )}
      </ContentBox>
      {village.villageData.kageId ? (
        <PublicUserComponent
          userId={village.villageData.kageId}
          title={user.isOutlaw ? "Faction Kage" : "Village Kage"}
          initialBreak
        />
      ) : (
        <ContentBox title="Kage succession" initialBreak>
          The village has no Kage. Following a successful removal vote, elders can
          nominate an eligible successor in the Elders tab.
        </ContentBox>
      )}
      <KageChallenge user={user} />
      {village.defendedChallenges && village.defendedChallenges.length > 0 && (
        <ContentBox
          title="Challenge Record"
          subtitle="Kage Challenges & Outcomes"
          initialBreak={true}
        >
          <div className="grid grid-cols-4 lg:grid-cols-5">
            {village.defendedChallenges.map((challenge) => (
              <div key={challenge.id} className="p-2 text-center">
                <Link href={`/userid/${challenge.userId}`}>
                  <AvatarImage
                    href={challenge.user.avatar}
                    alt={challenge.user.username}
                    hover_effect={true}
                    size={200}
                  />
                  {(challenge.didWin ?? 0) > 0 ? (
                    <p className="font-bold text-green-500 text-sm">
                      Won, {challenge.rounds} rounds
                    </p>
                  ) : (
                    <p className="font-bold text-red-500 text-sm">
                      Lost, {challenge.rounds} rounds
                    </p>
                  )}
                  <p className="text-xs italic">
                    {(challenge.resolvedAt ?? challenge.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs italic">
                    {(challenge.resolvedAt ?? challenge.createdAt).toLocaleTimeString()}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        </ContentBox>
      )}
    </>
  );
};

/** Show the incumbent and public defenses, with reasoned staff takeover when permitted. */
const KageChallenge = ({ user }: { user: NonNullable<UserWithRelations> }) => {
  const utils = api.useUtils();
  const [showTakeKageModal, setShowTakeKageModal] = useState(false);
  const [takeKageReason, setTakeKageReason] = useState("");
  const isKage = user.userId === user.village?.kageId;
  const { mutate: take, isPending: isTaking } = api.kage.takeKage.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.village.get.invalidate(),
          utils.profile.getUser.invalidate(),
          utils.kage.getDefenses.invalidate(),
        ]);
        setShowTakeKageModal(false);
        setTakeKageReason("");
      }
    },
  });
  return (
    <>
      <KageDefense user={user} />
      {canTakeKage(user.role) && (
        <ContentBox title="Staff leadership" initialBreak>
          {!isKage && (
            <div className="p-3">
              <Button
                id="challenge"
                variant="destructive"
                className="my-2 w-full"
                onClick={() => setShowTakeKageModal(true)}
                loading={isTaking}
              >
                <ShieldPlus className="mr-2 h-6 w-6" />
                Take kage as Staff
              </Button>
            </div>
          )}

          {/* Take Kage Modal */}
          {showTakeKageModal && (
            <Modal
              title="Take Kage as Staff"
              isOpen={showTakeKageModal}
              setIsOpen={setShowTakeKageModal}
              proceed_label="Take Kage"
              confirmClassName="bg-red-600 hover:bg-red-700"
              onAccept={() => {
                if (takeKageReason.trim().length >= 10) {
                  take({ reason: takeKageReason.trim() });
                } else {
                  showMutationToast({
                    success: false,
                    message: "Reason must be at least 10 characters long",
                  });
                }
              }}
              isValid={takeKageReason.trim().length >= 10}
            >
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  You are about to take the kage position as staff. This action will be
                  logged and should only be used for administrative purposes.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="reason">Reason *</Label>
                  <Input
                    id="reason"
                    value={takeKageReason}
                    onChange={(e) => setTakeKageReason(e.target.value)}
                    placeholder="Enter reason for taking kage position (minimum 10 characters)..."
                  />
                  <p className="text-muted-foreground text-xs">
                    This reason will be logged in the action log. Minimum 10 characters
                    required.
                  </p>
                </div>
              </div>
            </Modal>
          )}
        </ContentBox>
      )}
    </>
  );
};
