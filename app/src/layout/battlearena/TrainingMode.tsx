"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Bot, Loader2, Sun, Swords } from "lucide-react";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useSleepToggle } from "@/hooks/sleep";
import ContentBox from "@/layout/ContentBox";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";
import type { StatSchemaType } from "@/validators/combat";
import { createStatSchema } from "@/validators/combat";

/** Training: fight a dummy whose stats you choose. */
export const TrainingMode = (props: AssignTrainingDummyStatsProps) => (
  <>
    <p className="m-2">
      The arena is a fairly basic circular and raw battleground, where you can train
      your skills as a ninja. Opponent is an invicible training dummy who will self
      destruct. Test and hone your skills for future battles.
    </p>
    <AssignTrainingDummyStats {...props} />
  </>
);

interface AssignTrainingDummyStatsProps {
  statDistribution: StatSchemaType | undefined;
  setStatDistribution: (newValue: StatSchemaType | undefined) => void;
}

const AssignTrainingDummyStats: React.FC<AssignTrainingDummyStatsProps> = (props) => {
  // Destructure
  const { statDistribution, setStatDistribution } = props;
  // Data from database
  const { data: userData, updateUser } = useRequiredUserData();
  // Seeded Training Dummy Id
  const aiId = "tra93opw09262024jut5ufa8f";
  // Router for forwarding
  const router = useRouter();

  // Sleep toggle
  const { toggleSleep, isTogglingSleep } = useSleepToggle();

  // Auto combat preference
  const [autoCombat, setAutoCombat] = useAutoCombatSetting();
  const attackInFlightRef = useRef(false);

  // Mutation for starting a fight
  const { mutate: attack, isPending: isAttacking } =
    api.combat.startArenaBattle.useMutation({
      onSuccess: (data) => {
        if (data.success && data.battleId) {
          void updateUser({
            status: "BATTLE",
            battleId: data.battleId,
            updatedAt: new Date(),
          });
          pushToCombat(router, data.battleId);
          showMutationToast({ ...data, message: "Entering the Training" });
        } else {
          attackInFlightRef.current = false;
          showMutationToast(data);
        }
      },
      onError: (error) => {
        attackInFlightRef.current = false;
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Stats Schema
  const { schema: statSchema, maxValues } = createStatSchema(10, 10, undefined);
  const defaultValues = statSchema.parse(statDistribution ?? {});
  const statNames = Object.keys(defaultValues) as (keyof typeof defaultValues)[];

  // Form setup
  const form = useForm<z.input<typeof statSchema>, unknown, StatSchemaType>({
    defaultValues: defaultValues as z.input<typeof statSchema>,
    mode: "all",
    resolver: zodResolver(statSchema),
  });

  // Submit handler
  const onSubmit = form.handleSubmit((data) => {
    if (attackInFlightRef.current || isAttacking) return;
    attackInFlightRef.current = true;
    setStatDistribution(data);
    attack({ aiId: aiId, stats: data, autoCombat });
  });

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Derived
  const isAsleep = userData.status === "ASLEEP";

  // Show component
  return (
    <ContentBox title="Assign Dummy stats" subtitle="" initialBreak={true}>
      <Form {...form}>
        <form
          className="grid grid-cols-2 gap-2"
          aria-busy={isAttacking}
          onSubmit={onSubmit}
        >
          <fieldset disabled={isAttacking} className="contents">
            {statNames
              .filter((x) => x !== "offence")
              .map((stat, i) => {
                const maxValue = maxValues[stat];
                if (maxValue && maxValue > 0) {
                  return (
                    <FormField
                      key={`${stat}-${i}`}
                      control={form.control}
                      name={stat}
                      render={({ field }) => (
                        <FormItem className="pt-1">
                          <FormLabel>{stat}</FormLabel>
                          <FormControl>
                            <NumberInput
                              step="any"
                              placeholder={stat}
                              {...field}
                              value={field.value as number}
                              onValueChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  );
                } else {
                  return (
                    <FormItem className="pt-1" key={`${stat}-${i}`}>
                      <FormLabel>{stat}</FormLabel>
                      <FormControl>
                        <div>- Max</div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }
              })}
            <div className="col-span-2 flex flex-row gap-3">
              <JutsuLoadoutSelector variant="dropdown" label="Jutsu loadout" />
              <ItemLoadoutSelector variant="dropdown" label="Item loadout" />
            </div>
            <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex flex-col">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="h-4 w-4" /> Auto combat
                </p>
                <p className="text-muted-foreground text-xs">
                  Your AI profile fights for you while you watch the battle live
                </p>
              </div>
              <Switch
                checked={autoCombat}
                onCheckedChange={setAutoCombat}
                aria-label="Toggle auto combat"
              />
            </div>
            {isAsleep ? (
              <div className="col-span-2 flex flex-row justify-center">
                {isTogglingSleep ? (
                  <Loader explanation="Waking" />
                ) : (
                  <Button
                    type="button"
                    size="xl"
                    decoration="gold"
                    animation="pulse"
                    className="w-full text-2xl italic"
                    onClick={() => toggleSleep()}
                  >
                    <Sun className="mr-4 h-10 w-10" />
                    Wake up!
                  </Button>
                )}
              </div>
            ) : (
              <div className="col-span-2 flex flex-row justify-center">
                <Button
                  size="xl"
                  decoration="gold"
                  animation="pulse"
                  className="w-full text-2xl italic"
                  disabled={isAttacking}
                  aria-live="polite"
                >
                  {isAttacking ? (
                    <Loader2 className="mr-4 h-10 w-10 animate-spin" aria-hidden />
                  ) : (
                    <Swords className="mr-4 h-10 w-10" />
                  )}
                  {isAttacking ? "Starting" : "Enter arena"}
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </Form>
    </ContentBox>
  );
};
