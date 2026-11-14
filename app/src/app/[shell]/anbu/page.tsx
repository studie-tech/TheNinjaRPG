"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UsersRound } from "lucide-react";
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
import { AutoAttackToggle } from "@/layout/AutoAttackModal";
import { AvatarNameCell } from "@/layout/AvatarNameCell";
import BanInfo from "@/layout/BanInfo";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { useUserPicker } from "@/utils/search";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequireInVillage } from "@/utils/UserContext";
import { getEffectiveStructureLevel } from "@/utils/village";
import type { AnbuCreateSchema } from "@/validators/anbu";
import { anbuCreateSchema } from "@/validators/anbu";

export default function ANBU() {
  // Utils
  const utils = api.useUtils();

  // Must be in allied village
  const { userData, sectorVillage, access } = useRequireInVillage("/anbu");
  const structure = sectorVillage?.structures.find((s) => s.name === "ANBU");

  // Queries
  const { data } = api.anbu.getAll.useQuery(
    { villageId: userData?.villageId ?? "" },
    { enabled: !!userData?.villageId },
  );
  const allSquads = data?.map((squad) => ({
    ...squad,
    memberCount: squad.members.length,
    squadInfo: <AvatarNameCell avatar={squad.image} name={squad.name} hoverEffect />,
    leaderInfo: squad.leader ? (
      <AvatarNameCell
        avatar={squad.leader.avatar}
        name={squad.leader.username}
        hoverEffect
      />
    ) : (
      <div className="w-20" />
    ),
  }));

  // Mutations
  const { mutate: createSquad, isPending: isCreating } =
    api.anbu.createSquad.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.anbu.getAll.invalidate();
      },
    });

  // Form
  const createForm = useForm<AnbuCreateSchema>({
    resolver: zodResolver(anbuCreateSchema),
    defaultValues: { leaderId: "", name: "", villageId: "" },
  });

  // Table
  type Squad = ArrayElement<typeof allSquads>;
  const columns: ColumnDefinitionType<Squad, keyof Squad>[] = [
    { key: "squadInfo", header: "Squad", type: "jsx" },
    { key: "leaderInfo", header: "Leader", type: "jsx" },
    { key: "memberCount", header: "# Members", type: "string" },
    { key: "pvpActivity", header: "PVP Activity", type: "string" },
  ];

  // User search
  const maxUsers = 1;
  const { methods: userSearchMethods, user: targetUser } = useUserPicker(maxUsers);

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing ANBU" />;
  if (userData.isOutlaw)
    return (
      <ContentBox title="ANBU" defaultBackHref="/village">
        Unlikely to find outlaw ANBU.
      </ContentBox>
    );
  if (!sectorVillage) return <Loader explanation="Loading sector village" />;
  if (!structure)
    return (
      <ContentBox title="ANBU" defaultBackHref="/village">
        Can not find the ANBU structure in this village.
      </ContentBox>
    );
  if (userData.isBanned) return <BanInfo />;

  // Form handlers
  const onSubmit = createForm.handleSubmit((data) => {
    if (!targetUser) {
      showMutationToast({ success: false, message: "Select leader" });
    } else if (!userData.villageId) {
      showMutationToast({ success: false, message: "What is your village?" });
    } else {
      createSquad({
        ...data,
        villageId: userData.villageId,
        leaderId: targetUser.userId,
      });
    }
  });

  // Derived
  const isKage = userData.userId === sectorVillage.kageId;
  const isElder = userData.rank === "ELDER";
  const canCreateMore =
    allSquads && allSquads?.length < getEffectiveStructureLevel(structure);

  return (
    <>
      <ContentBox
        title="ANBU"
        subtitle="Assigned by Kage & Elders"
        defaultBackHref="/village"
        padding={false}
        topRightContent={
          <>
            {userData?.anbuId && (
              <AutoAttackToggle className="mr-2" iconClassName="h-7 w-7" />
            )}
            {canCreateMore && (isKage || isElder) && (
              <Confirm
                title="Create a new squad"
                proceed_label="Submit"
                button={
                  <Button
                    id="create-anbu-squad"
                    className="w-full"
                    loading={isCreating}
                  >
                    <UsersRound className="mr-2 h-5 w-5" />
                    New Squad
                  </Button>
                }
                disabled={isCreating}
                isValid={createForm.formState.isValid}
                onAccept={onSubmit}
              >
                <Form {...createForm}>
                  <form className="space-y-2" onSubmit={onSubmit}>
                    <FormLabel>Leader</FormLabel>
                    <UserSearchSelect
                      useFormMethods={userSearchMethods}
                      label="Select Leader"
                      showYourself={false}
                      inline={true}
                      maxUsers={maxUsers}
                      showAi={false}
                    />
                    <FormField
                      control={createForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input placeholder="Name of the new squad" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              </Confirm>
            )}
          </>
        }
      >
        <Table
          data={allSquads}
          columns={columns}
          linkPrefix="/anbu/"
          linkColumn={"id"}
        />
      </ContentBox>
    </>
  );
}
