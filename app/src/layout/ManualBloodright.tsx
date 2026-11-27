"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import type { BloodrightOption, Jutsu } from "@/drizzle/schema";
import { useBloodrightCatalogInvalidation } from "@/hooks/bloodright";
import { BloodrightChanges } from "@/layout/BloodrightChanges";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { QueryError } from "@/layout/QueryError";
import { SearchSelect } from "@/layout/SearchSelect";
import {
  applyBloodrightChanges,
  bloodrightNumericFields,
  isBloodrightCurrent,
  normalizeBloodrightTag,
} from "@/libs/bloodrightEffects";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { canAccessHiddenSkillTree, canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import {
  type BloodrightOptionData,
  type BloodrightOptionInput,
  bloodrightOptionSchema,
} from "@/validators/bloodright";

export const ManualBloodright = () => {
  const { data: user } = useUserDataSelector((u) => ({ role: u.role }));
  const [bloodlineId, setBloodlineId] = useState("");
  const [editing, setEditing] = useState<BloodrightOption | "new" | null>(null);
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery();
  const { data, isPending, isError, refetch } = api.bloodright.catalog.useQuery({
    bloodlineId: bloodlineId || undefined,
  });
  const invalidate = useBloodrightCatalogInvalidation();
  const remove = api.bloodright.delete.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) await invalidate();
    },
  });
  const canEdit = !!user && canChangeContent(user.role);
  return (
    <ContentBox
      title="Bloodright"
      subtitle="Bloodline jutsu enhancements"
      defaultBackHref="/manual"
    >
      <p className="mb-4">
        Choose a bloodline, then a jutsu to configure its Bloodright options. Each
        option affects that jutsu and its evolutions and reskins.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Label htmlFor="bloodright-bloodline">Bloodline</Label>
        <div className="w-full sm:w-64">
          <SearchSelect
            id="bloodright-bloodline"
            label="Bloodline"
            value={bloodlineId}
            onChange={setBloodlineId}
            placeholder="Choose a bloodline"
            options={[
              { value: "", label: "All bloodlines" },
              ...(bloodlines?.map((line) => ({ value: line.id, label: line.name })) ??
                []),
            ]}
          />
        </div>
        {canEdit && (
          <Button disabled={!bloodlineId} onClick={() => setEditing("new")}>
            New Bloodright option
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/manual/skillTree">Skill Tree</Link>
        </Button>
      </div>
      {isPending && <Loader explanation="Loading Bloodright" />}
      {isError && (
        <QueryError
          message="Unable to load Bloodright."
          onRetry={() => void refetch()}
        />
      )}
      <div className="space-y-4">
        {data?.options.map((option) => (
          <article key={option.id} className="space-y-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">
                {option.name} · {option.jutsu?.name ?? "Unavailable jutsu"}
              </h3>
              <span>
                {option.hidden ? "Hidden · " : ""}
                {option.seichiSilverCost.toLocaleString()} Seichi Silver
              </span>
            </div>
            <p>{option.description}</p>
            {option.jutsu && (
              <BloodrightChanges
                changes={option.changes}
                effects={option.jutsu.effects}
              />
            )}
            {(!option.jutsu ||
              !isBloodrightCurrent(option.changes, option.jutsu.effects)) && (
              <p role="alert" className="text-destructive">
                The source tags have changed. Edit this option and reselect its tags
                before it can apply.
              </p>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setBloodlineId(option.bloodlineId);
                    setEditing(option);
                  }}
                >
                  Edit
                </Button>
                <Confirm
                  title="Delete Bloodright option"
                  disabled={remove.isPending}
                  confirmDisabled={remove.isPending}
                  button={
                    <Button variant="destructive" disabled={remove.isPending}>
                      Delete
                    </Button>
                  }
                  onAccept={() => remove.mutate({ optionId: option.id })}
                >
                  Delete this option? Purchased options must be refunded first.
                </Confirm>
              </div>
            )}
          </article>
        ))}
      </div>
      {!isPending && !isError && !data?.options.length && (
        <p>
          No Bloodright options are available. Choose a bloodline to create an option.
        </p>
      )}
      {remove.data && !remove.data.success && (
        <p role="alert" className="text-destructive">
          {remove.data.message}
        </p>
      )}
      {editing && (
        <Modal
          title={
            editing === "new" ? "Create Bloodright option" : "Edit Bloodright option"
          }
          isOpen={true}
          setIsOpen={(open) => {
            if (!open) setEditing(null);
          }}
          className="max-w-3xl"
        >
          <BloodrightEditor
            key={editing === "new" ? bloodlineId : editing.id}
            option={editing === "new" ? undefined : editing}
            bloodlineId={bloodlineId}
            jutsus={data?.jutsus ?? []}
            canHide={!!user && canAccessHiddenSkillTree(user.role)}
            onSaved={() => setEditing(null)}
          />
        </Modal>
      )}
    </ContentBox>
  );
};

