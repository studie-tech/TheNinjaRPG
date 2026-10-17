"use client";

import { nanoid } from "nanoid";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { HUNTING_CONTRACT_DEFAULTS, HUNTING_RANKS } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import {
  type HuntingContract,
  type HuntingHabitatContent,
  huntingHabitatSchema,
} from "@/validators/hunting";

/** Author habitats and contract rules through permission-checked hunting procedures. */
export default function HuntingEditor() {
  const { data: user } = useUserData();
  const allowed = !!user && canChangeContent(user.role);
  const utils = api.useUtils();
  const [id, setId] = useState<string>();
  const [content, setContent] = useState<HuntingHabitatContent>(newHabitat);
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
        await Promise.all([definitions.refetch(), utils.hunting.getBoard.invalidate()]);
      }
    },
    onError: (e) => setMessage(e.message),
  });
  const remove = api.hunting.delete.useMutation({
    onSuccess: async (r) => {
      setMessage(r.message);
      if (r.success) {
        setId(undefined);
        setContent(newHabitat());
        await Promise.all([definitions.refetch(), utils.hunting.getBoard.invalidate()]);
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
      <div className="space-y-4" ref={form}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setId(undefined);
              setContent(newHabitat());
              setMessage("");
            }}
          >
            New habitat
          </Button>
          <select
            aria-label="Edit existing habitat"
            className="min-w-0 flex-1 rounded border bg-background p-2"
            value={id ?? ""}
            disabled={pending}
            onChange={(e) => {
              const h = definitions.data?.find((h) => h.id === e.target.value);
              if (h) {
                setId(h.id);
                setContent(h.content);
                setMessage("");
              }
            }}
          >
            <option value="">Select habitat</option>
            {definitions.data?.map((h) => (
              <option key={h.id} value={h.id}>
                {h.content.name}
              </option>
            ))}
          </select>
          <Button loading={save.isPending} disabled={pending} onClick={submit}>
            Save habitat
          </Button>
          {id && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => remove.mutate({ id })}
            >
              Delete habitat
            </Button>
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
            <Field label="Habitat name">
              <Input
                value={content.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="Habitat sectors (comma separated)">
              <SectorInput
                key={id ?? "new"}
                values={content.sectors}
                onChange={(sectors) => patch({ sectors })}
              />
            </Field>
          </div>
          <Field label="Description">
            <Textarea
              value={content.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={content.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Habitat enabled
          </label>
          <p className="text-muted-foreground text-sm">
            Use published, reachable sectors. Each contract assigns one personal sector.
            Staff edits apply to accepted sessions when the next fight starts. Disable
            content to retire it while hunters finish their current battles.
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
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Contract name">
                  <Input
                    value={c.name}
                    onChange={(e) => edit(ci, { name: e.target.value })}
                  />
                </Field>
                <Field label="Creature">
                  <select
                    className="w-full rounded border bg-background p-2"
                    value={c.aiId}
                    onChange={(e) => edit(ci, { aiId: e.target.value })}
                  >
                    <option value="">Select AI creature</option>
                    {ais.data?.map((a) => (
                      <option key={a.userId} value={a.userId}>
                        {a.username}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Required hunting rank">
                  <select
                    className="w-full rounded border bg-background p-2"
                    value={c.rank}
                    onChange={(e) =>
                      edit(ci, { rank: e.target.value as HuntingContract["rank"] })
                    }
                  >
                    {HUNTING_RANKS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Combat difficulty">
                  <Input
                    value={c.difficulty}
                    onChange={(e) => edit(ci, { difficulty: e.target.value })}
                  />
                </Field>
                <Field label="Approved encounter sectors">
                  <SectorInput
                    key={c.id}
                    values={c.sectors}
                    onChange={(sectors) => edit(ci, { sectors })}
                  />
                </Field>
                <Field label="Preparation time (seconds)">
                  <NumberInput
                    value={c.preparationSeconds}
                    min={0}
                    max={86400}
                    step={1}
                    onValueChange={(v) => edit(ci, { preparationSeconds: v })}
                  />
                </Field>
                <Field label="Successful hunts per allowance">
                  <NumberInput
                    value={c.hunts}
                    min={1}
                    max={1000}
                    step={1}
                    onValueChange={(v) => edit(ci, { hunts: v })}
                  />
                </Field>
                <Field label="Cooldown after final hunt (seconds)">
                  <NumberInput
                    value={c.cooldownSeconds}
                    min={1}
                    max={2592000}
                    step={1}
                    onValueChange={(v) => edit(ci, { cooldownSeconds: v })}
                  />
                </Field>
                <Field label="Hunting experience per victory">
                  <NumberInput
                    value={c.experience}
                    min={0}
                    max={1000000}
                    step={1}
                    onValueChange={(v) => edit(ci, { experience: v })}
                  />
                </Field>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => edit(ci, { enabled: e.target.checked })}
                  />
                  Contract enabled
                </label>
              </div>
              <h4 className="font-semibold">Materials</h4>
              <p className="text-sm">
                100% is guaranteed. Lower chances roll independently on each victory.
              </p>
              {c.rewards.map((r, ri) => (
                <div
                  key={`${c.id}-${ri}`}
                  className="grid items-end gap-2 sm:grid-cols-4"
                >
                  <Field label="Material">
                    <select
                      className="w-full rounded border bg-background p-2"
                      value={r.itemId}
                      onChange={(e) =>
                        edit(ci, {
                          rewards: c.rewards.map((x, i) =>
                            i === ri ? { ...x, itemId: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      <option value="">Select huntable item</option>
                      {items.data
                        ?.filter((m) => m.canBeHunted)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Quantity">
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
                  </Field>
                  <Field label="Drop chance (%)">
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
                  </Field>
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="block space-y-1">
      <span className="block">{label}</span>
      {children}
    </Label>
  );
}
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
