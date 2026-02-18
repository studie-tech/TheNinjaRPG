"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Cog } from "lucide-react";
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
import { Input } from "@/components/ui/input";
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

/** Admin-only dialog for editing the damage formula config stored in the DB */
export const DmgConfigDialog = () => {
  const [open, setOpen] = useState(false);

  // Fetch current live config
  const { data: liveConfig } = api.misc.getDmgConfig.useQuery(undefined, {
    enabled: open,
  });

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

  // Form with compile-time defaults, reset to live values when loaded
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Damage Formula Config</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {DMG_FIELDS.map((f) => (
                <FormField
                  key={f.name}
                  control={form.control}
                  name={f.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">{f.label}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="any"
                          {...field}
                          value={field.value as number}
                        />
                      </FormControl>
                      <p className="text-muted-foreground text-[10px]">
                        {f.description}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Saving..." : "Save Config"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
