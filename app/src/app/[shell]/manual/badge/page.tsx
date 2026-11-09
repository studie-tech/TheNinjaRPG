"use client";

import { FilePlus } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { Badge } from "@/drizzle/schema";
import { useContentListActions } from "@/hooks/useContentListActions";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { useInfinitePagination } from "@/libs/pagination";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualBadges() {
  // Settings
  const { data: userData } = useUserData();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [badge, setBadge] = useState<Badge | undefined>(undefined);
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Query data
  const {
    data: badges,
    isFetching,
    isError,
    isFetchNextPageError,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = api.badge.getAll.useInfiniteQuery(
    { limit: 50 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allBadges = badges?.pages.flatMap((page) => page.data);
  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  const { onCreated, onDeleted } = useContentListActions(refetch, "/manual/badge/edit");

  // Mutations
  const { mutate: create, isPending: load1 } = api.badge.create.useMutation({
    onSuccess: onCreated,
  });

  const { mutate: remove, isPending: load2 } = api.badge.delete.useMutation({
    onSuccess: onDeleted,
  });

  // Derived
  const isPending = load1 || load2;

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
        show off your accomplishments. All badges and details surrounding them can be
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
        setLastElement={setLastElement}
      />
      <div className="flex min-h-[64px] items-center justify-center" aria-live="polite">
        {isFetching ? (
          <Loader noPadding explanation="Loading badges" />
        ) : isError ? (
          <div role="alert" className="text-center">
            <p>Could not load {isFetchNextPageError ? "more badges" : "badges"}.</p>
            <Button
              onClick={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}
            >
              Try again
            </Button>
          </div>
        ) : hasNextPage ? (
          <Button onClick={() => void fetchNextPage()}>Load more badges</Button>
        ) : null}
      </div>
      {isOpen && userData && badge && (
        <Modal
          title="Badge Details"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          keepOpenOnAccept
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
        </Modal>
      )}
    </ContentBox>
  );
}
