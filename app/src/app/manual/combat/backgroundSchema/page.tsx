"use client";

import { useRouter } from "next/navigation";
import ItemWithEffects from "@/layout/ItemWithEffects";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import { FilePlus } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { canChangeCombatBgScheme } from "@/utils/permissions";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualbackgroundSchema() {
  // Settings
  const { data: userData } = useUserData();

  // Router for navigation
  const router = useRouter();

  // Data fetching using tRPC
  const {
    data: allbackgroundSchema,
    isFetching,
    refetch,
  } = api.backgroundSchema.getAll.useQuery(undefined);

  // Mutations for creating deleting and activating background schemas
  const { mutate: create, isPending: load1 } = api.backgroundSchema.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
      router.push(`/manual/combat/backgroundSchema/edit/${data.message}`);
    },
  });

  const { mutate: remove, isPending: load2 } = api.backgroundSchema.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  const { mutate: activate, isPending: load3 } =
    api.backgroundSchema.activate.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await refetch();
      },
    });

  // Check if data is loading
  const totalLoading = isFetching || load1 || load2 || load3;

  return (
    <>
      <ContentBox
        title="Combat Background Schemas"
        subtitle="Manage combat background schemas"
        back_href="/manual"
        topRightContent={
          <div className="flex flex-row gap-1 items-center">
            {userData && canChangeContent(userData.role) && (
              <>
                <Button id="create-backgroundSchema" onClick={() => create()}>
                  <FilePlus className="sm:mr-2 h-5 w-5" />
                  New
                </Button>
              </>
            )}
            {/* If you have a BackgroundFiltering component, you can include it here */}
            {/* <BackgroundFiltering state={state} /> */}
          </div>
        }
      >
        <p>
          Combat background schemas define the images used for different environments in
          combat. Only users with appropriate permissions can manage these schemas.
        </p>
      </ContentBox>
      {userData && canChangeContent(userData.role) && (
        <ContentBox
          title="Database"
          subtitle="All Combat Background Schemas"
          initialBreak={true}
        >
          {totalLoading && <Loader explanation="Loading data" />}
          {allbackgroundSchema?.map((backgroundSchema) => (
            <div key={backgroundSchema.id} className="relative">
              <ItemWithEffects
                item={backgroundSchema}
                key={backgroundSchema.id}
                onDelete={(id: string) => remove({ id })}
                showEdit="backgroundSchema"
                hideImage={true}
              />
              {userData &&
                canChangeCombatBgScheme(userData.role) &&
                !backgroundSchema.isActive && (
                  <Button
                    onClick={() => activate({ id: backgroundSchema.id })}
                    className="mb-2 absolute bottom-[-2px] right-2 left-2"
                  >
                    Activate
                  </Button>
                )}
            </div>
          ))}
        </ContentBox>
      )}
    </>
  );
}
