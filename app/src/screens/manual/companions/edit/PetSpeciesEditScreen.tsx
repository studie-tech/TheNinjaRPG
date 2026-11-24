"use client";

import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { SpeciesEditor } from "@/screens/manual/companions/SpeciesEditor";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Edit stable species records; retirement preserves companions already adopted. */
export function PetSpeciesEditScreen(props: { params: { speciesid: string } }) {
  const { speciesid } = props.params;
  const { data: userData } = useRequiredUserDataSelector((u) => ({ role: u.role }));
  const canEdit = !!userData && canChangeContent(userData.role);
  const {
    data: species,
    isPending,
    error,
    refetch,
  } = api.petSpecies.get.useQuery({ id: speciesid }, { enabled: canEdit });
  const heading = useEditorTitle("companion species", species?.name);
  return (
    <ContentBox
      title={heading}
      subtitle="Companion Species Management"
      defaultBackHref="/manual/companions"
      noRightAlign
    >
      {!userData ? (
        <Loader explanation="Loading account" />
      ) : !canEdit ? (
        <p>Only Content staff can edit companion species.</p>
      ) : isPending ? (
        <Loader explanation="Loading companion species" />
      ) : error ? (
        <div role="alert">
          <p>Could not load this companion species. {error.message}</p>
          <Button variant="outline" className="mt-2" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : !species ? (
        <p>Could not find this companion species.</p>
      ) : (
        <SpeciesEditor species={species} onSaved={() => undefined} />
      )}
    </ContentBox>
  );
}
