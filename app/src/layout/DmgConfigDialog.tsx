"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Cog } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JutsuEquipLimitsForm } from "@/layout/JutsuEquipLimitsForm";
import { SharedCooldownForm } from "@/layout/SharedCooldownForm";
import { WarRulesForm } from "@/layout/WarRulesForm";
import { dmgConfig as defaultDmgConfig } from "@/libs/combat/constants";
import { showMutationToast } from "@/libs/toast";
import { confSchema } from "@/validators/combat";

/** DMG config field metadata for form rendering */
const DMG_FIELDS = [
  {
    name: "stats_scaling",
    label: "Stats Scaling",
    description: "Stat power multiplier",
  },
  { name: "base_hits", label: "Base Hits", description: "Target time-to-kill in hits" },
  { name: "curve", label: "Curve", description: "Advantage curve sharpness" },
  { name: "amplitude", label: "Amplitude", description: "Advantage scaling amplitude" },
  {
    name: "ep_normalization",
    label: "EP Normalization",
    description: "Standard EP for normalization",
  },
  {
    name: "gen_weight",
    label: "General Weight",
    description: "General stats weight multiplier",
  },
  {
    name: "advantage_min",
    label: "Advantage Min",
    description: "Minimum advantage modifier",
  },
  {
    name: "advantage_max",
    label: "Advantage Max",
    description: "Maximum advantage modifier",
  },
] as const;

type ConfSchemaInput = z.input<typeof confSchema>;
type ConfSchemaOutput = z.infer<typeof confSchema>;

/** Admin-only sections for damage, cooldown, equip limit and war settings. */
export const DmgConfigDialog = () => {
  const [open, setOpen] = useState(false);

  // Mutation
  const utils = api.useUtils();
  const { mutate: save, isPending } = api.misc.setDmgConfig.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.misc.getDmgConfig.invalidate();
      }
    },
  });

  const form = useDmgConfigForm({ enabled: open });

  const onSubmit = form.handleSubmit((values) => save(values));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <span className="flex items-center gap-1">
            <Cog className="w-5 h-5 mr-1" />
            Battle Config
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Battle Config</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="damage" className="flex min-h-0 flex-col">
          <TabsList aria-label="Battle configuration sections" className="shrink-0">
            <TabsTrigger value="damage" className="min-h-10 flex-1">
              Damage
            </TabsTrigger>
            <TabsTrigger value="cooldowns" className="min-h-10 flex-1">
              Cooldowns
            </TabsTrigger>
            <TabsTrigger value="limits" className="min-h-10 flex-1">
              Equip Limits
            </TabsTrigger>
            <TabsTrigger value="war" className="min-h-10 flex-1">
              War Rules
            </TabsTrigger>
          </TabsList>
          <TabsContent value="damage" className="min-h-0 overflow-y-auto">
            <Form {...form}>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <DmgConfigFields form={form} detailed />
                </div>
                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Config"}
                </Button>
              </form>
            </Form>
          </TabsContent>
          <TabsContent value="cooldowns" className="min-h-0 overflow-y-auto">
            <SharedCooldownForm />
          </TabsContent>
          <TabsContent value="limits" className="min-h-0 overflow-y-auto">
            <JutsuEquipLimitsForm />
          </TabsContent>
          <TabsContent value="war" className="min-h-0 overflow-y-auto">
            <WarRulesForm />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

/** Damage config form with compile-time defaults, reset to live values once loaded. */
export const useDmgConfigForm = ({ enabled }: { enabled: boolean }) => {
  const { data: liveConfig } = api.misc.getDmgConfig.useQuery(undefined, { enabled });

  const form = useForm<ConfSchemaInput, unknown, ConfSchemaOutput>({
    defaultValues: confSchema.parse(defaultDmgConfig),
    mode: "all",
    resolver: zodResolver(confSchema),
  });

  useEffect(() => {
    if (liveConfig) {
      form.reset(confSchema.parse(liveConfig));
    }
  }, [liveConfig, form]);

  return form;
};

interface DmgConfigFieldsProps {
  form: ReturnType<typeof useDmgConfigForm>;
  /** Show readable labels and descriptions instead of the raw parameter names. */
  detailed?: boolean;
}

/** Number inputs of the damage formula parameters; render inside the form provider. */
export const DmgConfigFields: React.FC<DmgConfigFieldsProps> = ({ form, detailed }) =>
  DMG_FIELDS.map((f) => (
    <FormField
      key={f.name}
      control={form.control}
      name={f.name}
      render={({ field }) => (
        <FormItem>
          {detailed ? (
            <FormLabel className="text-xs">{f.label}</FormLabel>
          ) : (
            <FormLabel>{f.name}</FormLabel>
          )}
          <FormControl>
            <NumberInput
              step="any"
              {...field}
              value={field.value as number}
              onValueChange={field.onChange}
            />
          </FormControl>
          {detailed && (
            <p className="text-muted-foreground text-[10px]">{f.description}</p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  ));
