"use client";

import { ChartCandlestick, FilePlus, FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import { useSkillTreeCatalogInvalidation } from "@/hooks/skillTree";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";
import ListLoader from "@/layout/ListLoader";
import SkillTreeFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/SkillTreeFiltering";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canAccessHiddenSkillTree, canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualSkillTree({
  isBloodright = false,
}: {
  isBloodright?: boolean;
}) {
  // Settings
  const invalidateSkillTreeCatalog = useSkillTreeCatalogInvalidation();
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Filtering
  const state = useFiltering();
  const [bloodlineId, setBloodlineId] = useState("");
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: isBloodright,
  });

  // Router for forwarding
  const router = useRouter();

  // Data
  const {
    data: skills,
    isFetching,
    isPending,
    fetchNextPage,
    hasNextPage,
  } = api.skillTree.getAll.useInfiniteQuery(
    {
      limit: 20,
      ...getFilter(state),
      ...(isBloodright ? { costSkillPoints: undefined } : {}),
      pathType: isBloodright ? "BLOODRIGHT" : "SKILL",
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allSkills = skills?.pages.flatMap((page) => page.data) ?? [];
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutations
  const {
    mutate: create,
    isPending: load1,
    data: createResult,
  } = api.skillTree.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await invalidateSkillTreeCatalog();
        router.push(`/manual/skillTree/edit/${data.message}`);
      }
    },
  });

  const { mutate: deleteSkill, isPending: load2 } = api.skillTree.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await invalidateSkillTreeCatalog();
      }
    },
  });

  // Derived calculations
  const totalLoading = isFetching || load1 || load2;
  const canEdit = !!userData && canChangeContent(userData.role);
  const canSeeHidden = !!userData && canAccessHiddenSkillTree(userData.role);

  return (
    <>
      <ContentBox
        title={isBloodright ? "Bloodright" : "Skill Tree"}
        subtitle="Master your ninja abilities"
        defaultBackHref="/manual"
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            <Link href="/manual/skillTree/balance">
              <Button id="skill-tree-balance" hoverText="Balance Statistics">
                <ChartCandlestick className="h-6 w-6" />
              </Button>
            </Link>
            {canEdit && (
              <Link href="/manual/skillTreeFolder">
                <Button hoverText="Manage Folders">
                  <FolderOpen className="h-6 w-6" />
                </Button>
              </Link>
            )}
          </div>
        }
      >
        {isBloodright ? (
          <p>
            Bloodright paths are attached to a bloodline. Activate up to{" "}
            {MAX_BLOODRIGHT_TIERS} tiers using Seichi Silver. Refunding a tier also
            removes its dependents and returns their original Silver costs. Changing
            bloodlines refunds the entire path.
          </p>
        ) : (
          <>
            <p>
              The Skill Tree represents specialized techniques and abilities that
              experienced ninja can learn to enhance their combat prowess. Unlike
              bloodlines which are genetic traits, or jutsu which are learned
              techniques, skills represent refined mastery of specific combat
              disciplines and strategic approaches that transcend traditional jutsu
              classifications.
            </p>
            <p className="pt-4">
              When you reach the rank of Chunin or higher, you begin earning skill
              points with each level gained. These skill points can be invested in
              various skills organized into tiers, with higher tier skills requiring
              prerequisite skills from lower tiers. Each skill provides passive effects
              that enhance your combat abilities, strategic options, or survival
              capabilities in the harsh ninja world.
            </p>
            <p className="pt-4">
              Skills are organized into folders for easier navigation. Choose your path
              wisely, as each skill point investment shapes your ninja&apos;s unique
              fighting style and strategic approach to combat.
            </p>
          </>
        )}
        <Link
          href={isBloodright ? "/manual/skillTree" : "/manual/bloodright"}
          className="mt-4 inline-block"
        >
          <Button id="switch-skill-path" variant="outline">
            {isBloodright ? "Switch to Skill Tree" : "Switch to Bloodright"}
          </Button>
        </Link>
      </ContentBox>

      <ContentBox
        title="Database"
        subtitle="All available skills"
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            {canEdit && userData && canAccessHiddenSkillTree(userData.role) && (
              <div className="flex flex-wrap gap-2">
                {isBloodright && (
                  <Select value={bloodlineId} onValueChange={setBloodlineId}>
                    <SelectTrigger aria-label="Bloodline for new tier" className="w-48">
                      <SelectValue placeholder="Choose a bloodline" />
                    </SelectTrigger>
                    <SelectContent>
                      {bloodlines?.map((line) => (
                        <SelectItem key={line.id} value={line.id}>
                          {line.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  id="create-skill"
                  onClick={() => create(isBloodright ? { bloodlineId } : undefined)}
                  disabled={load1 || (isBloodright && !bloodlineId)}
                >
                  <FilePlus className="h-6 w-6 sm:mr-2" />
                  {load1 ? "Creating..." : "New"}
                </Button>
              </div>
            )}

            <SkillTreeFiltering state={state} isBloodright={isBloodright} />
          </div>
        }
      >
        {!load1 && createResult && !createResult.success && (
          <p role="alert" className="text-destructive">
            {createResult.message}
          </p>
        )}
        {allSkills.map((skill, i) => (
          <div key={skill.id} ref={i === allSkills.length - 1 ? setLastElement : null}>
            <ItemWithEffects
              item={skill}
              showEdit={canEdit ? "skillTree" : undefined}
              onDelete={canEdit ? (id: string) => deleteSkill({ id }) : undefined}
              folderName={canEdit ? (skill.folder?.name ?? "Uncategorized") : undefined}
            />
          </div>
        ))}
        {!totalLoading && allSkills.length === 0 && (
          <div>
            {!isBloodright
              ? "No skills found given the search criteria."
              : canSeeHidden
                ? "No bloodright tiers match this filter. Choose a bloodline above to create its first tier."
                : "No bloodright tiers are published for this filter yet. Check back once they are released."}
          </div>
        )}
        <ListLoader
          initialLoading={isPending}
          loading={totalLoading}
          explanation="Loading data"
        />
      </ContentBox>
    </>
  );
}
