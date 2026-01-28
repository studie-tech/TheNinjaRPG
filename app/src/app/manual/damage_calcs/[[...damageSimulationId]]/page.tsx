"use client";

import { nanoid } from "nanoid";
import { useState, useEffect, useRef, use } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useUserData } from "@/utils/UserContext";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save, Users, ClipboardCopy, Trash2, Eye, EyeOff } from "lucide-react";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Toggle from "@/components/control/Toggle";
import { Button } from "@/components/ui/button";
import { damageUser } from "@/libs/combat/tags";
import { calcLevel, calcHP } from "@/libs/profile";
import { StatTypes, GeneralTypes } from "@/drizzle/constants";
import { statSchema, actSchema, confSchema } from "@/validators/combat";
import { dmgConfig } from "@/libs/combat/constants";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { Chart as ChartJS } from "chart.js/auto";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Form,
  FormControl,
  FormLabel,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { battleCalcText } from "@/layout/seoTexts";
import { Input } from "@/components/ui/input";
import type { DamageSimulation } from "@/drizzle/schema";
import type { z } from "zod";
import type { UseFormReturn } from "react-hook-form";
import type { UserEffect } from "@/libs/combat/types";
import type { BattleUserState } from "@/libs/combat/types";
import type { Consequence } from "@/libs/combat/types";

// Default user
type StatSchema = z.infer<typeof statSchema>;
type ActSchema = z.infer<typeof actSchema>;
type ConfigSchema = z.infer<typeof confSchema>;
const defaultsStats = statSchema.parse({});
const statNames = Object.keys(defaultsStats) as (keyof typeof defaultsStats)[];

