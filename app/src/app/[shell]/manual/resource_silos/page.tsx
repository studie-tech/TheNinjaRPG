"use client";

import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import { useResourceSiloEditor } from "@/hooks/useResourceSilos";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { canManageRewards, isStaffRole } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import type { ResourceSiloSelectionType } from "@/validators/resourceSilos";

/** Staff configure independent package and consumable-cache drop chances. */
export default function ResourceSilosEditor() {
  const { data: user } = useUserData();
  const { editor, save } = useResourceSiloEditor(!!user && isStaffRole(user.role));
  if (!user) return <Loader explanation="Loading user" />;
  if (!isStaffRole(user.role))
    return (
      <ContentBox title="Resource Silos">
        Resource Silos are only available to staff.
      </ContentBox>
    );
  return (
    <ContentBox
      title="Resource Silos"
      subtitle="War-Torn shrine reward pool"
      defaultBackHref="/manual"
    >
      <p className="mb-4">
        Friday–Sunday UTC, a silo opens every three hours for one hour. Every selected
        reward has its own percentage chance; totals do not need to add up to 100%. A
        claim can drop several rewards or none. Saving copies the selected package
        contents. Cache items are awarded unopened.
      </p>
      {editor.isPending && <Loader explanation="Loading silo rewards" />}
      {editor.isError && (
        <p role="alert">
          Could not load rewards.{" "}
          <Button onClick={() => void editor.refetch()}>Retry</Button>
        </p>
      )}
      {editor.data && (
        <SiloRewardForm
          data={editor.data}
          save={save}
          canManage={canManageRewards(user.role)}
        />
      )}
    </ContentBox>
  );
}

const SiloRewardForm = ({
  data,
  save,
  canManage,
}: {
  data: RouterOutputs["resourceSilos"]["getEditor"];
  save: ReturnType<typeof useResourceSiloEditor>["save"];
  canManage: boolean;
}) => {
  const [entries, setEntries] = useState<ResourceSiloSelectionType[]>(
    data.entries.map(({ kind, sourceId, chance }) => ({ kind, sourceId, chance })),
  );
  const [selected, setSelected] = useState("");
  const choices = [
    ...data.packages.map((pack) => ({ ...pack, kind: "package" as const })),
    ...data.caches.map((cache) => ({ ...cache, kind: "cache" as const })),
  ];
  const isSaving = save.isPending;
  const message = save.error?.message ?? save.data?.message;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (validateNumberInputs(event.currentTarget)) save.mutate({ entries });
      }}
    >
      {entries.length === 0 && <p>No silo rewards configured.</p>}
      {entries.map((entry, index) => {
        const source = choices.find(
          (choice) => choice.kind === entry.kind && choice.id === entry.sourceId,
        );
        const saved = data.entries.find(
          (saved) => saved.kind === entry.kind && saved.sourceId === entry.sourceId,
        );
        return (
          <div
            key={`${entry.kind}:${entry.sourceId}`}
            className="flex flex-wrap items-end gap-3 rounded border p-3"
          >
            <div className="min-w-48 flex-1">
              <p className="font-semibold">
                {source?.name ?? saved?.name ?? "Unavailable source"}
              </p>
              <p className="text-sm">
                {entry.kind === "cache" ? "Cache item" : "Reward package"}
                {!source && " · Remove this entry to save"}
              </p>
            </div>
            <label className="w-32" htmlFor={`silo-chance-${index}`}>
              Drop chance (%)
              <NumberInput
                id={`silo-chance-${index}`}
                min="0"
                max="100"
                step="0.01"
                value={entry.chance}
                disabled={!canManage || isSaving}
                onValueChange={(chance) =>
                  setEntries(
                    entries.map((value, i) =>
                      i === index ? { ...value, chance } : value,
                    ),
                  )
                }
              />
            </label>
            {canManage && (
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => setEntries(entries.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            )}
          </div>
        );
      })}
      {canManage && (
        <>
          <label className="block" htmlFor="silo-reward">
            Add package or cache
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              id="silo-reward"
              className="bg-background min-w-0 flex-1 rounded border p-2"
              disabled={isSaving}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Select a reward</option>
              {choices
                .filter(
                  (choice) =>
                    !entries.some(
                      (entry) =>
                        entry.kind === choice.kind && entry.sourceId === choice.id,
                    ),
                )
                .map((choice) => (
                  <option
                    key={`${choice.kind}:${choice.id}`}
                    value={`${choice.kind}:${choice.id}`}
                  >
                    {choice.kind === "cache" ? "Cache" : "Package"}: {choice.name}
                  </option>
                ))}
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={!selected || isSaving || entries.length >= 50}
              onClick={() => {
                const choice = choices.find(
                  (choice) => `${choice.kind}:${choice.id}` === selected,
                );
                if (choice)
                  setEntries([
                    ...entries,
                    { kind: choice.kind, sourceId: choice.id, chance: 100 },
                  ]);
                setSelected("");
              }}
            >
              Add Reward
            </Button>
          </div>
          <Button
            disabled={
              isSaving ||
              entries.some(
                (entry) =>
                  !Number.isFinite(entry.chance) ||
                  entry.chance < 0 ||
                  entry.chance > 100,
              )
            }
            type="submit"
          >
            {isSaving ? "Saving…" : "Save Resource Silos"}
          </Button>
        </>
      )}
      {message && (
        <p
          role={save.error || save.data?.success === false ? "alert" : "status"}
          className="rounded border p-3"
        >
          {message}
        </p>
      )}
    </form>
  );
};
