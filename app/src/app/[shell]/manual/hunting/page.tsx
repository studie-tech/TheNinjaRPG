"use client";

import { nanoid } from "nanoid";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { HUNTING_CONTRACT_DEFAULTS, HUNTING_RANKS } from "@/drizzle/constants";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { Confirm } from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { LabeledField } from "@/layout/LabeledField";
import Loader from "@/layout/Loader";
import { SearchSelect } from "@/layout/SearchSelect";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import {
  type HuntingContract,
  type HuntingHabitatContent,
  huntingHabitatSchema,
} from "@/validators/hunting";

/** Author habitats and contract rules through permission-checked hunting procedures. */
export default function HuntingEditor() {
  const { data: user } = useUserDataSelector((u) => ({ role: u.role }));
  const allowed = !!user && canChangeContent(user.role);
  const utils = api.useUtils();
  const [id, setId] = useState<string>();
  const [content, setContent] = useState<HuntingHabitatContent>(newHabitat);
  // The habitat as last loaded or saved; any difference is unsaved work worth guarding.
  const [savedContent, setSavedContent] = useState(() => JSON.stringify(content));
  const unsavedGuard = useUnsavedChangesGuard(JSON.stringify(content) !== savedContent);
  const [message, setMessage] = useState("");
  const form = useRef<HTMLDivElement>(null);
  const definitions = api.hunting.getAll.useQuery(undefined, { enabled: allowed });
  const ais = api.profile.getAllAiNames.useQuery(undefined, { enabled: allowed });
  const items = api.item.getAllNames.useQuery(undefined, { enabled: allowed });
  const save = api.hunting.save.useMutation({
    onSuccess: async (r) => {
      setMessage(r.message);
      if (r.success && "id" in r) {
        setId(r.id);
        setContent(r.content);
        setSavedContent(JSON.stringify(r.content));
        await Promise.all([
          definitions.refetch(),
          utils.hunting.getBoard.invalidate(),
          utils.hunting.getSession.invalidate(),
        ]);
      }
    },
    onError: (e) => setMessage(e.message),
  });
  const remove = api.hunting.delete.useMutation({
    onSuccess: async (r) => {
      setMessage(r.message);
      if (r.success) {
        const fresh = newHabitat();
        setId(undefined);
        setContent(fresh);
        setSavedContent(JSON.stringify(fresh));
        await Promise.all([
          definitions.refetch(),
          utils.hunting.getBoard.invalidate(),
          utils.hunting.getSession.invalidate(),
        ]);
      }
    },
    onError: (e) => setMessage(e.message),
  });
  const pending = save.isPending || remove.isPending;
  /** Merge into the latest draft so rapid field edits preserve each other's values. */
  const patch = (values: Partial<HuntingHabitatContent>) =>
    setContent((c) => ({ ...c, ...values }));
  /** Edit one contract without replacing sibling drafts or their stable IDs. */
  const edit = (index: number, values: Partial<HuntingContract>) =>
    setContent((c) => ({
      ...c,
      contracts: c.contracts.map((contract, i) =>
        i === index ? { ...contract, ...values } : contract,
      ),
    }));
  /** Validate unfinished numeric input and cross-field rules before sending a staff mutation. */
  const submit = () => {
    if (!validateNumberInputs(form.current)) return;
    const parsed = huntingHabitatSchema.safeParse(content);
    if (!parsed.success) {
      setMessage(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
      );
      return;
    }
    save.mutate({ id, content: parsed.data });
  };
  if (!user) return <Loader explanation="Loading content permissions" />;
  if (!allowed)
    return (
      <ContentBox title="Hunting habitats">You cannot edit hunting content.</ContentBox>
    );
  return (
    <ContentBox
      title="Hunting habitats"
      subtitle="Habitats, creatures, contracts and materials"
      defaultBackHref="/manual"
    >
      {unsavedGuard.dialog}
      <div className="space-y-4" ref={form}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              unsavedGuard.confirmDiscard(() => {
                const fresh = newHabitat();
                setId(undefined);
                setContent(fresh);
                setSavedContent(JSON.stringify(fresh));
                setMessage("");
              })
            }
          >
            New habitat
          </Button>
          <Select
            value={id ?? ""}
            disabled={pending}
            onValueChange={(value) => {
              const h = definitions.data?.find((h) => h.id === value);
              if (h) {
                unsavedGuard.confirmDiscard(() => {
                  setId(h.id);
                  setContent(h.content);
                  setSavedContent(JSON.stringify(h.content));
                  setMessage("");
                });
              }
            }}
          >
            <SelectTrigger
              aria-label="Edit existing habitat"
              className="min-w-0 flex-1"
            >
              <SelectValue placeholder="Select habitat" />
            </SelectTrigger>
            <SelectContent>
              {definitions.data?.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.content.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button loading={save.isPending} disabled={pending} onClick={submit}>
            Save habitat
          </Button>
          {id && (
            <Confirm
              title="Delete habitat?"
              disabled={pending}
              isLoading={remove.isPending}
              proceed_label="Delete"
              confirmClassName="bg-red-600 text-white hover:bg-red-700"
              button={
                <Button variant="destructive" disabled={pending}>
                  Delete habitat
                </Button>
              }
              onAccept={() => remove.mutate({ id })}
            >
              Delete &quot;{content.name}&quot; and its {content.contracts.length}{" "}
              {content.contracts.length === 1 ? "contract" : "contracts"}? Hunters who
              already accepted a contract keep their terms.
            </Confirm>
          )}
        </div>
        {(message || definitions.error || ais.error || items.error) && (
          <p role="status" className="whitespace-pre-wrap rounded border p-3">
            {message ||
              definitions.error?.message ||
              ais.error?.message ||
              items.error?.message}
          </p>
        )}
        <fieldset disabled={pending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="Habitat name">
              <Input
                value={content.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </LabeledField>
            <LabeledField label="Habitat sectors (comma separated)">
              <SectorInput
                key={id ?? "new"}
                values={content.sectors}
                onChange={(sectors) => patch({ sectors })}
              />
            </LabeledField>
          </div>
          <LabeledField label="Description">
            <Textarea
              value={content.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </LabeledField>
          <div className="flex items-center gap-2">
            <Switch
              id="habitat-enabled"
              checked={content.enabled}
              onCheckedChange={(enabled) => patch({ enabled })}
            />
            <Label htmlFor="habitat-enabled">Habitat enabled</Label>
          </div>
          <p className="text-muted-foreground text-sm">
            Use published, reachable sectors. Each contract assigns one personal sector.
            Changes apply to newly accepted contracts. Active hunters keep their
            accepted terms, including when a habitat or contract is disabled.
          </p>
          {content.contracts.map((c, ci) => (
            <section key={c.id} className="space-y-3 rounded border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-lg">
                  {c.name || `Contract ${ci + 1}`}
                </h3>
                <Button
                  variant="outline"
                  onClick={() =>
                    patch({ contracts: content.contracts.filter((_, i) => i !== ci) })
                  }
                >
                  Remove contract
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <LabeledField label="Contract name">
                  <Input
                    value={c.name}
                    onChange={(e) => edit(ci, { name: e.target.value })}
                  />
                </LabeledField>
                <LabeledField label="Creature">
                  <SearchSelect
                    label="Creature"
                    value={c.aiId}
                    onChange={(aiId) => edit(ci, { aiId })}
                    placeholder="Select AI creature"
                    disabled={pending}
                    options={
                      ais.data?.map((a) => ({ value: a.userId, label: a.username })) ??
                      []
                    }
                  />
                </LabeledField>
                <LabeledField label="Required hunting rank">
                  <Select
                    value={c.rank}
                    onValueChange={(value) =>
                      edit(ci, { rank: value as HuntingContract["rank"] })
                    }
                  >
                    <SelectTrigger aria-label="Required hunting rank">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HUNTING_RANKS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </LabeledField>
                <LabeledField label="Combat difficulty">
                  <Input
                    value={c.difficulty}
                    onChange={(e) => edit(ci, { difficulty: e.target.value })}
                  />
                </LabeledField>
                <LabeledField label="Approved encounter sectors">
                  <SectorInput
                    key={c.id}
                    values={c.sectors}
                    onChange={(sectors) => edit(ci, { sectors })}
                  />
                </LabeledField>
                <LabeledField label="Preparation time (seconds)">
                  <NumberInput
                    value={c.preparationSeconds}
                    min={0}
                    max={86400}
                    step={1}
                    onValueChange={(v) => edit(ci, { preparationSeconds: v })}
                  />
                </LabeledField>
                <LabeledField label="Successful hunts per allowance">
                  <NumberInput
                    value={c.hunts}
                    min={1}
                    max={1000}
                    step={1}
                    onValueChange={(v) => edit(ci, { hunts: v })}
                  />
                </LabeledField>
                <LabeledField label="Cooldown after final hunt (seconds)">
                  <NumberInput
                    value={c.cooldownSeconds}
                    min={1}
                    max={2592000}
                    step={1}
                    onValueChange={(v) => edit(ci, { cooldownSeconds: v })}
                  />
                </LabeledField>
                <LabeledField label="Hunting experience per victory">
                  <NumberInput
                    value={c.experience}
                    min={0}
                    max={1000000}
                    step={1}
                    onValueChange={(v) => edit(ci, { experience: v })}
                  />
                </LabeledField>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`contract-enabled-${c.id}`}
                    checked={c.enabled}
                    onCheckedChange={(enabled) => edit(ci, { enabled })}
                  />
                  <Label htmlFor={`contract-enabled-${c.id}`}>Contract enabled</Label>
                </div>
              </div>
              <h4 className="font-semibold">Materials</h4>
              <p className="text-sm">
                100% is guaranteed. Lower chances roll independently on each victory.
              </p>
              {c.rewards.map((r, ri) => (
                <div
                  key={`${c.id}-${ri}`}
                  className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4"
                >
                  <LabeledField label="Material">
                    <SearchSelect
                      label="Material"
                      value={r.itemId}
                      placeholder="Select huntable item"
                      disabled={pending}
                      onChange={(itemId) =>
                        edit(ci, {
                          rewards: c.rewards.map((x, i) =>
                            i === ri ? { ...x, itemId } : x,
                          ),
                        })
                      }
                      options={
                        items.data
                          ?.filter((m) => m.canBeHunted)
                          .map((m) => ({ value: m.id, label: m.name })) ?? []
                      }
                    />
                  </LabeledField>
                  <LabeledField label="Quantity">
                    <NumberInput
                      value={r.quantity}
                      min={1}
                      max={1000}
                      step={1}
                      onValueChange={(v) =>
                        edit(ci, {
                          rewards: c.rewards.map((x, i) =>
                            i === ri ? { ...x, quantity: v } : x,
                          ),
                        })
                      }
                    />
                  </LabeledField>
                  <LabeledField label="Drop chance (%)">
                    <NumberInput
                      value={r.chance}
                      min={0.01}
                      max={100}
                      step={0.01}
                      onValueChange={(v) =>
                        edit(ci, {
                          rewards: c.rewards.map((x, i) =>
                            i === ri ? { ...x, chance: v } : x,
                          ),
                        })
                      }
                    />
                  </LabeledField>
                  <Button
                    variant="outline"
                    onClick={() =>
                      edit(ci, { rewards: c.rewards.filter((_, i) => i !== ri) })
                    }
                  >
                    Remove material
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() =>
                  edit(ci, {
                    rewards: [...c.rewards, { itemId: "", quantity: 1, chance: 100 }],
                  })
                }
              >
                Add material
              </Button>
            </section>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              patch({ contracts: [...content.contracts, newContract(content.sectors)] })
            }
          >
            Add creature contract
          </Button>
        </fieldset>
      </div>
    </ContentBox>
  );
}
/** Associate each visible field caption with its nested control. */
/** Preserve comma-separated edits while replacing the draft on selection or reset. */
function SectorInput({
  values,
  onChange,
}: {
  values: number[];
  onChange: (values: number[]) => void;
}) {
  const [draft, setDraft] = useState({ source: values, text: values.join(", ") });
  // Preserve commas when the parent echoes an edit; external values replace the draft.
  return (
    <Input
      value={draft.source === values ? draft.text : values.join(", ")}
      onChange={(e) => {
        const sectors = e.target.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number);
        setDraft({ source: sectors, text: e.target.value });
        onChange(sectors);
      }}
    />
  );
}
/** Begin an empty, disabled habitat draft for staff to populate. */
function newHabitat(): HuntingHabitatContent {
  return { name: "", description: "", enabled: false, sectors: [], contracts: [] };
}
/** Give a draft a stable ID and the habitat's sectors; require staff to choose its AI/material. */
function newContract(sectors: number[]): HuntingContract {
  return {
    id: nanoid(),
    name: "",
    aiId: "",
    rank: "D RANK",
    difficulty: "",
    enabled: true,
    sectors,
    ...HUNTING_CONTRACT_DEFAULTS,
    rewards: [{ itemId: "", quantity: 1, chance: 100 }],
  };
}
