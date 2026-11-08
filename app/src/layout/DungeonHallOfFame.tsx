"use client";

import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { formatSecondsToTimeDisplay } from "@/utils/time";

/** Show squad clear records in paginated modals, preserving each run's human roster. */
export const DungeonHallOfFame = () => {
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<{
    id: string;
    name: string;
    mode: "fastest" | "completed";
    page: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dungeons = api.coop.dungeon.getHallOfFameDungeons.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const rankings = api.coop.dungeon.getRankings.useQuery(
    {
      dungeonId: selection?.id ?? "",
      mode: selection?.mode ?? "fastest",
      page: selection?.page ?? 0,
    },
    { enabled: selection !== null, refetchOnWindowFocus: true },
  );
  const entries = dungeons.data ?? [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(entries.length / 10) - 1));
  return (
    <>
      {dungeons.isPending ? (
        <Loader explanation="Loading Dungeon Hall of Fame" />
      ) : dungeons.isError ? (
        <div role="alert">
          <p>Could not load dungeons.</p>
          <Button onClick={() => void dungeons.refetch()}>Retry</Button>
        </div>
      ) : entries.length === 0 ? (
        <p>No published dungeons yet.</p>
      ) : (
        <>
          <ul className="divide-y">
            {entries.slice(currentPage * 10, (currentPage + 1) * 10).map((dungeon) => (
              <li
                key={dungeon.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <p className="min-w-0 break-words font-semibold">{dungeon.name}</p>
                <div className="flex flex-wrap gap-2">
                  {(["fastest", "completed"] as const).map((mode) => (
                    <Button
                      key={mode}
                      variant="secondary"
                      aria-label={`${mode === "fastest" ? "Fastest Clear" : "Completed"} for ${dungeon.name}`}
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setSelection({
                          id: dungeon.id,
                          name: dungeon.name,
                          mode,
                          page: 0,
                        });
                      }}
                    >
                      {mode === "fastest" ? "Fastest Clear" : "Completed"}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {entries.length > 10 && (
            <nav
              aria-label="Hall of Fame dungeon pages"
              className="mt-4 flex items-center justify-end gap-2"
            >
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span>
                {currentPage + 1} of {Math.ceil(entries.length / 10)}
              </span>
              <Button
                variant="outline"
                disabled={(currentPage + 1) * 10 >= entries.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
      {selection && (
        <Modal
          title={`${selection.name} · ${selection.mode === "fastest" ? "Fastest Clear" : "Completed"}`}
          isOpen
          returnFocusRef={trigger}
          setIsOpen={(open) => {
            if (!(typeof open === "function" ? open(true) : open)) setSelection(null);
          }}
        >
          <p className="text-muted-foreground text-sm">
            {selection.mode === "fastest"
              ? "Squads ranked by shortest clear time. Time includes pauses and retries after entry."
              : "Squads ranked by completion order, earliest finish first."}
          </p>
          {rankings.isPending ? (
            <Loader explanation="Loading squad records" />
          ) : rankings.isError ? (
            <div role="alert">
              <p>Could not load squad records.</p>
              <Button onClick={() => void rankings.refetch()}>Retry</Button>
            </div>
          ) : !rankings.data?.entries.length ? (
            <p>No recorded squad clears yet.</p>
          ) : (
            <ol className="space-y-3" start={selection.page * 6 + 1}>
              {rankings.data.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                >
                  <span className="font-semibold">#{entry.rank}</span>
                  <ul
                    className="flex min-w-0 list-none flex-wrap gap-x-4 gap-y-1"
                    aria-label="Squad members"
                  >
                    {entry.players.map((player) => (
                      <li key={player.id} className="break-all font-semibold">
                        {player.name}
                      </li>
                    ))}
                  </ul>
                  <div className="col-start-2 text-sm sm:col-start-auto sm:text-right">
                    {selection.mode === "fastest" ? (
                      <>
                        <p className="tabular-nums">
                          {formatSecondsToTimeDisplay(
                            Math.floor(entry.durationMs / 1000),
                          )}
                        </p>
                        <p className="text-muted-foreground text-xs">Clear time</p>
                      </>
                    ) : (
                      <>
                        <p className="tabular-nums">Completion #{entry.rank}</p>
                        <p className="text-muted-foreground text-xs">
                          {new Date(entry.completedAt).toLocaleString()}
                        </p>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-muted-foreground text-xs">
            Only clears with recorded entry and finish times are ranked. Each entry
            represents one squad run.
          </p>
          {(selection.page > 0 || rankings.data?.hasMore) && (
            <nav
              aria-label="Squad ranking pages"
              className="flex items-center justify-between gap-2 pt-2"
            >
              <Button
                variant="outline"
                disabled={selection.page === 0 || rankings.isFetching}
                onClick={() => setSelection({ ...selection, page: selection.page - 1 })}
              >
                Previous
              </Button>
              <span>Page {selection.page + 1}</span>
              <Button
                variant="outline"
                disabled={!rankings.data?.hasMore || rankings.isFetching}
                onClick={() => setSelection({ ...selection, page: selection.page + 1 })}
              >
                Next
              </Button>
            </nav>
          )}
        </Modal>
      )}
    </>
  );
};
