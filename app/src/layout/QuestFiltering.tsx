import { useEffect } from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MultiSelect } from "@/components/ui/multi-select";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { searchQuestSchema } from "@/validators/quest";
import { Filter } from "lucide-react";
import { LetterRanks, QuestTypes } from "@/drizzle/constants";
import { allObjectiveTasks } from "@/validators/objectives";
import { TriStateToggle } from "@/components/control/Toggle";
import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import type { AllObjectiveTask } from "@/validators/objectives";
import type { LetterRank } from "@/drizzle/constants";
import type { QuestType } from "@/drizzle/constants";
import type { SearchQuestSchema } from "@/validators/quest";

interface QuestFilteringProps {
  state: QuestFilteringState;
  fixedBloodline?: string | null;
}

const QuestFiltering: React.FC<QuestFilteringProps> = (props) => {
  // Global state
  const { data: userData } = useUserData();

  // Destructure the state
  const { name, objectives, questType, hidden } = props.state;
  const { rank, userLevel, village } = props.state;
  const { setName, setObjectives, setQuestType, setHidden } = props.state;
  const { setRank, setUserLevel, setVillage } = props.state;

  // Get all villages
  const { data: villages } = api.village.getAllNames.useQuery(undefined);

  // Filter shown bloodlines
  const villageData = villages?.find((b) => b.id === village);

  // Name search schema
  const form = useForm<SearchQuestSchema>({
    resolver: zodResolver(searchQuestSchema),
    defaultValues: { name: name, userLevel: userLevel },
  });
  const watchName = useWatch({
    control: form.control,
    name: "name",
    defaultValue: undefined,
  });
  const watchLevel = useWatch({
    control: form.control,
    name: "userLevel",
    defaultValue: undefined,
  });

  // Update the state
  useEffect(() => {
    if (watchName) {
      const delayDebounceFn = setTimeout(() => {
        setName(watchName);
      }, 500);
      return () => clearTimeout(delayDebounceFn);
    }
  }, [watchName, setName]);

  useEffect(() => {
    if (watchLevel) {
      const delayDebounceFn = setTimeout(() => {
        setUserLevel(watchLevel);
      }, 500);
      return () => clearTimeout(delayDebounceFn);
    }
  }, [watchLevel, setUserLevel]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id="filter-bloodline">
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {/* QUEST NAME */}
          <div>
            <Form {...form}>
              <Label htmlFor="rank">Name</Label>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id="name" placeholder="Search quest" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
          {/* Effect */}
          <div className="">
            <Label htmlFor="effect">Objectives</Label>
            <MultiSelect
              selected={objectives}
              options={allObjectiveTasks.map((objective) => ({
                value: objective,
                label: objective,
              }))}
              onChange={setObjectives}
            />
          </div>
          {/* QUEST TYPE */}
          <div>
            <Select onValueChange={(e) => setQuestType(e as QuestType)}>
              <Label htmlFor="rank">Quest Type</Label>
              <SelectTrigger>
                <SelectValue placeholder={questType} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"None"} value="None">
                  None
                </SelectItem>
                {QuestTypes.map((questType) => (
                  <SelectItem key={questType} value={questType}>
                    {questType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Rank */}
          <div>
            <Select onValueChange={(e) => setRank(e as LetterRank)}>
              <Label htmlFor="rank">Quest Rank</Label>
              <SelectTrigger>
                <SelectValue placeholder={rank} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"None"} value="None">
                  None
                </SelectItem>
                {LetterRanks.map((rank) => (
                  <SelectItem key={rank} value={rank}>
                    {rank}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* USERLEVEL */}
          <div>
            <Form {...form}>
              <Label htmlFor="userLevel">User Level</Label>
              <FormField
                control={form.control}
                name="userLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id="name" placeholder="User level" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>

          <div>
            <Select onValueChange={(e) => setVillage(e)}>
              <Label htmlFor="village">Village</Label>
              <SelectTrigger>
                <SelectValue placeholder={villageData?.name || "None"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"None"} value="None">
                  None
                </SelectItem>
                {villages
                  ?.sort((a, b) => (a.name < b.name ? -1 : 1))
                  .map((village) => (
                    <SelectItem key={village.name} value={village.id}>
                      {village.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {/* Hidden */}
          {userData && canChangeContent(userData.role) && (
            <div className="mt-1">
              <Label htmlFor="toggle-hidden-only">Visibility</Label>
              <TriStateToggle
                verticalLayout
                id="toggle-hidden-only"
                value={hidden}
                setShowActive={setHidden}
                labelActive="Hidden"
                labelInactive="Visible"
                labelAll="All Visibility"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default QuestFiltering;

/** tRPC filter to be used on api.quest.getAll */
export const getFilter = (state: QuestFilteringState) => {
  return {
    name: state.name ? state.name : undefined,
    objectives:
      state.objectives.length !== 0
        ? (state.objectives as AllObjectiveTask[])
        : undefined,
    questType: state.questType !== "None" ? state.questType : undefined,
    rank: state.rank !== "None" ? state.rank : undefined,
    userLevel: state.userLevel !== undefined ? state.userLevel : undefined,
    village: state.village !== "None" ? state.village : undefined,
    hidden: state.hidden,
  };
};

/** State for the Quest Filtering component */
export const useFiltering = () => {
  // State variables
  type None = "None";
  const [name, setName] = useState<string>("");
  const [objectives, setObjectives] = useState<string[]>([]);
  const [questType, setQuestType] = useState<QuestType | None>("None");
  const [rank, setRank] = useState<LetterRank | None>("None");
  const [userLevel, setUserLevel] = useState<number | undefined>(undefined);
  const [village, setVillage] = useState<string>("None");
  const [hidden, setHidden] = useState<boolean | undefined>(undefined);

  // Return all
  return {
    hidden,
    name,
    objectives,
    questType,
    rank,
    setHidden,
    setName,
    setObjectives,
    setQuestType,
    setRank,
    setUserLevel,
    setVillage,
    userLevel,
    village,
  };
};

/** State type */
export type QuestFilteringState = ReturnType<typeof useFiltering>;
