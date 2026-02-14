"use client";

import { FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BloodFiltering, { getFilter, useFiltering } from "@/layout/BloodlineFiltering";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualBloodlineReskins() {
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const router = useRouter();
  const { data: userData } = useUserData();
  const canEdit = Boolean(userData && canChangeContent(userData.role));
  const [selectedBloodlineId, setSelectedBloodlineId] = useState<string>("");

  // Filtering
  const state = useFiltering();

  // Get reskinned bloodlines
  const {
    data: reskins,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = api.bloodline.getAllReskins.useInfiniteQuery(
    { limit: 10, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allReskins = reskins?.pages.flatMap((page) => page.data);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Transform reskins to ItemWithEffects-friendly shape (overlay on base)
  const transformedReskins = allReskins?.map((r) => ({
    ...r.bloodline,
    id: r.id,
    name: r.name,
    description: r.description,
    image: r.image,
    createdAt: r.createdAt,
    createdBy: r.userUsername,
    updatedAt: r.updatedAt,
    isReskin: true,
  }));

  const totalLoading = isFetching;

  // Fetch base bloodlines for creation
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: canEdit,
  });
  // Initialize selection when list loads
  useEffect(() => {
    const firstBloodlineId = bloodlines?.[0]?.id;
    if (!selectedBloodlineId && firstBloodlineId) {
      setSelectedBloodlineId(firstBloodlineId);
    }
  }, [bloodlines, selectedBloodlineId]);

  // Mutation: create reskin and jump to edit page
  const { mutate: createReskin, isPending: isCreating } =
    api.bloodline.createReskin.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          router.push(`/manual/bloodline/reskins/edit/${data.message}`);
        }
      },
    });

  return (
    <>
      <ContentBox
        title="Bloodline Reskins"
        subtitle="Staff-curated cosmetics"
        defaultBackHref="/manual/bloodline"
      >
        <p>
          Bloodline reskins are curated by staff. They change only presentation (name,
          description, image), not mechanics.
        </p>
      </ContentBox>
      <ContentBox
        title="Database"
        subtitle="All bloodline reskins"
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row items-center gap-1">
            {canEdit && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="create-bloodline-reskin"
                    disabled={!bloodlines || bloodlines.length === 0 || isCreating}
                  >
                    <FilePlus className="h-6 w-6" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <div className="flex flex-col gap-2">
                    <Label>Bloodline</Label>
                    <Select
                      value={selectedBloodlineId}
                      onValueChange={setSelectedBloodlineId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select bloodline" />
                      </SelectTrigger>
                      <SelectContent>
                        {(bloodlines ?? []).map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={!selectedBloodlineId || isCreating}
                      onClick={() =>
                        createReskin({
                          bloodlineId: selectedBloodlineId,
                          name: "New Bloodline Reskin",
                          description: "New bloodline reskin description",
                        })
                      }
                    >
                      Create
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <BloodFiltering state={state} />
          </div>
        }
      >
        {totalLoading && <Loader explanation="Loading data" />}
        {transformedReskins?.map((reskin, i) => (
          <div
            key={reskin.id}
            ref={i === transformedReskins.length - 1 ? setLastElement : null}
          >
            <ItemWithEffects item={reskin} showEdit="bloodline/reskins" />
          </div>
        ))}
        {!totalLoading && transformedReskins?.length === 0 && (
          <div>No reskins found given the search criteria.</div>
        )}
      </ContentBox>
    </>
  );
}
