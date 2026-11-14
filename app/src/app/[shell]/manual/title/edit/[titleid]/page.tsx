"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { use } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { MasteryTypes, TITLE_MAX_EFFECTS } from "@/drizzle/constants";
import type { Title } from "@/drizzle/schema";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import { type TitleData, TitleValidator } from "@/validators/title";

/** Load an authorized catalog record before mounting its editable form. */
export default function TitleEdit({
  params,
}: {
  params: Promise<{ titleid: string }>;
}) {
  const { titleid } = use(params);
  const { data: user } = useUserDataSelector((profile) => ({ role: profile.role }));
  const canEdit = !!user && canChangeContent(user.role);
  const { data, isPending, isError, refetch } = api.title.get.useQuery(
    { id: titleid },
    { enabled: canEdit },
  );
  if (!user) return <Loader explanation="Loading title editor" />;
  if (!canEdit) return <p>Titles are managed by content staff.</p>;
  if (isError)
    return (
      <p role="alert">
        Could not load title. <Button onClick={() => void refetch()}>Retry</Button>
      </p>
    );
  if (isPending) return <Loader explanation="Loading title" />;
  return <SingleTitleEdit title={data} />;
}

/** Edit future award bonuses without changing snapshots already collected by players. */
const SingleTitleEdit = ({ title }: { title: Title }) => {
  const form = useForm<TitleData>({
    values: title,
    resolver: zodResolver(TitleValidator),
    mode: "all",
    resetOptions: { keepDirtyValues: true },
  });
  const effects = useWatch({ control: form.control, name: "effects" });
  const entryName = useWatch({ control: form.control, name: "name" });
  const heading = useEditorTitle("title", entryName);
  const utils = api.useUtils();
  const save = api.title.update.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) await utils.title.invalidate();
    },
  });
  // Custom effect controls participate in the shared form's dirty and validation lifecycle.
  const setEffects = (next: TitleData["effects"]) =>
    form.setValue("effects", next, { shouldDirty: true, shouldValidate: true });
  return (
    <ContentBox
      title={heading}
      subtitle="Title Management"
      defaultBackHref="/manual/title"
    >
      <EditContent
        schema={TitleValidator}
        form={form}
        formData={[
          { id: "name", label: "Title Name", type: "text" },
          { id: "description", type: "text" },
          { id: "archived", type: "boolean" },
        ]}
        type="title"
        relationId={title.id}
        showSubmit
        buttonTxt="Save to Database"
        submitLoading={save.isPending}
        onAccept={form.handleSubmit(
          (data) => save.mutate({ id: title.id, data }),
          showFormErrorsToast,
        )}
      >
        <div className="col-span-full space-y-3">
          <p className="text-sm">
            Static bonuses stack across all collected titles. Bonus edits apply to
            future awards; players keep their collected bonuses.
          </p>
          {effects.map((effect, index) => (
            <fieldset
              key={index}
              className="space-y-2 rounded border p-3"
              disabled={save.isPending}
            >
              <legend>Effect {index + 1}</legend>
              <label className="block">
                Tag{" "}
                <select
                  aria-label={`Effect ${index + 1} tag`}
                  className="rounded border bg-background p-2"
                  value={effect.type}
                  onChange={(event) =>
                    setEffects(
                      effects.map((entry, i) =>
                        i !== index
                          ? entry
                          : event.target.value === "increasemastery"
                            ? {
                                type: "increasemastery",
                                power: entry.power,
                                masteryTypes: ["Ninjutsu"],
                              }
                            : { type: "increaseregeneration", power: entry.power },
                      ),
                    )
                  }
                >
                  <option value="increasemastery">Increase Mastery</option>
                  <option value="increaseregeneration">Increase Regeneration</option>
                </select>
              </label>
              <label className="block" htmlFor={`title-power-${index}`}>
                Static bonus{" "}
                <NumberInput
                  id={`title-power-${index}`}
                  aria-label={`Effect ${index + 1} static bonus`}
                  min={0}
                  step="any"
                  value={effect.power}
                  onValueChange={(power) =>
                    setEffects(
                      effects.map((entry, i) =>
                        i === index ? { ...entry, power } : entry,
                      ),
                    )
                  }
                />
              </label>
              {effect.type === "increasemastery" && (
                <div className="flex flex-wrap gap-3">
                  {MasteryTypes.map((mastery) => (
                    <label key={mastery}>
                      <input
                        type="checkbox"
                        checked={effect.masteryTypes.includes(mastery)}
                        onChange={(event) =>
                          setEffects(
                            effects.map((entry, i) =>
                              i !== index || entry.type !== "increasemastery"
                                ? entry
                                : {
                                    ...entry,
                                    masteryTypes: event.target.checked
                                      ? [...entry.masteryTypes, mastery]
                                      : entry.masteryTypes.filter(
                                          (value) => value !== mastery,
                                        ),
                                  },
                            ),
                          )
                        }
                      />{" "}
                      {mastery}
                    </label>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setEffects(effects.filter((_, i) => i !== index))}
              >
                Remove effect
              </Button>
            </fieldset>
          ))}
          {form.formState.errors.effects && (
            <p role="alert" className="text-destructive">
              Each mastery effect needs a mastery and all bonuses must be nonnegative
              numbers.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending || effects.length >= TITLE_MAX_EFFECTS}
            onClick={() =>
              setEffects([
                ...effects,
                { type: "increasemastery", power: 1, masteryTypes: ["Ninjutsu"] },
              ])
            }
          >
            Add effect
          </Button>
        </div>
      </EditContent>
      <SuggestChange
        entityType="TITLE"
        entityId={title.id}
        getData={() => form.getValues()}
        label="Suggest instead"
      />
    </ContentBox>
  );
};
