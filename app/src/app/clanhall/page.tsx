"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  CLAN_CREATE_PRESTIGE_REQUIREMENT,
  CLAN_CREATE_RYO_COST,
  CLAN_RANK_REQUIREMENT,
} from "@/drizzle/constants";
import { ClanProfile, ClansOverview } from "@/layout/Clan";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { hasRequiredRank } from "@/libs/train";
import { useRequireInVillage } from "@/utils/UserContext";
import type { ClanCreateSchema } from "@/validators/clan";
import { clanCreateSchema } from "@/validators/clan";

export default function Clans() {
  // Must be in allied village
  const { userData, access } = useRequireInVillage("/clanhall");

  // tRPC utils
  const utils = api.useUtils();

  // Mutations
  const { mutate: createClan, isPending: isCreating } = api.clan.createClan.useMutation(
    {
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.clan.getAll.invalidate();
        await utils.profile.getUser.invalidate();
      },
    },
  );

  // Form
  const createForm = useForm<ClanCreateSchema>({
    resolver: zodResolver(clanCreateSchema),
    defaultValues: { name: "", villageId: "" },
  });

  // Form handlers
  const onSubmit = createForm.handleSubmit((data) => {
    createClan({ name: data.name, villageId: userData?.villageId ?? "" });
  });

  // Loaders
  if (isCreating) return <Loader explanation="Creating clan" />;
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Clan Hall" />;

  // Derived
  const inClan = userData.clanId;
  const enoughPrestige = userData.villagePrestige >= CLAN_CREATE_PRESTIGE_REQUIREMENT;
  const enoughRyo = userData.money >= CLAN_CREATE_RYO_COST;
  const canCreate = enoughPrestige && enoughRyo;
  const isOutlaw = userData.isOutlaw;
  const groupLabel = isOutlaw ? "Faction" : "Clan";
  const groupLabelPlural = isOutlaw ? "Factions" : "Clans";
  const prestigeLabel = isOutlaw ? "notoriety" : "village prestige";

  let proceedLabel = "Submit";
  if (!enoughPrestige) {
    proceedLabel = `Missing ${CLAN_CREATE_PRESTIGE_REQUIREMENT - userData.villagePrestige} ${prestigeLabel}`;
  } else if (!enoughRyo) {
    proceedLabel = `Missing ${CLAN_CREATE_RYO_COST - userData.money} Ryo`;
  }

  // Render
  if (userData.clanId) {
    return <ClanProfile clanId={userData.clanId} defaultBackHref="/village" />;
  } else {
    return (
      <ContentBox
        title={groupLabelPlural}
        subtitle="Fight together"
        defaultBackHref="/village"
        padding={false}
        topRightContent={
          hasRequiredRank(userData.rank, CLAN_RANK_REQUIREMENT) &&
          !inClan && (
            <Confirm2
              title={`Create new ${groupLabel}`}
              proceed_label={proceedLabel}
              button={
                <Button id="create-clan" className="w-full">
                  <ShieldPlus className="mr-2 h-5 w-5" />
                  Create
                </Button>
              }
              confirmClassName={
                canCreate
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-red-600 text-white hover:bg-red-700"
              }
              isValid={createForm.formState.isValid}
              onAccept={canCreate ? onSubmit : undefined}
            >
              Create a {groupLabel.toLowerCase()} requires at least{" "}
              {CLAN_CREATE_PRESTIGE_REQUIREMENT} {prestigeLabel}, and costs{" "}
              {CLAN_CREATE_RYO_COST} Ryo. You currently have {userData.villagePrestige}{" "}
              {prestigeLabel} and {userData.money} Ryo.
              {canCreate && (
                <Form {...createForm}>
                  <form className="space-y-2" onSubmit={onSubmit}>
                    <FormField
                      control={createForm.control}
                      name="name"
                      render={({ field }) => {
                        return (
                          <FormItem>
                            <FormLabel>Title</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={`Name of the new ${groupLabel.toLowerCase()}`}
                                {...field}
                              />
                            </FormControl>
                            {createForm?.formState?.errors?.name?.message && (
                              <FormMessage>
                                {createForm.formState.errors.name.message}
                              </FormMessage>
                            )}
                          </FormItem>
                        );
                      }}
                    />
                  </form>
                </Form>
              )}
            </Confirm2>
          )
        }
      >
        <ClansOverview />
      </ContentBox>
    );
  }
}
