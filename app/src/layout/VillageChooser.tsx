"use client";

import { useEffect, useRef, useState } from "react";
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
 * bloodline, and a "Needs shinobi" tag on the quietest one. Villages too busy to take new
 * Genin are left out and named below the cards, so new players fill the quieter villages.
 * Picking a village asks for confirmation first, since it is for good. It
 * stacks above the Activity dock, so the confirmation is part of the page rather than
 * a modal that would open underneath it, and the lesson's words are shown here instead.
 */
export const VillageChooser: React.FC<{
  options: readonly VillageChoiceOption[];
  isPending: boolean;
  /** Join the village; `onRejected` runs when the server refuses, e.g. once it is full. */
  onChoose: (option: VillageChoiceOption, onRejected: () => void) => void;
  onHide: () => void;
  /** Lemu's words on the choice, which the covered dock cannot show. */
  guide?: React.ReactNode;
}> = ({ options, isPending, onChoose, onHide, guide }) => {
  const [selected, setSelected] = useState<VillageChoiceOption>();
  const cardList = useRef<HTMLUListElement>(null);
  const {
    data: villages,
    isPending: isLoading,
    refetch,
  } = api.village.getVillageChoices.useQuery(undefined, { staleTime: 60_000 });
  // While the villages load, "Not yet" is the dialog's only control and takes its opening
  // focus, so a stray Enter would close the choice. Focus moves to the first village once
  // the cards are in; choosing one still asks for confirmation.
  useEffect(() => {
    const list = cardList.current;
    if (isLoading || !list || list.contains(document.activeElement)) return;
    list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [isLoading]);
  const allChoices = options.map((option) => ({
    option,
    village: villages?.find((entry) => entry.name === option.text),
    lore: VILLAGE_LORE[option.text],
  }));
  const choices = allChoices.filter(({ village }) => !village?.isFull);
  const fullNames = allChoices
    .filter(({ village }) => village?.isFull)
    .map(({ option }) => option.text);
  const layout =
    CHOICE_LAYOUTS[Math.min(Math.max(choices.length, 1), 5) as ChoiceCount];
  const onRejected = () => {
    setSelected(undefined);
    void refetch();
  };

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
          {guide && (
            <p className="border-primary/40 bg-primary/5 mx-auto mt-1 max-w-2xl rounded-lg border px-4 py-2 text-base">
              <b>Lemu:</b> {guide}
            </p>
          )}
        </header>
        {isLoading ? (
          <Loader explanation="Gathering the villages" />
        ) : (
          <ul
            ref={cardList}
            className={cn("mx-auto grid w-full grid-cols-1 gap-4", layout.grid)}
          >
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
                    "group bg-card hover:border-primary focus-visible:border-primary focus-visible:ring-ring focus-visible:ring-offset-background flex h-full w-full flex-row overflow-hidden rounded-xl border-2 text-left shadow-sm transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none @2xl:flex-col",
                    selected?.text === option.text &&
                      "border-primary ring-2 ring-primary",
                  )}
                >
                  {village?.villageGraphic && (
                    <div
                      className={cn(
                        "relative aspect-square w-2/5 shrink-0 overflow-hidden @2xl:aspect-[16/9] @2xl:w-full",
                        layout.art,
                      )}
                    >
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
                      {village?.needsShinobi && (
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
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!isLoading && fullNames.length > 0 && (
          <p className="text-muted-foreground text-center">
            {listNames(fullNames)} {fullNames.length === 1 ? "isn't" : "aren't"} taking
            new Genin right now: {fullNames.length === 1 ? "it has" : "they have"} the
            most active shinobi, and the other villages need you more.
          </p>
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
                onClick={() => onChoose(selected, onRejected)}
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

/**
 * Card grid per number of open villages: one column on phones, two from @2xl (504px), and
 * from @5xl (768px) a row per count that keeps cards a readable width. The art grows
 * taller as fewer cards share a row, so the row fills the page's height without pushing
 * the details below the fold.
 */
const CHOICE_LAYOUTS: Record<ChoiceCount, { grid: string; art: string }> = {
  1: { grid: "max-w-2xl", art: "" },
  2: { grid: "max-w-[64rem] @2xl:grid-cols-2", art: "@2xl:aspect-[4/3]" },
  3: { grid: "@2xl:grid-cols-2 @5xl:grid-cols-3", art: "@5xl:aspect-[4/3]" },
  4: { grid: "@2xl:grid-cols-2 @7xl:grid-cols-4", art: "@7xl:aspect-[4/3]" },
  5: {
    grid: "@2xl:grid-cols-2 @5xl:grid-cols-3 @7xl:grid-cols-5",
    art: "@7xl:aspect-[3/4]",
  },
};

/** How many village cards a layout is for. */
type ChoiceCount = 1 | 2 | 3 | 4 | 5;

/** Join village names as "A", "A and B" or "A, B and C". */
const listNames = (names: readonly string[]) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

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
