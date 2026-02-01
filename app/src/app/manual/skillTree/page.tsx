"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ItemWithEffects from "@/layout/ItemWithEffects";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import SkillTreeFiltering, {
  useFiltering,
  getFilter,
} from "@/layout/SkillTreeFiltering";
import { Button } from "@/components/ui/button";
import { FilePlus, FolderOpen, ChartCandlestick } from "lucide-react";
import { useInfinitePagination } from "@/libs/pagination";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualSkillTree() {
  // Settings
  const utils = api.useUtils();
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Filtering
  const state = useFiltering();

  // Router for forwarding
  const router = useRouter();

  // Data
  const {
    data: skills,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = api.skillTree.getAll.useInfiniteQuery(
    {
      limit: 20,
      ...getFilter(state),
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allSkills = skills?.pages.flatMap((page) => page.data) ?? [];
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutations
  const { mutate: create, isPending: load1 } = api.skillTree.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.skillTree.getAll.invalidate();
        router.push(`/manual/skillTree/edit/${data.message}`);
      }
    },
  });

  const { mutate: deleteSkill, isPending: load2 } = api.skillTree.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.skillTree.getAll.invalidate();
      }
    },
  });

  // Derived calculations
  const totalLoading = isFetching || load1 || load2;

  return (
    <>
      <ContentBox
        title="Skill Tree"
        subtitle="Master your ninja abilities"
        defaultBackHref="/manual"
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            <Link href="/manual/skillTree/balance">
              <Button id="skill-tree-balance" hoverText="Balance Statistics">
                <ChartCandlestick className="h-6 w-6" />
              </Button>
            </Link>
            {userData && canChangeContent(userData.role) && (
              <Link href="/manual/skillTreeFolder">
                <Button hoverText="Manage Folders">
                  <FolderOpen className="h-6 w-6" />
                </Button>
              </Link>
            )}
          </div>
        }
      >
        <p>
          The Skill Tree represents specialized techniques and abilities that
          experienced ninja can learn to enhance their combat prowess. Unlike bloodlines
          which are genetic traits, or jutsu which are learned techniques, skills
          represent refined mastery of specific combat disciplines and strategic
          approaches that transcend traditional jutsu classifications.
        </p>
        <p className="pt-4">
          When you reach the rank of Chunin or higher, you begin earning skill points
          with each level gained. These skill points can be invested in various skills
          organized into tiers, with higher tier skills requiring prerequisite skills
          from lower tiers. Each skill provides passive effects that enhance your combat
          abilities, strategic options, or survival capabilities in the harsh ninja
          world.
        </p>
        <p className="pt-4">
          Skills are organized into folders for easier navigation. Choose your path
          wisely, as each skill point investment shapes your ninja&apos;s unique
          fighting style and strategic approach to combat.
        </p>
      </ContentBox>

      <ContentBox
        title="Database"
        subtitle="All available skills"
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            {userData && canChangeContent(userData.role) && (
              <Button id="create-skill" onClick={() => create()} disabled={load1}>
                <FilePlus className="sm:mr-2 h-6 w-6" />
                {load1 ? "Creating..." : "New"}
              </Button>
            )}

            <SkillTreeFiltering state={state} />
          </div>
        }
      >
        {totalLoading && <Loader explanation="Loading data" />}
        {allSkills.map((skill, i) => (
          <div key={skill.id} ref={i === allSkills.length - 1 ? setLastElement : null}>
            <ItemWithEffects
              item={skill}
              showEdit={
                userData && canChangeContent(userData.role) ? "skillTree" : undefined
              }
              onDelete={
                userData && canChangeContent(userData.role)
                  ? (id: string) => deleteSkill({ id })
                  : undefined
              }
              folderName={
                userData && canChangeContent(userData.role)
                  ? (skill.folder?.name ?? "Uncategorized")
                  : undefined
              }
            />
          </div>
        ))}
      </ContentBox>
    </>
  );
}
