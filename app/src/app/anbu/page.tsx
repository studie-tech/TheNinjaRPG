"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UsersRound, Zap, ZapOff } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
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
import { useLocalStorage } from "@/hooks/localstorage";
import AutoAttackModal from "@/layout/AutoAttackModal";
import AvatarImage from "@/layout/Avatar";
import BanInfo from "@/layout/BanInfo";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequireInVillage } from "@/utils/UserContext";
import { getEffectiveStructureLevel } from "@/utils/village";
import type { AnbuCreateSchema } from "@/validators/anbu";
import { anbuCreateSchema } from "@/validators/anbu";
import { getSearchValidator } from "@/validators/register";

export default function ANBU() {
  // Utils
  const utils = api.useUtils();

  // Must be in allied village
  const { userData, sectorVillage, access } = useRequireInVillage("/anbu");
  const structure = sectorVillage?.structures.find((s) => s.name === "ANBU");

  // Auto attack state
  const [autoAttackMode, setAutoAttackMode] = useLocalStorage<boolean>(
    "autoAttackMode",
    false,
  );
  const [showAutoAttackModal, setShowAutoAttackModal] = useState<boolean>(false);

  // Queries
  const { data } = api.anbu.getAll.useQuery(
    { villageId: userData?.villageId ?? "" },
    { enabled: !!userData?.villageId },
  );
  const allSquads = data?.map((squad) => ({
    ...squad,
    memberCount: squad.members.length,
    squadInfo: (
      <div className="w-20 text-center">
        <AvatarImage
          href={squad.image}
          alt={squad.name}
          size={100}
          hover_effect={true}
          priority
        />
        {squad.name}
      </div>
    ),
    leaderInfo: (
      <div className="w-20 text-center">
        {squad.leader && (
          <div>
            <AvatarImage
              href={squad.leader.avatar}
              alt={squad.name}
              size={100}
              hover_effect={true}
              priority
            />
            {squad.leader.username}
          </div>
        )}
      </div>
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
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const targetUser = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing ANBU" />;
  if (!sectorVillage) return <Loader explanation="Loading sector village" />;
  if (!structure) return <Loader explanation="Can not find structure" />;
  if (isCreating) return <Loader explanation="Creating squad" />;
  if (userData.isOutlaw) return <Loader explanation="Unlikely to find outlaw ANBU" />;
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
            {userData?.anbuId &&
              (autoAttackMode ? (
                <Button
                  className="mr-2 text-red-500"
                  aria-label="Disable auto attack"
                  hoverText="Auto Attack"
                  onClick={() => setAutoAttackMode(false)}
                >
                  <Zap className="h-7 w-7" />
                </Button>
              ) : (
                <Button
                  className="mr-2 hover:text-red-500"
                  aria-label="Configure auto attack"
                  hoverText="Auto Attack"
                  onClick={() => setShowAutoAttackModal(true)}
                >
                  <ZapOff className="h-7 w-7" />
                </Button>
              ))}
            {canCreateMore && (isKage || isElder) && (
              <Confirm2
                title="Create a new squad"
                proceed_label="Submit"
                button={
                  <Button id="create-anbu-squad" className="w-full">
                    <UsersRound className="mr-2 h-5 w-5" />
                    New Squad
                  </Button>
                }
                isValid={createForm.formState.isValid}
                onAccept={onSubmit}
              >
                <Form {...createForm}>
                  <form className="space-y-2" onSubmit={onSubmit}>
                    <FormLabel>Leader</FormLabel>
                    <UserSearchSelect
                      useFormMethods={userSearchMethods}
                      label="Select Leader"
                      selectedUsers={[]}
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
              </Confirm2>
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

      {/* Auto Attack Configuration Modal */}
      <AutoAttackModal
        isOpen={showAutoAttackModal}
        setIsOpen={setShowAutoAttackModal}
        onEnable={() => setAutoAttackMode(true)}
      />
    </>
  );
}
