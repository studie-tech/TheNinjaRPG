"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Chart as ChartJS } from "chart.js/auto";
import { ClipboardCopy, Eye, EyeOff, Save, Trash2, Users } from "lucide-react";
import { nanoid } from "nanoid";
import { use, useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import Toggle from "@/components/control/Toggle";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { GeneralTypes, StatTypes } from "@/drizzle/constants";
import type { DamageSimulation } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import { DmgConfigDialog } from "@/layout/DmgConfigDialog";
import Loader from "@/layout/Loader";
import { battleCalcText } from "@/layout/seoTexts";
import { dmgConfig } from "@/libs/combat/constants";
import { damageUser } from "@/libs/combat/tags";
import type { BattleUserState, Consequence, UserEffect } from "@/libs/combat/types";
import { calcHP, calcLevel } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import { canModifyEventGains } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import { actSchema, confSchema, statSchema } from "@/validators/combat";

// Default user
type StatSchemaInput = z.input<typeof statSchema>;
type StatSchemaOutput = z.infer<typeof statSchema>;
type ActSchemaInput = z.input<typeof actSchema>;
type ActSchemaOutput = z.infer<typeof actSchema>;
type ConfigSchemaInput = z.input<typeof confSchema>;
type ConfigSchemaOutput = z.infer<typeof confSchema>;
const defaultsStats = statSchema.parse({});
const statNames = Object.keys(defaultsStats) as (keyof typeof defaultsStats)[];

export default function Simulator(props: {
  params: Promise<{ damageSimulationId?: string }>;
}) {
  const params = use(props.params);
  // Fetch user data
  const { data: userData } = useUserData();
  const isAdmin = userData?.role ? canModifyEventGains(userData.role) : false;

  // Colors for chart
  const colors = [
    "#1f77b4",
    "#aec7e8",
    "#ff7f0e",
    "#ffbb78",
    "#2ca02c",
    "#98df8a",
    "#d62728",
    "#ff9896",
    "#9467bd",
    "#c5b0d5",
    "#8c564b",
    "#c49c94",
    "#e377c2",
    "#f7b6d2",
    "#7f7f7f",
    "#c7c7c7",
    "#bcbd22",
    "#dbdb8d",
    "#17becf",
    "#9edae5",
  ];

  // Route information
  const damageSimulationId = params.damageSimulationId;

  // Chart ref
  const chartRef = useRef<HTMLCanvasElement>(null);

  // Page state
  const [selectedDmg, setSelectedDmg] = useState<number | undefined>(undefined);
  const [showAll, setShowAll] = useState<boolean | undefined>(undefined);

  // Forms setup
  const conf1 = { defaultValues: defaultsStats, mode: "all" as const };
  const attForm = useForm<StatSchemaInput, unknown, StatSchemaOutput>({
    ...conf1,
    resolver: zodResolver(statSchema),
  });
  const defForm = useForm<StatSchemaInput, unknown, StatSchemaOutput>({
    ...conf1,
    resolver: zodResolver(statSchema),
  });
  const conf2 = { defaultValues: actSchema.parse({}), mode: "all" as const };
  const actForm = useForm<ActSchemaInput, unknown, ActSchemaOutput>({
    ...conf2,
    resolver: zodResolver(actSchema),
  });
  const configForm = useForm<ConfigSchemaInput, unknown, ConfigSchemaOutput>({
    defaultValues: confSchema.parse(dmgConfig),
    mode: "all" as const,
    resolver: zodResolver(confSchema),
  });

  // Fetch live DMG config from DB and reset the form to use it as defaults
  const { data: liveDmgConfig } = api.misc.getDmgConfig.useQuery();
  useEffect(() => {
    if (liveDmgConfig) {
      configForm.reset(confSchema.parse(liveDmgConfig));
    }
  }, [liveDmgConfig, configForm]);

  // Watch all the forms simultaneously
  const attValues = useWatch({ control: attForm.control }) as StatSchemaOutput;
  const defValues = useWatch({ control: defForm.control }) as StatSchemaOutput;
  const actValues = useWatch({ control: actForm.control }) as ActSchemaOutput;
  const configValues = useWatch({
    control: configForm.control,
  }) as ConfigSchemaOutput;

  // Query for fetching previous entries
  const { data, refetch } = api.simulator.getDamageSimulations.useQuery(undefined, {
    enabled: !!userData,
  });
  const { data: previous } = api.simulator.getDamageSimulation.useQuery(
    { id: damageSimulationId ? damageSimulationId : "" },
    { enabled: !!damageSimulationId },
  );

  // Mutation for creating new entry
  const { mutate: saveEntry, isPending: isSaving } =
    api.simulator.createDamageSimulation.useMutation({
      onSuccess: () => refetch(),
    });

  // Mutation for editing entry
  const { mutate: updateEntry, isPending: isUpdating } =
    api.simulator.updateDamageSimulation.useMutation({
      onSuccess: () => refetch(),
    });

  // Mutation for editing entry
  const { mutate: deleteEntry, isPending: isDeleting } =
    api.simulator.deleteDamageSimulation.useMutation({
      onSuccess: () => refetch(),
    });

  const isPending = isSaving || isUpdating || isDeleting;

  // Calculate experience from stats
  const calcExperience = (values: StatSchemaOutput) => {
    return (
      statNames
        .map((k) => values[k])
        .map((v) => Number(v))
        .reduce((a, b) => a + b, 0) - 120
    );
  };

  // Extract information from schema to use for showing forms
  const attExp = calcExperience(attValues);
  const attLevel = calcLevel(attExp);
  const attHp = calcHP(attLevel);
  const defExp = calcExperience(defValues);
  const defLevel = calcLevel(defExp);
  const defHp = calcHP(defLevel);

  // Monkey-wrap the damage function
  const getDamage = (
    attValues: StatSchemaOutput,
    defValues: StatSchemaOutput,
    actValues: ActSchemaOutput,
  ) => {
    const attackerExp = calcExperience(attValues);
    const attackerLevel = calcLevel(attackerExp);
    const defenderExp = calcExperience(defValues);
    const defenderLevel = calcLevel(defenderExp);
    const attacker = {
      ...attValues,
      level: attackerLevel,
      experience: attackerExp,
    } as unknown as BattleUserState;
    const defender = {
      ...defValues,
      level: defenderLevel,
      experience: defenderExp,
    } as unknown as BattleUserState;
    const effect = {
      id: nanoid(),
      power: actValues.power,
      powerPerLevel: 0,
      level: 1,
      rounds: 0,
      castThisRound: true,
      calculation: "formula",
      statTypes: actValues.statTypes,
      generalTypes: actValues.generalTypes,
      fromGround: false,
      barrierAbsorb: 0,
    } as UserEffect;
    const consequences = new Map<string, Consequence>();
    damageUser(effect, attacker, defender, consequences, 1, configValues);
    const result = consequences.get(effect.id)?.damage ?? 0;
    return parseFloat(result.toFixed(2));
  };

  // Update the chart
  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx && data && data?.length > 0) {
      const myChart = new ChartJS(ctx, {
        type: "scatter",
        options: {
          plugins: {
            legend: {
              display: false,
            },
          },
          scales: {
            x: {
              type: "linear",
              ticks: { stepSize: 1 },
              title: { display: true, text: "Previous Calculation" },
            },
            y: {
              type: "linear",
              ticks: { stepSize: 1 },
              title: { display: true, text: "Damage" },
            },
          },
        },
        data: {
          datasets: data
            .map((entry, i) => {
              return { ...entry, colorId: i };
            })
            .filter((e) => e.active === 1)
            .map((entry, i) => {
              const { attacker, defender, action } = entry.state as {
                attacker: StatSchemaOutput;
                defender: StatSchemaOutput;
                action: ActSchemaOutput;
              };
              const stateDmg = getDamage(attacker, defender, action);
              return {
                data: [{ x: i + 1, y: stateDmg }],
                backgroundColor: colors[entry.colorId % colors.length],
                borderColor: colors[entry.colorId % colors.length],
              };
            }),
        },
      });
      return () => {
        myChart.destroy();
      };
    }
  }, [data]);

  // Handle updating current form values whenever retrieve entry changes
  useEffect(() => {
    if (previous?.state) activateEntry(previous);
  }, [previous]);

  // Handle updating damage whenever form changes
  useEffect(() => {
    setSelectedDmg(getDamage(attValues, defValues, actValues));
  }, [attValues, defValues, actValues]);

  // Handle simulation
  const onSubmit = attForm.handleSubmit(
    () =>
      saveEntry({
        attacker: attValues,
        defender: defValues,
        action: actValues,
      }),
    (errors) => console.error(errors),
  );

  // Handle inserting historical entry into form
  const activateEntry = (entry: DamageSimulation) => {
    const { attacker, defender, action } = entry.state as {
      attacker: StatSchemaOutput;
      defender: StatSchemaOutput;
      action: ActSchemaOutput;
    };
    let statKey: keyof typeof attacker;
    let actKey: keyof typeof action;
    for (statKey in attacker) {
      attForm.setValue(statKey, attacker[statKey]);
    }
    for (statKey in defender) {
      defForm.setValue(statKey, defender[statKey]);
    }
    for (actKey in action) {
      actForm.setValue(actKey, action[actKey]);
    }
  };

  // Handle setting user data into form
  const setUserData = (
    form: UseFormReturn<StatSchemaInput, unknown, StatSchemaOutput>,
  ) => {
    statNames.forEach((stat) => {
      form.setValue(stat, userData?.[stat] ?? 0);
    });
  };

  return (
    <>
      {!userData && (
        <ContentBox
          title="Damage Simulator"
          subtitle="Damage calculation tool"
          defaultBackHref="/manual"
        >
          {battleCalcText()}
        </ContentBox>
      )}
      <ContentBox
        title="Damage Simulator"
        subtitle="Benchmark your build"
        initialBreak={!userData}
        defaultBackHref={userData ? "/manual" : undefined}
        padding={false}
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            {isAdmin && <DmgConfigDialog />}
            <Toggle
              id="toggle-damage-simulator"
              value={showAll}
              setShowActive={setShowAll}
              labelActive="Focus"
              labelInactive="Focus"
            />
          </div>
        }
      >
        <div className="grid grid-cols-2">
          <div>
            <div className="flex flex-row items-center">
              <p className="px-3 pt-3 font-bold text-lg">Attacker</p>
              <div className="grow"></div>
              <Users
                className="mt-3 mr-3 h-5 w-5"
                onClick={() => setUserData(attForm)}
              />
            </div>
            <p className="px-3 text-sm italic">Experience: {attExp}</p>
            <p className="px-3 pb-1 text-sm italic">Level: {attLevel}</p>
            <p className="px-3 pb-1 text-sm italic">Health: {attHp}</p>
            <hr />
            <UserInput
              id="u1"
              ignoreContains={showAll ? "Defence" : "None"}
              selectForm={attForm}
            />
          </div>
          <div>
            <div className="flex flex-row items-center">
              <p className="px-3 pt-3 font-bold text-lg">Defender</p>
              <div className="grow"></div>
              <Users
                className="mt-3 mr-3 h-5 w-5"
                onClick={() => setUserData(defForm)}
              />
            </div>
            <p className="px-3 text-sm italic">Experience: {defExp}</p>
            <p className="px-3 pb-1 text-sm italic">Level: {defLevel}</p>
            <p className="px-3 pb-1 text-sm italic">Health: {defHp}</p>
            <hr />
            <UserInput
              id="u2"
              ignoreContains={showAll ? "Offence" : "None"}
              selectForm={defForm}
            />
          </div>
        </div>
        <div className="mb-3">
          <p className="px-3 pt-3 font-bold text-lg">Attack Settings</p>
          <hr />
          <div className="space-y-2 px-3">
            <Form {...actForm}>
              <FormField
                control={actForm.control}
                name="power"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Set power</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={actForm.control}
                name="statTypes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Set Stats</FormLabel>
                    <MultiSelect
                      selected={field.value ? field.value : []}
                      options={StatTypes.map((o) => ({ label: o, value: o }))}
                      onChange={field.onChange}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={actForm.control}
                name="generalTypes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Set Generals</FormLabel>
                    <MultiSelect
                      selected={field.value ? field.value : []}
                      options={GeneralTypes.map((o) => ({
                        label: o,
                        value: o,
                      }))}
                      onChange={field.onChange}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
        </div>
        <div className="mb-3">
          <p className="px-3 pt-3 font-bold text-lg">Formula Parameters</p>
          <hr />
          <div className="grid grid-cols-2 gap-4 px-3">
            <Form {...configForm}>
              <FormField
                control={configForm.control}
                name="stats_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>stats_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="base_hits"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>base_hits</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="curve"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>curve</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="amplitude"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>amplitude</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="ep_normalization"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ep_normalization</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="gen_weight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>gen_weight</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="advantage_min"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>advantage_min</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="advantage_max"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>advantage_max</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
        </div>
        <hr />
        <div className="mx-2 my-2 grid grid-cols-2 items-center">
          {selectedDmg && (
            <div>
              <p className="mt-3 text-center font-bold text-2xl">
                Damage: {selectedDmg}
              </p>
              <p className="mb-3 text-center italic">
                [{((100 * selectedDmg) / defHp)?.toFixed(1)}% of Defender HP]
              </p>
            </div>
          )}
          {!isPending && userData && (
            <Button id="return" onClick={onSubmit}>
              <Save className="mr-2 h-5 w-5" />
              Save Calculation
            </Button>
          )}
          {isPending && <Loader explanation="Processing" />}
        </div>
      </ContentBox>
      {userData && (
        <ContentBox
          title={`Damage Results`}
          subtitle="Compare & recall calculations"
          initialBreak={true}
        >
          <div className="grid grid-cols-3">
            <div className="col-span-2 mr-5 text-center">
              <canvas ref={chartRef} id="overview"></canvas>
            </div>
            <div>
              <div className="flex flex-row font-bold text-lg">
                <p>History</p>
                <div className="grow"></div>
                <Eye
                  className={`mr-1 h-5 w-5 hover:cursor-pointer hover:text-orange-500`}
                  onClick={() => updateEntry({ active: true })}
                />
                <EyeOff
                  className={`mr-1 h-5 w-5 hover:cursor-pointer hover:text-orange-500`}
                  onClick={() => updateEntry({ active: false })}
                />
              </div>
              <hr />
              <p className="my-1"></p>
              {data?.map((entry, i) => {
                return (
                  <div key={entry.id} className="flex flex-row items-center">
                    {entry.active === 1 && (
                      <Eye
                        className={`mr-1 h-5 w-5 hover:cursor-pointer`}
                        style={{ color: colors[i % colors.length] }}
                        onClick={() => updateEntry({ id: entry.id, active: false })}
                      />
                    )}
                    {entry.active === 0 && (
                      <EyeOff
                        className="mr-1 h-5 w-5 hover:cursor-pointer hover:text-orange-500"
                        onClick={() => updateEntry({ id: entry.id, active: true })}
                      />
                    )}
                    <button
                      type="button"
                      className="hover:text-orange-500"
                      onClick={() => activateEntry(entry)}
                    >
                      {entry.createdAt.toLocaleString(undefined, {
                        weekday: undefined,
                        day: "numeric",
                        year: undefined,
                        month: "numeric",
                        hour: "numeric",
                        minute: "numeric",
                        second: "numeric",
                      })}
                    </button>

                    <div className="grow" />
                    <Trash2
                      className="mr-1 h-5 w-5 hover:cursor-pointer hover:text-orange-500"
                      onClick={() => deleteEntry({ id: entry.id })}
                    />
                    <ClipboardCopy
                      className="ml-1 h-5 w-5 hover:cursor-pointer hover:text-orange-900"
                      onClick={() => {
                        const origin =
                          typeof window !== "undefined" && window.location.origin
                            ? window.location.origin
                            : "";
                        const link = `${origin}/manual/damage_calcs/${entry.id}`;
                        navigator.clipboard.writeText(link).then(
                          () => {
                            showMutationToast({
                              success: true,
                              title: "Saved",
                              message: "Copied to clipboard!",
                            });
                          },
                          () => {
                            showMutationToast({
                              success: false,
                              title: "Error",
                              message: "Could not copy to clipboard",
                            });
                          },
                        );
                      }}
                    />
                  </div>
                );
              })}
              <p className="text-xs italic">- Max 20 items</p>
            </div>
          </div>
        </ContentBox>
      )}
    </>
  );
}

interface UserInputProps {
  id: string;
  ignoreContains: string;
  selectForm: UseFormReturn<StatSchemaInput, unknown, StatSchemaOutput>;
}

const UserInput: React.FC<UserInputProps> = (props) => {
  const { id, selectForm } = props;
  const fields = statNames
    .filter((stat) => !stat.includes(props.ignoreContains))
    .map((stat, i) => {
      return (
        <div
          key={`${i}${id}`}
          className={`py-2 ${i % 2 === 0 ? "bg-popover" : "bg-card"}`}
        >
          <div className="px-3">
            <FormField
              control={selectForm.control}
              name={stat}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{stat}</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} value={field.value as number} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      );
    });
  return <Form {...selectForm}>{fields}</Form>;
};
