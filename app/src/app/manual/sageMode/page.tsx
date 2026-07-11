"use client";

import { FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import SageModeFiltering, { getFilter, useFiltering } from "@/layout/SageModeFiltering";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualSageModes() {
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const state = useFiltering();
  const router = useRouter();

  const {
    data: sageModes,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = api.sageMode.getAll.useInfiniteQuery(
    { limit: 10, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allSageModes = sageModes?.pages.flatMap((page) => page.data);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  const { mutate: create, isPending: load1 } = api.sageMode.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
      router.push(`/manual/sageMode/edit/${data.message}`);
    },
  });

  const { mutate: remove, isPending: load2 } = api.sageMode.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  const totalLoading = isFetching || load1 || load2;

  return (
    <>
      <ContentBox title="Sage Mode" subtitle="What is it?" defaultBackHref="/manual">
        <p>
          Sage Mode is a powerful transformation that allows ninja to tap into natural
          energy, combining it with their own chakra to dramatically enhance their
          abilities. Unlike bloodlines which are passive abilities, Sage Mode must be
          manually activated during combat and lasts for a limited number of rounds.
        </p>
        <p className="pt-4">
          Once activated, Sage Mode grants powerful buffs to the user. However, when the
          duration expires, the user will experience exhaustion effects as their body
          recovers from channeling natural energy. Sage Mode effects cannot be cleared,
          copied, or mirrored by opponents.
        </p>
        <p className="pt-4">
          Sage Mode comes in two levels. Level 1 can be acquired through rolling or
          purchase. Level 2 is automatically unlocked when you reach sufficient Sage
          Mastery experience.
        </p>
      </ContentBox>
      <ContentBox
        title="Database"
        subtitle="All sage modes"
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row gap-1 items-center">
            {userData && canChangeContent(userData.role) && (
              <Button id="create-sagemode" onClick={() => create()}>
                <FilePlus className="h-5 w-5" />
              </Button>
            )}
            <SageModeFiltering state={state} />
          </div>
        }
      >
        {totalLoading && <Loader explanation="Loading data" />}
        {allSageModes?.map((sageMode, i) => (
          <div
            key={sageMode.id}
            ref={i === allSageModes.length - 1 ? setLastElement : null}
          >
            <ItemWithEffects
              item={sageMode}
              key={sageMode.id}
              onDelete={(id: string) => remove({ id })}
              showEdit="sageMode"
            />
          </div>
        ))}
      </ContentBox>
    </>
  );
}
