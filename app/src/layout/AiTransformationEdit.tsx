import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import { useForm, useFormState, useWatch } from "react-hook-form";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRANSFORMATION_TIERS } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { SearchSelect } from "@/layout/SearchSelect";
import { showMutationToast } from "@/libs/toast";
import { type AiTransformationInput, aiTransformationSchema } from "@/validators/ai";

/** Staff control for what an AI becomes when it falls, with the boss it belongs to. */
export const AiTransformationEdit: React.FC<{ userId: string; username: string }> = ({
  userId,
  username,
}) => {
  const utils = api.useUtils();
  const boss = api.ai.getBossFight.useQuery({ aiId: userId });
  const form = useForm<AiTransformationInput>({
    resolver: zodResolver(aiTransformationSchema),
    defaultValues: emptyArrival,
  });
  const { errors } = useFormState({ control: form.control });
  const ais = api.profile.getAllAiNames.useQuery(undefined);
  const nextAiId = useWatch({ control: form.control, name: "nextAiId" });
  const tier = useWatch({ control: form.control, name: "tier" });
  const color = useWatch({ control: form.control, name: "color" });
  const glow = useWatch({ control: form.control, name: "glow" });
  const announce = useWatch({ control: form.control, name: "announce" });
  const saved = boss.data?.transformation;

  useEffect(() => {
    if (saved) form.reset(saved);
  }, [saved, form]);
  const pickNextForm = (aiId: string) => {
    const picked = ais.data?.find((ai) => ai.userId === aiId);
    form.setValue("nextAiId", aiId, { shouldValidate: true });
    if (!picked) return;
    // A first draft of the text, which staff are expected to make their own.
    if (!form.getValues("announce"))
      form.setValue("announce", picked.username.toUpperCase().slice(0, 32));
    if (!form.getValues("log"))
      form.setValue("log", `${username} rises again as ${picked.username}!`);
  };

  const save = api.ai.updateTransformation.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) await utils.ai.getBossFight.invalidate();
    },
  });
  const forms = boss.data?.forms ?? [];
  const nextName =
    ais.data?.find((ai) => ai.userId === nextAiId)?.username ??
    forms.find((entry) => entry.userId === nextAiId)?.username;
  const tierDescription = TRANSFORMATION_TIERS.find(
    (entry) => entry.tier === tier,
  )?.description;

  return (
    <ContentBox
      title="Boss transformation"
      subtitle="What this AI becomes when it falls"
      initialBreak={true}
    >
      {boss.isPending && <Loader explanation="Loading boss fight" />}
      {boss.isError && (
        <div role="alert">
          <p>{boss.error.message}</p>
          <Button onClick={() => void boss.refetch()}>Retry</Button>
        </div>
      )}
      {boss.data && (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((transformation) =>
            save.mutate({ aiId: userId, transformation }),
          )}
        >
          {forms.length > 1 && <BossChain forms={forms} current={userId} />}
          <div>
            <Label htmlFor="transformation-next">Next form</Label>
            <SearchSelect
              id="transformation-next"
              label="Next form"
              searchLabel="Search AIs"
              emptyText="No AI has that name."
              placeholder={ais.isPending ? "Loading AIs…" : "Choose the next form"}
              value={nextAiId}
              options={(ais.data ?? [])
                .filter((ai) => ai.userId !== userId)
                .map((ai) => ({
                  value: ai.userId,
                  label: `${ai.username} (Lv ${ai.level})`,
                }))}
              onChange={pickNextForm}
            />
            <FieldHint>
              {nextName
                ? `When ${username} falls, ${nextName} rises in its place, in the same battle.`
                : `${username} does not transform. Choose the AI that rises in its place when it falls; leave the final form of a boss without one.`}
            </FieldHint>
            <FieldError message={errors.nextAiId?.message ?? ais.error?.message} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="transformation-announce">Banner</Label>
              <Input id="transformation-announce" {...form.register("announce")} />
              <FieldHint>
                Large text across the battlefield as the next form arrives, up to 32
                characters, such as GOD-MODE.
              </FieldHint>
              <FieldError message={errors.announce?.message} />
            </div>
            <div>
              <Label htmlFor="transformation-tier">Intensity</Label>
              <Select
                value={String(tier)}
                onValueChange={(value) => form.setValue("tier", Number(value))}
              >
                <SelectTrigger id="transformation-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSFORMATION_TIERS.map((entry) => (
                    <SelectItem key={entry.tier} value={String(entry.tier)}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>
                How big the arrival cinematic is. {tierDescription} Raise it with each
                form so the boss escalates.
              </FieldHint>
            </div>
          </div>
          <div>
            <Label htmlFor="transformation-log">Battle log line</Label>
            <Input id="transformation-log" {...form.register("log")} />
            <FieldHint>
              Written to the battle log when the next form arrives, up to 200
              characters.
            </FieldHint>
            <FieldError message={errors.log?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
            <ColorField
              id="transformation-color"
              label="Main colour"
              value={color}
              onChange={(value) => form.setValue("color", value)}
            />
            <ColorField
              id="transformation-glow"
              label="Glow colour"
              value={glow}
              onChange={(value) => form.setValue("glow", value)}
            />
            <p
              className="col-span-2 flex items-center justify-center overflow-hidden rounded bg-black p-2 font-black text-2xl text-white italic sm:col-span-1"
              style={{ textShadow: `0 0 6px ${toHex(color)}, 0 0 14px ${toHex(glow)}` }}
            >
              {announce || "PREVIEW"}
            </p>
          </div>
          <FieldHint>
            The main colour outlines the banner and fills the energy column the new form
            rises from; the glow colour fills the halo and lightning around it. The
            black box previews the banner.
          </FieldHint>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              Save transformation
            </Button>
            {saved && (
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate({ aiId: userId, transformation: null });
                  form.reset(emptyArrival);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
        </form>
      )}
    </ContentBox>
  );
};

/** Each form in order; the helper explains what any missing piece means. */
const BossChain: React.FC<{ forms: BossChainForm[]; current: string }> = ({
  forms,
  current,
}) => (
  <ol className="flex flex-wrap items-center gap-2" aria-label="Boss forms in order">
    {forms.map((entry, index) => (
      <li key={entry.userId} className="flex items-center gap-2">
        {index > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
        <Link
          href={`/manual/ai/edit/${entry.userId}`}
          className={`w-20 text-center text-xs ${entry.userId === current ? "font-bold" : ""}`}
        >
          <AvatarImage href={entry.avatar} alt={entry.username} size={56} />
          <span className="mt-1 block truncate">{entry.username}</span>
        </Link>
      </li>
    ))}
  </ol>
);

const ColorField: React.FC<{
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}> = ({ id, label, value, onChange }) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    <input
      id={id}
      type="color"
      className="block h-10 w-20 cursor-pointer rounded border"
      value={toHex(value)}
      onChange={(event) => onChange(Number.parseInt(event.target.value.slice(1), 16))}
    />
  </div>
);

const FieldHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-1 text-muted-foreground text-xs">{children}</p>
);

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="mt-1 text-red-600 text-sm">{message}</p> : null;

const toHex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

const emptyArrival: AiTransformationInput = {
  nextAiId: "",
  announce: "",
  log: "",
  tier: 2,
  color: 0x4de8ff,
  glow: 0xb8f6ff,
};

type BossChainForm = RouterOutputs["ai"]["getBossFight"]["forms"][number];
