"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { FullScreenDialog, FullScreenDialogTitle } from "@/layout/TutorialScreens";
import { cn } from "@/libs/shadui";

/** One answer of the proctor's village question: the village name and where it leads. */
export type VillageChoiceOption = { text: string; nextObjectiveId?: string | null };

/**
 * The Genin exam's village choice as a full page: each village's art, its deity and
 * bloodline, how many shinobi played there this week, and a "Needs shinobi" tag on the
 * quietest one. Picking a village asks for confirmation first, since it is for good. It
 * stacks above the Activity dock, so the confirmation is part of the page rather than
 * a modal that would open underneath it.
 */
export const VillageChooser: React.FC<{
  options: readonly VillageChoiceOption[];
  isPending: boolean;
  onChoose: (option: VillageChoiceOption) => void;
  onHide: () => void;
}> = ({ options, isPending, onChoose, onHide }) => {
  const [selected, setSelected] = useState<VillageChoiceOption>();
  const { data: villages, isPending: isLoading } =
    api.village.getVillageChoices.useQuery(undefined, { staleTime: 60_000 });
  const choices = options.map((option) => ({
    option,
    village: villages?.find((entry) => entry.name === option.text),
    lore: VILLAGE_LORE[option.text],
  }));
  const quietest = choices
    .filter((choice) => choice.village)
    .sort(
      (a, b) => (a.village?.activeThisWeek ?? 0) - (b.village?.activeThisWeek ?? 0),
    )[0]?.option.text;

  return (
    <FullScreenDialog id="tutorial-village-chooser">
      <div className="@container mx-auto flex min-h-full max-w-[120rem] flex-col justify-center gap-4 px-4 py-6">
        <header className="flex flex-col gap-1 text-center">
          <FullScreenDialogTitle className="text-2xl font-bold">
            Choose your village
          </FullScreenDialogTitle>
          <p className="text-muted-foreground">
            Your village is your home for good. It decides who fights beside you, the
            missions you are given and the village bloodline you can earn.
          </p>
        </header>
        {isLoading ? (
          <Loader explanation="Gathering the villages" />
        ) : (
          // Two cards side by side from @2xl (504px), three from @5xl (768px) and all
          // five villages in one row from @7xl (960px).
          <ul className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3 @7xl:grid-cols-5">
            {choices.map(({ option, village, lore }) => (
              <li key={option.text}>
                <button
                  type="button"
                  id={`tutorial-village-choice-${option.text.toLowerCase()}`}
                  aria-pressed={selected?.text === option.text}
                  disabled={isPending}
                  onClick={() => setSelected(option)}
                  className={cn(
                    // A single column lays each village out sideways, so a phone sees most of them at once.
                    "group flex h-full w-full flex-row overflow-hidden rounded-xl border-2 bg-card text-left shadow-sm transition hover:border-primary focus-visible:border-primary @2xl:flex-col",
                    selected?.text === option.text &&
                      "border-primary ring-2 ring-primary",
                  )}
                >
                  {village?.villageGraphic && (
                    <div className="relative aspect-square w-2/5 shrink-0 overflow-hidden @2xl:aspect-[16/9] @2xl:w-full @7xl:aspect-[3/4]">
                      <Image
                        src={village.villageGraphic}
                        alt={option.text}
                        fill
                        className="object-cover transition group-hover:scale-105"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full border"
                        style={{ backgroundColor: village?.hexColor ?? undefined }}
                        aria-hidden="true"
                      />
                      <span className="font-bold text-xl">{option.text}</span>
                      {quietest === option.text && (
                        <Badge variant="secondary">Needs shinobi</Badge>
                      )}
                    </div>
                    {lore && (
                      <>
                        <span className="text-muted-foreground text-sm">
                          {lore.title}
                        </span>
                        <span className="text-sm">
                          Deity: <b>{lore.deity}</b>
                        </span>
                        <span className="text-sm">
                          Village bloodline: <b>{lore.bloodline}</b>
                        </span>
                      </>
                    )}
                    {village && (
                      <span className="mt-auto flex items-center gap-1 pt-1 text-muted-foreground text-sm">
                        <Users className="h-4 w-4" aria-hidden="true" />
                        {village.activeThisWeek.toLocaleString()} active this week
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={cn("flex justify-center", selected && "pb-40")}>
          <Button variant="ghost" onClick={onHide}>
            Not yet, let me look around
          </Button>
        </div>
      </div>
      {selected && (
        <div
          role="alertdialog"
          aria-labelledby="village-confirm-title"
          className="fixed inset-x-0 bottom-0 border-t-2 border-primary bg-card p-4 shadow-2xl"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-3 @container">
            <p id="village-confirm-title">
              Join <b>{selected.text}</b>? This choice is permanent: your village stays
              your home for the rest of your career.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                id="tutorial-village-confirm"
                size="lg"
                decoration="gold"
                className="w-full"
                disabled={isPending}
                onClick={() => onChoose(selected)}
              >
                {isPending ? "Joining…" : `Join ${selected.text}`}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full"
                disabled={isPending}
                onClick={() => setSelected(undefined)}
              >
                Choose again
              </Button>
            </div>
          </div>
        </div>
      )}
    </FullScreenDialog>
  );
};

/** What the proctor tells each village apart by: its deity and its bloodline. */
const VILLAGE_LORE: Record<
  string,
  { title: string; deity: string; bloodline: string }
> = {
  Akikaze: {
    title: "The Hidden Wind Village",
    deity: "Fujin, god of wind",
    bloodline: "Aerathiel (dust)",
  },
  Hyorin: {
    title: "The Hidden Ice Village",
    deity: "Okami",
    bloodline: "Hyouga Yui (ice)",
  },
  Akasumi: {
    title: "The Hidden Storm Village",
    deity: "Watatsumi",
    bloodline: "Arashima (storm)",
  },
  Shirohana: {
    title: "The Sun Village of the desert",
    deity: "Amaterasu",
    bloodline: "Taiyo Kami (scorch)",
  },
  Tsukimori: {
    title: "The Moon Forest Village",
    deity: "Tsukiyomi",
    bloodline: "Shinseina Ki (wood)",
  },
};