const BloodrightEditor = ({
  option,
  bloodlineId,
  jutsus,
  canHide,
  onSaved,
}: {
  option?: BloodrightOption;
  bloodlineId: string;
  jutsus: Jutsu[];
  canHide: boolean;
  onSaved: () => void;
}) => {
  const invalidate = useBloodrightCatalogInvalidation();
  const form = useForm<BloodrightOptionInput, unknown, BloodrightOptionData>({
    resolver: zodResolver(bloodrightOptionSchema),
    defaultValues: option ?? {
      bloodlineId,
      jutsuId: "",
      name: "",
      description: "",
      seichiSilverCost: 0,
      hidden: canHide,
      changes: [],
    },
  });
  const values = useWatch({ control: form.control });
  const [tagIndex, setTagIndex] = useState(0);
  const [field, setField] = useState("");
  const [mode, setMode] = useState<"FLAT" | "PERCENT">("FLAT");
  const [increase, setIncrease] = useState("1");
  const save = api.bloodright.save.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await invalidate();
        onSaved();
      }
    },
  });
  const jutsu = jutsus.find((entry) => entry.id === values.jutsuId);
  const fields = bloodrightNumericFields(
    normalizeBloodrightTag(jutsu?.effects[tagIndex]),
  );
  const changes = (values.changes ?? []) as BloodrightOptionData["changes"];
  const valid =
    jutsu &&
    isBloodrightCurrent(changes, jutsu.effects) &&
    applyBloodrightChanges(jutsu.effects, changes);
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(
        (data) => save.mutate({ id: option?.id, updatedAt: option?.updatedAt, data }),
        showFormErrorsToast,
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bloodright-name">Name</Label>
          <Input id="bloodright-name" {...form.register("name")} />
        </div>
        <div>
          <Label htmlFor="bloodright-jutsu">Bloodline jutsu</Label>
          <SearchSelect
            id="bloodright-jutsu"
            label="Bloodline jutsu"
            value={values.jutsuId ?? ""}
            placeholder="Select a jutsu"
            options={jutsus.map((entry) => ({ value: entry.id, label: entry.name }))}
            onChange={(value) => {
              form.setValue("jutsuId", value);
              form.setValue("changes", []);
              setTagIndex(0);
              setField("");
            }}
          />
        </div>
        <div>
          <Label htmlFor="bloodright-cost">Seichi Silver cost</Label>
          <NumberInput
            id="bloodright-cost"
            min={0}
            step={1}
            {...form.register("seichiSilverCost", { valueAsNumber: true })}
          />
        </div>
        {canHide && (
          <label htmlFor="bloodright-hidden" className="flex items-center gap-2">
            <Checkbox
              id="bloodright-hidden"
              checked={values.hidden}
              onCheckedChange={(value) => form.setValue("hidden", value === true)}
            />
            Hidden
          </label>
        )}
      </div>
      <div>
        <Label htmlFor="bloodright-description">Description</Label>
        <Textarea id="bloodright-description" {...form.register("description")} />
      </div>
      {jutsu && (
        <fieldset className="space-y-3 rounded-md border p-3">
          <legend>Tag changes</legend>
          <p className="text-muted-foreground text-sm">
            Select any numeric tag field. Flat increases apply first; percentage
            increases add together. Resulting values must satisfy the tag limits.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bloodright-tag">Tag</Label>
              <SearchSelect
                id="bloodright-tag"
                label="Tag"
                value={String(tagIndex)}
                placeholder="Select a tag"
                options={jutsu.effects.map((tag, index) => ({
                  value: String(index),
                  label: `Tag ${index + 1}: ${tag.type}`,
                }))}
                onChange={(value) => {
                  setTagIndex(Number(value));
                  setField("");
                }}
              />
            </div>
            <div>
              <Label htmlFor="bloodright-field">Field</Label>
              <SearchSelect
                id="bloodright-field"
                label="Field"
                value={field}
                placeholder="Select a field"
                options={fields.map((value) => ({ value, label: value }))}
                onChange={setField}
              />
            </div>
            <div>
              <Label htmlFor="bloodright-mode">Increase type</Label>
              <SearchSelect
                id="bloodright-mode"
                label="Increase type"
                value={mode}
                placeholder="Increase type"
                options={[
                  { value: "FLAT", label: "Flat increase" },
                  { value: "PERCENT", label: "Percentage increase" },
                ]}
                onChange={(value) => setMode(value as "FLAT" | "PERCENT")}
              />
            </div>
            <div>
              <Label htmlFor="bloodright-value">Increase</Label>
              <NumberInput
                id="bloodright-value"
                min={0}
                step="any"
                value={increase}
                onTextChange={setIncrease}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              !field ||
              !jutsu.effects[tagIndex] ||
              !Number.isFinite(Number(increase)) ||
              Number(increase) <= 0
            }
            onClick={() => {
              const tag = jutsu.effects[tagIndex];
              if (!tag) return;
              form.setValue(
                "changes",
                [
                  ...changes,
                  {
                    tagIndex,
                    tag,
                    field,
                    mode,
                    value: Number(increase),
                  },
                ],
                { shouldDirty: true },
              );
            }}
          >
            Add tag change
          </Button>
          {changes.map((change, index) => (
            <div key={index} className="flex items-center justify-between gap-2">
              <BloodrightChanges changes={[change]} effects={jutsu.effects} />
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  form.setValue(
                    "changes",
                    changes.filter((_, entryIndex) => entryIndex !== index),
                    { shouldDirty: true },
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          {!!changes.length && (
            <div className="space-y-2 border-t pt-3">
              <b>Combined preview</b>
              <BloodrightChanges changes={changes} effects={jutsu.effects} />
              {!valid && (
                <p role="alert" className="text-destructive">
                  Reselect changed tags or adjust the increases to satisfy the tag
                  limits.
                </p>
              )}
            </div>
          )}
        </fieldset>
      )}
      {save.data && !save.data.success && (
        <p role="alert" className="text-destructive">
          {save.data.message}
        </p>
      )}
      <Button type="submit" disabled={save.isPending || !valid}>
        {save.isPending ? "Saving…" : "Save Bloodright option"}
      </Button>
    </form>
  );
};
