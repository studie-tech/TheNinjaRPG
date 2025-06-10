"use client"
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2, Search } from "lucide-react";
import { RankedDivisions } from "@/drizzle/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/app/_trpc/client";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const divisionRewardSchema = z.object({
  division: z.string(),
  rewards: z.array(
    z.object({
      type: z.enum(["item", "jutsu", "reputation", "ryo"]),
      amount: z.number().int().min(0),
      id: z.string().optional(),
      name: z.string().optional(),
    })
  ),
});

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  startDate: z.date(),
  endDate: z.date(),
  rewards: z.array(divisionRewardSchema),
});

type FormValues = z.infer<typeof formSchema>;

interface SeasonFormProps {
  initialData?: FormValues;
  seasonId?: string;
  onSuccess?: () => void;
}

export default function SeasonForm({ initialData, seasonId, onSuccess }: SeasonFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedRewardIndex, setSelectedRewardIndex] = useState<{ divisionIndex: number; rewardIndex: number } | null>(null);
  const utils = api.useUtils();

  const { data: items } = api.item.getAll.useQuery(
    { name: searchQuery, limit: 10 },
    { enabled: isSearchOpen && selectedRewardIndex !== null }
  );

  const { data: jutsus } = api.jutsu.getAll.useQuery(
    { name: searchQuery, limit: 10 },
    { enabled: isSearchOpen && selectedRewardIndex !== null }
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData || {
      name: "",
      description: "",
      startDate: new Date(),
      endDate: new Date(),
      rewards: [],
    },
  });

  const createSeason = api.ranked.createSeason.useMutation({
    onSuccess: () => {
      void utils.ranked.getSeasons.invalidate();
      onSuccess?.();
    },
  });

  const updateSeason = api.ranked.updateSeason.useMutation({
    onSuccess: () => {
      void utils.ranked.getSeasons.invalidate();
      onSuccess?.();
    },
  });

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      if (seasonId) {
        await updateSeason.mutateAsync({ id: seasonId, ...data });
      } else {
        await createSeason.mutateAsync(data);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const addDivisionReward = () => {
    const currentRewards = form.getValues("rewards");
    void form.setValue("rewards", [
      ...currentRewards,
      {
        division: "UNRANKED",
        rewards: [],
      },
    ]);
  };

  const removeDivisionReward = (index: number) => {
    const currentRewards = form.getValues("rewards");
    void form.setValue(
      "rewards",
      currentRewards.filter((_, i) => i !== index),
    );
  };

  const addReward = (divisionIndex: number) => {
    const currentRewards = form.getValues("rewards");
    const divisionRewards = currentRewards[divisionIndex];
    if (!divisionRewards?.division) return;

    const newRewards = [...currentRewards];
    newRewards[divisionIndex] = {
      division: divisionRewards.division,
      rewards: [
        ...divisionRewards.rewards,
        {
          type: "item",
          amount: 1,
        },
      ],
    };
    void form.setValue("rewards", newRewards);
  };

  const removeReward = (divisionIndex: number, rewardIndex: number) => {
    const currentRewards = form.getValues("rewards");
    const divisionRewards = currentRewards[divisionIndex];
    if (!divisionRewards?.division) return;

    const newRewards = [...currentRewards];
    newRewards[divisionIndex] = {
      division: divisionRewards.division,
      rewards: divisionRewards.rewards.filter((_, idx) => idx !== rewardIndex),
    };
    void form.setValue("rewards", newRewards);
  };

  const handleSearchSelect = (id: string, name: string) => {
    if (!selectedRewardIndex) return;
    const { divisionIndex, rewardIndex } = selectedRewardIndex;
    const currentRewards = form.getValues("rewards");
    const divisionRewards = currentRewards[divisionIndex];
    if (!divisionRewards?.division) return;

    const newRewards = [...currentRewards];
    newRewards[divisionIndex] = {
      division: divisionRewards.division,
      rewards: divisionRewards.rewards.map((reward, idx) => 
        idx === rewardIndex ? { ...reward, id, name } : reward
      ),
    };
    void form.setValue("rewards", newRewards);
    setIsSearchOpen(false);
    setSearchQuery("");
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Season Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Start Date</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant={"outline"}
                        className={`w-full pl-3 text-left font-normal ${
                          !field.value ? "text-muted-foreground" : ""
                        }`}
                      >
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) =>
                        date < new Date() || date > form.getValues("endDate")
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>End Date</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant={"outline"}
                        className={`w-full pl-3 text-left font-normal ${
                          !field.value ? "text-muted-foreground" : ""
                        }`}
                      >
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) =>
                        date < form.getValues("startDate")
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Division Rewards</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addDivisionReward}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Division
            </Button>
          </div>

          {form.watch("rewards").map((division, divisionIndex) => (
            <Card key={divisionIndex}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Division {divisionIndex + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeDivisionReward(divisionIndex)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name={`rewards.${divisionIndex}.division`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Division</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a division" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {RankedDivisions.map((division) => (
                            <SelectItem key={division.key} value={division.key}>
                              {division.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Rewards</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addReward(divisionIndex)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Reward
                    </Button>
                  </div>

                  {form
                    .watch(`rewards.${divisionIndex}.rewards`)
                    .map((reward, rewardIndex) => (
                      <Card key={rewardIndex}>
                        <CardContent className="pt-6">
                          <div className="grid grid-cols-3 gap-4">
                            <FormField
                              control={form.control}
                              name={`rewards.${divisionIndex}.rewards.${rewardIndex}.type`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Type</FormLabel>
                                  <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select type" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="item">Item</SelectItem>
                                      <SelectItem value="jutsu">Jutsu</SelectItem>
                                      <SelectItem value="reputation">
                                        Reputation
                                      </SelectItem>
                                      <SelectItem value="ryo">Ryo</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {(reward.type === "item" || reward.type === "jutsu") && (
                              <div className="col-span-2">
                                <FormLabel>Search {reward.type}</FormLabel>
                                <div className="flex gap-2">
                                  <Input
                                    placeholder={`Search ${reward.type}...`}
                                    value={reward.name || ""}
                                    readOnly
                                    onClick={() => {
                                      setSelectedRewardIndex({ divisionIndex, rewardIndex });
                                      setIsSearchOpen(true);
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setSelectedRewardIndex({ divisionIndex, rewardIndex });
                                      setIsSearchOpen(true);
                                    }}
                                  >
                                    <Search className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            )}

                            {reward.type === "reputation" && (
                              <FormField
                                control={form.control}
                                name={`rewards.${divisionIndex}.rewards.${rewardIndex}.amount`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Amount</FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        {...field}
                                        onChange={(e) =>
                                          field.onChange(parseInt(e.target.value))
                                        }
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}

                            {reward.type === "ryo" && (
                              <FormField
                                control={form.control}
                                name={`rewards.${divisionIndex}.rewards.${rewardIndex}.amount`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Amount</FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        {...field}
                                        onChange={(e) =>
                                          field.onChange(parseInt(e.target.value))
                                        }
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}

                            <div className="flex items-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  removeReward(divisionIndex, rewardIndex)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : seasonId ? "Update Season" : "Create Season"}
        </Button>
      </form>

      <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Search {selectedRewardIndex ? form.watch(`rewards.${selectedRewardIndex.divisionIndex}.rewards.${selectedRewardIndex.rewardIndex}.type`) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Command>
              <CommandInput 
                placeholder="Search..." 
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {selectedRewardIndex && form.watch(`rewards.${selectedRewardIndex.divisionIndex}.rewards.${selectedRewardIndex.rewardIndex}.type`) === "item" && items?.data.map((item) => (
                  <CommandItem
                    key={item.id}
                    onSelect={() => handleSearchSelect(item.id, item.name)}
                  >
                    {item.name}
                  </CommandItem>
                ))}
                {selectedRewardIndex && form.watch(`rewards.${selectedRewardIndex.divisionIndex}.rewards.${selectedRewardIndex.rewardIndex}.type`) === "jutsu" && jutsus?.data.map((jutsu) => (
                  <CommandItem
                    key={jutsu.id}
                    onSelect={() => handleSearchSelect(jutsu.id, jutsu.name)}
                  >
                    {jutsu.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </div>
        </DialogContent>
      </Dialog>
    </Form>
  );
} 