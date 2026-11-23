"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Compass, House, Navigation2, X } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalStorage } from "@/hooks/localstorage";
import { SectorIdField } from "@/layout/FindSectorPopover";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import {
  type CompassDestination,
  getSectorCompassBearing,
  parseCompassDestination,
} from "@/libs/travelCompass";
import { useUserDataSelector } from "@/utils/UserContext";
import {
  type SectorForm,
  type SectorFormInput,
  sectorFormSchema,
} from "@/validators/travel";

/** A destination needle and picker, independent of travel actions and map rendering. */
export function TravelCompass() {
  const { data: user } = useUserDataSelector((user) => ({
    userId: user.userId,
    sector: user.sector,
    home: user.village
      ? { id: user.village.id, name: user.village.name, sector: user.village.sector }
      : null,
  }));
  return user ? <CharacterTravelCompass key={user.userId} user={user} /> : null;
}

function CharacterTravelCompass({ user }: { user: CompassUser }) {
  const [stored, setDestination] = useLocalStorage<CompassDestination>(
    `travelCompass:${user.userId}`,
    { type: "home" },
  );
  const destination = parseCompassDestination(stored);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const villageId = useId();
  const {
    data: villages,
    isFetching,
    isError,
    refetch,
  } = api.village.getAll.useQuery(undefined, {
    enabled: open || destination.type === "village",
  });
  const form = useForm<SectorFormInput, unknown, SectorForm>({
    resolver: zodResolver(sectorFormSchema),
    mode: "onSubmit",
  });
  const sector = useWatch({ control: form.control, name: "sector" });
  const target =
    destination.type === "home"
      ? user.home
      : destination.type === "village"
        ? villages?.find((village) => village.id === destination.villageId)
        : { name: `Sector ${destination.sector}`, sector: destination.sector };
  const bearing = target ? getSectorCompassBearing(user.sector, target.sector) : null;
  const destinationName =
    target?.name ??
    (destination.type === "home"
      ? "Choose a destination"
      : isFetching
        ? "Loading destination…"
        : "Village unavailable");
  const description = bearing?.arrived
    ? "You’re in this sector"
    : bearing
      ? `Head ${bearing.direction}`
      : "Choose a village or sector to follow";
  const choose = (next: CompassDestination) => {
    setDestination(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Compass: ${destination.type === "home" ? "Home · " : ""}${destinationName}. ${description}`}
          title={`${destinationName} · ${description}`}
          className="focus-visible:outline-ring relative -top-8 flex min-h-[44px] min-w-[44px] justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="rounded-full bg-linear-to-b from-black/5 to-black/50 p-3">
            <span className="bg-background text-foreground relative flex size-12 items-center justify-center rounded-full border border-current shadow-sm">
              <span
                className="absolute top-0.5 text-[8px] leading-none opacity-65"
                aria-hidden
              >
                N
              </span>
              {bearing?.arrived ? (
                <Check className="size-6" aria-hidden />
              ) : bearing ? (
                <Navigation2
                  className="size-7 fill-current/20"
                  style={{ transform: `rotate(${bearing.angle}deg)` }}
                  aria-hidden
                />
              ) : (
                <Compass className="size-7" aria-hidden />
              )}
              <span
                className="absolute right-1 size-0.5 rounded-full bg-current opacity-40"
                aria-hidden
              />
              <span
                className="absolute bottom-1 size-0.5 rounded-full bg-current opacity-40"
                aria-hidden
              />
              <span
                className="absolute left-1 size-0.5 rounded-full bg-current opacity-40"
                aria-hidden
              />
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="z-[70] max-h-[var(--radix-popover-content-available-height)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-4"
        aria-labelledby={titleId}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-base font-semibold">
            Destination compass
          </h2>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close compass"
              className="size-[44px]"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </PopoverClose>
        </div>
        <div className="mb-4 border-b pb-4" role="status">
          <p className="font-semibold">
            {destination.type === "home" && "Home · "}
            {destinationName}
          </p>
          <p className="text-muted-foreground text-sm">
            {description}
            {target && ` · Sector ${target.sector}`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mb-4 min-h-[44px] w-full justify-start gap-2"
          disabled={!user.home || !isValidSectorId(user.home.sector)}
          onClick={() => choose({ type: "home" })}
        >
          <House className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            {user.home ? `Home · ${user.home.name}` : "No home village"}
          </span>
        </Button>
        <div className="mb-4 space-y-2">
          <Label htmlFor={villageId}>Village</Label>
          <Select
            value={destination.type === "village" ? destination.villageId : ""}
            onValueChange={(villageId) => choose({ type: "village", villageId })}
          >
            <SelectTrigger id={villageId} className="min-h-[44px] w-full">
              <SelectValue
                placeholder={
                  isFetching && !villages ? "Loading villages…" : "Choose a village"
                }
              />
            </SelectTrigger>
            <SelectContent className="z-[71]">
              {villages
                ?.filter((village) => isValidSectorId(village.sector))
                .map((village) => (
                  <SelectItem key={village.id} value={village.id}>
                    {village.name} · {village.sector}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {isError && (
            <p className="text-sm" role="alert">
              Villages couldn’t load.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => void refetch()}
              >
                Try again
              </button>
            </p>
          )}
        </div>
        <Form {...form}>
          <form
            className="space-y-2 [&_input]:min-h-[44px]"
            onSubmit={form.handleSubmit(({ sector }) =>
              choose({ type: "sector", sector }),
            )}
          >
            <Label htmlFor={`${titleId}-sector`}>Sector</Label>
            <SectorIdField control={form.control} id={`${titleId}-sector`} />
            <Button
              type="submit"
              variant="secondary"
              className="min-h-[44px] w-full"
              disabled={sector === undefined || sector === ""}
            >
              Point to sector
            </Button>
          </form>
        </Form>
        <p className="text-muted-foreground mt-3 text-xs">
          Your compass follows this destination as you travel.
        </p>
      </PopoverContent>
    </Popover>
  );
}

type CompassUser = {
  userId: string;
  sector: number;
  home: { id: string; name: string; sector: number } | null;
};
