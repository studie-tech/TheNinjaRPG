"use client";

import { FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { Badge } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualBadges() {
  // Settings
  const { data: userData } = useUserData();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [badge, setBadge] = useState<Badge | undefined>(undefined);

  // Router for forwarding
  const router = useRouter();

  // Query data
  const {
    data: badges,
    isFetching,
    refetch,
  } = api.badge.getAll.useInfiniteQuery(
    { limit: 50 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allBadges = badges?.pages.flatMap((page) => page.data);

  // Mutations
  const { mutate: create, isPending: load1 } = api.badge.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
      router.push(`/manual/badge/edit/${data.message}`);
    },
  });

  const { mutate: remove, isPending: load2 } = api.badge.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  // Derived
  const isPending = isFetching || load1 || load2;

  // Return JSX
  return (
    <ContentBox
      title="Badges"
      subtitle="All available user badges"
      defaultBackHref="/manual"
      topRightContent={
        userData && canChangeContent(userData.role) ? (
          <Button id="create-badge" onClick={() => create()}>
            <FilePlus className="mr-2 h-6 w-6" />
            New
          </Button>
        ) : undefined
      }
    >
      <p className="mb-2">
        Completing quests, reaching milestones, or assisting in the development of TNR
        can earn you badges. Badges are displayed on your profile, and can be used to
        show off your accomplishments. All badges and details sorrounding them can be
        found below.
      </p>
      <ActionSelector
        items={allBadges}
        labelSingles={true}
        onClick={(id) => {
          setBadge(allBadges?.find((badge) => badge.id === id));
          setIsOpen(true);
        }}
        showBgColor={false}
        roundFull={true}
        hideBorder={true}
        showLabels={true}
        emptyText="No badges exist yet."
      />
      {isOpen && userData && badge && (
        <Modal2
          title="Badge Details"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isValid={false}
          className="max-w-3xl"
        >
          {!isPending && (
            <div className="relative">
              <ItemWithEffects
                hideImage
                item={badge}
                key={badge.id}
                onDelete={(id: string) => {
                  remove({ id });
                  setIsOpen(false);
                }}
                showEdit="badge"
              />
            </div>
          )}
          {isPending && <Loader explanation={`Processing ${badge.name}`} />}
        </Modal2>
      )}
    </ContentBox>
  );
}
