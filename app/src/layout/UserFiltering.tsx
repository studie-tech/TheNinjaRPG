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
import { canSeeIps } from "@/utils/permissions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { getPublicUsersSchema } from "@/validators/user";
import { Filter } from "lucide-react";
import { useUserData } from "@/utils/UserContext";
import { TriStateToggle } from "@/components/control/Toggle";
import { MultiSelect } from "@/components/ui/multi-select";
import { effectFilters } from "@/libs/train";
import type { GetPublicUsersSchema } from "@/validators/user";

interface UserFilteringProps {
  state: UserFilteringState;
  aiToggles?: boolean;
  showEffects?: boolean;
}

const UserFiltering: React.FC<UserFilteringProps> = (props) => {
  // Global state
  const { data: userData } = useUserData();

  // Destructure the state
  const { setUsername, setBloodline, setVillage, setIp, setEffect } = props.state;
  const {
    username,
    bloodline,
    village,
    ip,
    inArena,
    isEvent,
    isSummon,
    inShrines,
    effect,
  } = props.state;
  const { setInArena, setIsEvent, setIsSummon, setInShrines } = props.state;

  // Query
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: villages } = api.village.getAllNames.useQuery(undefined);

  // Name search schema
  const form = useForm<GetPublicUsersSchema>({
    resolver: zodResolver(getPublicUsersSchema),
    defaultValues: { username: username, ip: ip },
  });
  const watchUsername = useWatch({ control: form.control, name: "username" });
  const watchIp = useWatch({ control: form.control, name: "ip" });

  // Update the state
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setUsername(watchUsername || "");
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchUsername, setUsername]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setIp(watchIp || "");
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchIp, setIp]);

  // Calculate the number of applied filters
  const usernameFilter = username.length > 0 ? 1 : 0;
  const ipFilter = ip.length > 0 ? 1 : 0;
  const bloodlineFilter = bloodline !== "None" ? 1 : 0;
  const villageFilter = village !== "None" ? 1 : 0;
  const isSummonFilter = isSummon !== undefined ? 1 : 0;
  const isEventFilter = isEvent !== undefined ? 1 : 0;
  const inArenaFilter = inArena !== undefined ? 1 : 0;
  const inShrinesFilter = inShrines !== undefined ? 1 : 0;
  const effectFilter = effect.length;

  const totalFilters =
    usernameFilter +
    ipFilter +
    bloodlineFilter +
    villageFilter +
    isSummonFilter +
    isEventFilter +
    inArenaFilter +
    inShrinesFilter +
    effectFilter;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id="filter-bloodline" count={totalFilters}>
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {/* USERNAME */}
          <div>
            <Form {...form}>
              <Label htmlFor="rank">Username</Label>
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id="username" placeholder="Search User" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
          {/* IP */}
          {userData && canSeeIps(userData.role) && (
            <div>
              <Form {...form}>
                <Label htmlFor="rank">Last IP</Label>
                <FormField
                  control={form.control}
                  name="ip"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input id="ip" placeholder="Search IP" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Form>
            </div>
          )}
          {/* Bloodline */}
          <div>
            <Select onValueChange={(e) => setBloodline(e)}>
              <Label htmlFor="bloodline">Bloodline</Label>
              <SelectTrigger>
                <SelectValue placeholder={bloodline || "None"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key="None" value="None">
                  None
                </SelectItem>
                {bloodlines
                  ?.sort((a, b) => (a.name < b.name ? -1 : 1))
                  .map((bloodline) => (
                    <SelectItem key={bloodline.name} value={bloodline.id}>
                      {bloodline.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {/* Village */}
          <div>
            <Select onValueChange={(e) => setVillage(e)}>
              <Label htmlFor="village">Village</Label>
              <SelectTrigger>
                <SelectValue placeholder={village || "None"} />
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
          {/* Effects */}
          {props.showEffects && (
            <div>
              <Label>Effects</Label>
              <MultiSelect
                selected={effect}
                options={effectFilters.map((ef) => ({ value: ef, label: ef }))}
                onChange={setEffect}
              />
            </div>
          )}
          {props.aiToggles && (
            <>
              {/* Event AI */}
              <div className="mt-1">
                <Label htmlFor="toggle-event-only">Event Status</Label>
                <TriStateToggle
                  verticalLayout
                  id="toggle-event-only"
                  value={isEvent}
                  setShowActive={setIsEvent}
                  labelActive="Event Only"
                  labelInactive="Non-Event Only"
                  labelAll="All Events"
                />
              </div>
              {/* Summon AI */}
              <div className="mt-1">
                <Label htmlFor="toggle-summon-only">Summon Status</Label>
                <TriStateToggle
                  verticalLayout
                  id="toggle-summon-only"
                  value={isSummon}
                  setShowActive={setIsSummon}
                  labelActive="Summon Only"
                  labelInactive="Non-Summon Only"
                  labelAll="All Summons"
                />
              </div>
              {/* Arena AI */}
              <div className="mt-1">
                <Label htmlFor="toggle-arena-only">Arena Status</Label>
                <TriStateToggle
                  verticalLayout
                  id="toggle-arena-only"
                  value={inArena}
                  setShowActive={setInArena}
                  labelActive="Arena Only"
                  labelInactive="Non-Arena Only"
                  labelAll="All Arena"
                />
              </div>
              {/* Shrine AI */}
              <div className="mt-1">
                <Label htmlFor="toggle-shrine-only">Shrine Status</Label>
                <TriStateToggle
                  verticalLayout
                  id="toggle-shrine-only"
                  value={inShrines}
                  setShowActive={setInShrines}
                  labelActive="Shrine Only"
                  labelInactive="Non-Shrine Only"
                  labelAll="All Shrines"
                />
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default UserFiltering;

/** tRPC filter to be used on api.jutsu.getAll */
export const getFilter = (state: UserFilteringState) => {
  return {
    username: state.username ? state.username : undefined,
    ip: state.ip ? state.ip : undefined,
    bloodline: state.bloodline !== "None" ? state.bloodline : undefined,
    village: state.village !== "None" ? state.village : undefined,
    isSummon: state.isSummon,
    isEvent: state.isEvent,
    inArena: state.inArena,
    inShrines: state.inShrines,
    effect: state.effect.length > 0 ? state.effect : undefined,
  };
};

/** State for the User Filtering component */
export const useFiltering = () => {
  // State variables
  const [username, setUsername] = useState<string>("");
  const [ip, setIp] = useState<string>("");
  const [bloodline, setBloodline] = useState<string>("None");
  const [village, setVillage] = useState<string>("None");
  const [isSummon, setIsSummon] = useState<boolean | undefined>(undefined);
  const [isEvent, setIsEvent] = useState<boolean | undefined>(undefined);
  const [inArena, setInArena] = useState<boolean | undefined>(undefined);
  const [inShrines, setInShrines] = useState<boolean | undefined>(undefined);
  const [effect, setEffect] = useState<string[]>([]);

  // Return all
  return {
    bloodline,
    effect,
    inArena,
    inShrines,
    ip,
    isEvent,
    isSummon,
    setBloodline,
    setEffect,
    setInArena,
    setInShrines,
    setIp,
    setIsEvent,
    setIsSummon,
    setUsername,
    setVillage,
    username,
    village,
  };
};

/** State type */
export type UserFilteringState = ReturnType<typeof useFiltering>;
