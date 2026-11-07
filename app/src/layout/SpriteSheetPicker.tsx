"use client";

import { LoaderCircle, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import Link from "@/layout/Link";
import { SpriteAnimationPreview, SpriteSheetFrame } from "@/layout/SpriteSheetPreview";
import type { CharacterAnimation } from "@/libs/spriteAnimations";

const PAGE_SIZE = 24;
/** Fast enough to feel live; the search only runs once typing pauses. */
const SEARCH_DELAY_MS = 250;

/** Browse the shared library a page at a time, starting from this AI's own sheets. */
export const SpriteSheetPicker = ({
  userId,
  aiName,
  selectedId,
  savedId,
  studioHref,
  onSelect,
}: SpriteSheetPickerProps) => {
  const [scope, setScope] = useState<SheetScope>("ai");
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  const results = api.spriteAnimation.search.useInfiniteQuery(
    { userId, scope, search, limit: PAGE_SIZE },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      // The grid keeps its shape while the next search loads.
      placeholderData: (previous) => previous,
    },
  );
  const sheets = results.data?.pages.flatMap((page) => page.data) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;
  return (
    <section aria-label="Sheet library" className="mt-5 border-t pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">Choose a sheet</h3>
        <Tabs value={scope} onValueChange={(next) => setScope(next as SheetScope)}>
          <TabsList>
            <TabsTrigger value="ai">{aiName}</TabsTrigger>
            <TabsTrigger value="all">All sheets</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          aria-label="Search sheets"
          placeholder={
            scope === "ai" ? `Search ${aiName}'s sheets` : "Search every sheet"
          }
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <p className="mt-2 text-muted-foreground text-xs" aria-live="polite">
        {results.isPending
          ? "Loading sheets…"
          : `${total.toLocaleString("en-US")} ${total === 1 ? "sheet" : "sheets"}`}
      </p>
      {results.error && (
        <div role="alert" className="mt-2 text-sm">
          <p className="text-destructive">{results.error.message}</p>
          <Button type="button" size="sm" onClick={() => void results.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {!results.isPending && !results.error && total === 0 && (
        <div className="mt-2 rounded-md border border-dashed p-6 text-center text-sm">
          <p className="mb-3 text-muted-foreground">
            {search
              ? `No sheet matches “${search}”.`
              : `No sheets carry ${aiName}'s name yet.`}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {scope === "ai" && (
              <Button type="button" variant="outline" onClick={() => setScope("all")}>
                Search all sheets
              </Button>
            )}
            <Button asChild type="button" variant="outline">
              <Link href={studioHref}>
                <Sparkles className="mr-1 size-4" />
                Create one
              </Link>
            </Button>
          </div>
        </div>
      )}
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {sheets.map((sheet) => (
          <li key={sheet.id}>
            <SheetCard
              sheet={sheet}
              selected={sheet.id === selectedId}
              inUse={sheet.id === savedId}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
      {results.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={results.isFetchingNextPage}
            onClick={() => void results.fetchNextPage()}
          >
            {results.isFetchingNextPage && (
              <LoaderCircle className="mr-2 size-4 animate-spin" />
            )}
            Show more ({sheets.length} of {total.toLocaleString("en-US")})
          </Button>
        </div>
      )}
    </section>
  );
};

/** Plays only while pointed at, so a full page never runs dozens of timers at once. */
const SheetCard = ({ sheet, selected, inUse, onSelect }: SheetCardProps) => {
  const [playing, setPlaying] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={sheet.name}
      title={sheet.name}
      className="flex w-full min-w-0 flex-col overflow-hidden rounded-md border-2 border-transparent bg-card text-left outline-1 outline-border hover:border-primary/50 aria-pressed:border-primary"
      onPointerEnter={() => setPlaying(true)}
      onPointerLeave={() => setPlaying(false)}
      onFocus={() => setPlaying(true)}
      onBlur={() => setPlaying(false)}
      onClick={() => onSelect(sheet)}
    >
      <span className="relative block" aria-hidden="true">
        {playing ? (
          <SpriteAnimationPreview
            animation={sheet}
            className="rounded-none border-0 bg-transparent"
          />
        ) : (
          <SpriteSheetFrame animation={sheet} />
        )}
        {inUse && (
          <span className="absolute top-1 left-1 rounded-sm bg-primary px-1 text-[10px] text-primary-foreground">
            In use
          </span>
        )}
      </span>
      <span className="truncate px-1.5 py-1 text-xs">{sheet.name}</span>
    </button>
  );
};

type SheetScope = "ai" | "all";
type SpriteSheetPickerProps = {
  userId: string;
  aiName: string;
  selectedId?: string;
  savedId?: string;
  studioHref: string;
  onSelect: (sheet: CharacterAnimation) => void;
};
type SheetCardProps = {
  sheet: CharacterAnimation;
  selected: boolean;
  inUse: boolean;
  onSelect: (sheet: CharacterAnimation) => void;
};
