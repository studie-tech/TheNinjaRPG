"use client";

import { ChartCandlestick, FilePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import type { GenericObject } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import UserFiltering, { getFilter, useFiltering } from "@/layout/UserFiltering";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualAI() {
  // Settings
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Two-level filtering
  const state = useFiltering();

  // Router for forwarding
  const router = useRouter();

  // Data
  const {
    data: users,
    fetchNextPage,
    refetch,
    hasNextPage,
    isFetching,
  } = api.profile.getPublicUsers.useInfiniteQuery(
    { ...getFilter(state), limit: 30, orderBy: "Weakest", isAi: true },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );
  const allUsers = users?.pages
    .flatMap((page) => page.data)
    .map((user) => {
      return {
        id: user.userId,
        name: user.username,
        image: user.avatar,
        description: "",
        rarity: "COMMON",
        createdAt: user.updatedAt,
        href: `/username/${user.username}`,
        attacks: user.jutsus?.map((jutsu) =>
          "jutsu" in jutsu ? jutsu.jutsu?.name : "Unknown",
        ),
        ...user,
      } as GenericObject;
    });

  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutations
  const { mutate: create, isPending: load1 } = api.profile.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
      router.push(`/manual/ai/edit/${data.message}`);
    },
  });

  const { mutate: remove, isPending: load2 } = api.profile.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  // Derived
  const totalLoading = isFetching || load1 || load2;

  return (
    <>
      <ContentBox
        title="AI"
        subtitle="NPC Opponents"
        defaultBackHref="/manual"
        topRightContent={
          <div className="flex flex-row gap-1">
            <Link href="/manual/ai/balance">
              <Button id="ai-statistics" hoverText="Balance Statistics">
                <ChartCandlestick className="h-6 w-6" />
              </Button>
            </Link>
          </div>
        }
      >
        <p>
          As you progress through the game, the AI opponents will grow more formidable,
          pushing you to continuously improve your ninja abilities and develop new
          strategies. Facing these intelligent opponents will provide a sense of
          achievement when you finally emerge victorious, making the journey through the
          ninja world immersive and rewarding
        </p>
      </ContentBox>
      <ContentBox
        title="Database"
        subtitle="All NPCs"
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            {userData && canChangeContent(userData.role) && (
              <Button id="create-ai" onClick={() => create()}>
                <FilePlus className="mr-2 h-5 w-5" /> New AI
              </Button>
            )}
            <UserFiltering state={state} aiToggles />
          </div>
        }
      >
        {totalLoading && <Loader explanation="Loading data" />}
        {allUsers?.map((user, i) => (
          <div key={user.id} ref={i === allUsers.length - 1 ? setLastElement : null}>
            <ItemWithEffects
              item={user}
              onDelete={(id: string) => remove({ id })}
              showEdit="ai"
              showStatistic="ai"
              showCopy="ai"
              show3d
            />
          </div>
        ))}
      </ContentBox>
    </>
  );
}
