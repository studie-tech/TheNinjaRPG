"use client";

import { useRouter } from "next/navigation";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { describeTitleEffect } from "@/libs/titles";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

/** Manage active and archived catalog entries without exposing private legacy player labels. */
export default function ManualTitles() {
  const router = useRouter();
  const { data: user } = useUserDataSelector((profile) => ({ role: profile.role }));
  const canEdit = !!user && canChangeContent(user.role);
  const { data, isPending, isError, refetch } = api.title.getAll.useQuery(undefined, {
    enabled: canEdit,
  });
  const create = api.title.create.useMutation({
    onSuccess: (result) => {
      showMutationToast(result);
      if (result.success) router.push(`/manual/title/edit/${result.message}`);
    },
  });
  if (!user) return <Loader explanation="Loading title catalog" />;
  if (!canEdit)
    return (
      <ContentBox title="Titles" defaultBackHref="/manual">
        <p>Titles are managed by content staff.</p>
      </ContentBox>
    );
  return (
    <ContentBox
      title="Titles"
      subtitle="Title catalog"
      defaultBackHref="/manual"
      topRightContent={
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          New Title
        </Button>
      }
    >
      <p className="mb-3 text-sm">
        Grant titles through Give Title rewards. Archiving stops future awards and
        preserves collected titles. Legacy player titles are private.
      </p>
      {isPending && <Loader explanation="Loading titles" />}
      {isError && (
        <p role="alert">
          Could not load titles. <Button onClick={() => void refetch()}>Retry</Button>
        </p>
      )}
      <div className="space-y-3">
        {data?.map((entry) => (
          <div key={entry.id} className="rounded-lg border p-3">
            <Link
              href={`/manual/title/edit/${entry.id}`}
              className="font-semibold underline"
            >
              {entry.name}
            </Link>
            {entry.archived && (
              <span className="ml-2 text-muted-foreground">Archived</span>
            )}
            <p className="text-sm">{entry.description}</p>
            {entry.effects.map((effect, index) => (
              <p key={index} className="text-sm">
                {describeTitleEffect(effect)}
              </p>
            ))}
          </div>
        ))}
        {data?.length === 0 && <p>No catalog titles yet.</p>}
      </div>
    </ContentBox>
  );
}