export default function Simulator(props: {
  params: Promise<{ damageSimulationId?: string }>;
}) {
  const params = use(props.params);
  // Fetch user data
  const { data: userData } = useUserData();

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
  const attForm = useForm<StatSchema>({ ...conf1, resolver: zodResolver(statSchema) });
  const defForm = useForm<StatSchema>({ ...conf1, resolver: zodResolver(statSchema) });
  const conf2 = { defaultValues: actSchema.parse({}), mode: "all" as const };
  const actForm = useForm<ActSchema>({ ...conf2, resolver: zodResolver(actSchema) });
  const configForm = useForm<ConfigSchema>({
    defaultValues: confSchema.parse(dmgConfig),
    mode: "all" as const,
    resolver: zodResolver(confSchema),
  });

  // Watch all the forms simultaneously
  const attValues = useWatch({ control: attForm.control }) as StatSchema;
  const defValues = useWatch({ control: defForm.control }) as StatSchema;
  const actValues = useWatch({ control: actForm.control }) as ActSchema;
  const configValues = useWatch({ control: configForm.control }) as ConfigSchema;

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
  const calcExperience = (values: StatSchema) => {
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
    attValues: StatSchema,
    defValues: StatSchema,
    actValues: ActSchema,
  ) => {
    const attacker = {
      ...attValues,
      experience: calcExperience(attValues),
    } as unknown as BattleUserState;
    const defender = {
      ...defValues,
      experience: calcExperience(defValues),
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
                attacker: StatSchema;
                defender: StatSchema;
                action: ActSchema;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Handle updating current form values whenever retrieve entry changes
  useEffect(() => {
    if (previous?.state) activateEntry(previous);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previous]);

  // Handle updating damage whenever form changes
  useEffect(() => {
    setSelectedDmg(getDamage(attValues, defValues, actValues));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attValues, defValues, actValues]);

  // Handle simulation
  const onSubmit = attForm.handleSubmit(
    () => saveEntry({ attacker: attValues, defender: defValues, action: actValues }),
    (errors) => console.error(errors),
  );

  // Handle inserting historical entry into form
  const activateEntry = (entry: DamageSimulation) => {
    const { attacker, defender, action } = entry.state as {
      attacker: StatSchema;
      defender: StatSchema;
      action: ActSchema;
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
  const setUserData = (form: UseFormReturn<StatSchema>) => {
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
          <Toggle
            id="toggle-damage-simulator"
            value={showAll}
            setShowActive={setShowAll}
            labelActive="Focus"
            labelInactive="Focus"
          />
        }
      >
        <div className="grid grid-cols-2">
          <div>
            <div className="flex flex-row items-center">
              <p className="px-3 pt-3 text-lg font-bold">Attacker</p>
              <div className="grow"></div>
              <Users
                className="h-5 w-5 mr-3 mt-3"
                onClick={() => setUserData(attForm)}
              />
            </div>
            <p className="px-3 italic text-sm">Experience: {attExp}</p>
            <p className="px-3 pb-1 italic text-sm">Level: {attLevel}</p>
            <p className="px-3 pb-1 italic text-sm">Health: {attHp}</p>
            <hr />
            <UserInput
              id="u1"
              ignoreContains={showAll ? "Defence" : "None"}
              selectForm={attForm}
            />
          </div>
          <div>
            <div className="flex flex-row items-center">
              <p className="px-3 pt-3 text-lg font-bold">Defender</p>
              <div className="grow"></div>
              <Users
                className="h-5 w-5 mr-3 mt-3"
                onClick={() => setUserData(defForm)}
              />
            </div>
            <p className="px-3 italic text-sm">Experience: {defExp}</p>
            <p className="px-3 pb-1 italic text-sm">Level: {defLevel}</p>
            <p className="px-3 pb-1 italic text-sm">Health: {defHp}</p>
            <hr />
            <UserInput
              id="u2"
              ignoreContains={showAll ? "Offence" : "None"}
              selectForm={defForm}
            />
          </div>
        </div>
        <div className="mb-3">
          <p className="px-3 pt-3 text-lg font-bold">Attack Settings</p>
          <hr />
          <div className="px-3 space-y-2">
            <Form {...actForm}>
              <FormField
                control={actForm.control}
                name="power"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Set power</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
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
                      options={GeneralTypes.map((o) => ({ label: o, value: o }))}
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
          <p className="px-3 pt-3 text-lg font-bold">Formula Parameters</p>
          <hr />
          <div className="px-3 grid grid-cols-2 gap-4">
            <Form {...configForm}>
              <FormField
                control={configForm.control}
                name="atk_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>atk_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="def_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>def_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="exp_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>exp_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="dmg_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>dmg_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="gen_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>gen_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="stats_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>stats_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="power_scaling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>power_scaling</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={configForm.control}
                name="dmg_base"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>dmg_base</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
        </div>
        <hr />
        <div className="grid grid-cols-2 my-2 mx-2 items-center">
          {selectedDmg && (
            <div>
              <p className="text-2xl text-center mt-3 font-bold">
                Damage: {selectedDmg}
              </p>
              <p className="text-center mb-3 italic">
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
            <div className="col-span-2 text-center mr-5">
              <canvas ref={chartRef} id="overview"></canvas>
            </div>
            <div>
              <div className="text-lg font-bold flex flex-row">
                <p>History</p>
                <div className="grow"></div>
                <Eye
                  className={`h-5 w-5 mr-1 hover:text-orange-500 hover:cursor-pointer`}
                  onClick={() => updateEntry({ active: true })}
                />
                <EyeOff
                  className={`h-5 w-5 mr-1 hover:text-orange-500 hover:cursor-pointer`}
                  onClick={() => updateEntry({ active: false })}
                />
              </div>
              <hr />
              <p className="my-1"></p>
              {data?.map((entry, i) => {
                return (
                  <div key={i} className="flex flex-row items-center">
                    {entry.active === 1 && (
                      <Eye
                        className={`h-5 w-5 mr-1 hover:cursor-pointer`}
                        style={{ color: colors[i % colors.length] }}
                        onClick={() => updateEntry({ id: entry.id, active: false })}
                      />
                    )}
                    {entry.active === 0 && (
                      <EyeOff
                        className="h-5 w-5 mr-1 hover:text-orange-500 hover:cursor-pointer"
                        onClick={() => updateEntry({ id: entry.id, active: true })}
                      />
                    )}
                    <div
                      className=" hover:text-orange-500"
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
                    </div>

                    <div className="grow" />
                    <Trash2
                      className="mr-1 h-5 w-5 hover:text-orange-500 hover:cursor-pointer"
                      onClick={() => deleteEntry({ id: entry.id })}
                    />
                    <ClipboardCopy
                      className="ml-1 h-5 w-5 hover:text-orange-900 hover:cursor-pointer"
                      onClick={() => {
                        const origin =
                          typeof window !== "undefined" && window.location.origin
                            ? window.location.origin
                            : "";
                        const link = `${origin}/manual/damage_calcs/${entry.id}`;
                        navigator.clipboard.writeText(link).then(
                          function () {
                            showMutationToast({
                              success: true,
                              title: "Saved",
                              message: "Copied to clipboard!",
                            });
                          },
                          function () {
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
              <p className="italic text-xs">- Max 20 items</p>
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
  selectForm: UseFormReturn<StatSchema>;
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
                    <Input type="number" {...field} />
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
