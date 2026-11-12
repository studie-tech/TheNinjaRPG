"use client";

import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import { DungeonHallOfFame } from "@/layout/DungeonHallOfFame";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { useUserData } from "@/utils/UserContext";

/** Browse current dungeons and inspect published rewards without opening the staff editor. */
export const DungeonCatalogue = () => {
  const { timeDiff } = useUserData();
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailsTrigger = useRef<HTMLButtonElement | null>(null);
  const catalogue = api.coop.dungeon.getCatalogue.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const deadlines = catalogue.data?.map((entry) => entry.expiresAt) ?? [];
  useRefreshAt(deadlines, () => void catalogue.refetch(), timeDiff);
  const serverNow = Date.now() - (timeDiff ?? 0);
  const entries =
    catalogue.data?.filter(
      (entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > serverNow,
    ) ?? [];
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const selected = entries.find((entry) => entry.id === selectedId);
  return (
    <ContentBox
      title="Dungeons"
      subtitle="Current dungeons across Seichi"
      defaultBackHref="/manual"
    >
      <Tabs defaultValue="current">
        <TabsList className="mb-4">
          <TabsTrigger value="current">Current Dungeons</TabsTrigger>
          <TabsTrigger value="fame">Hall of Fame</TabsTrigger>
        </TabsList>
        <TabsContent value="current">
          {catalogue.isPending ? (
            <Loader explanation="Loading current dungeons" />
          ) : catalogue.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p>Could not load dungeons. Please try again.</p>
              <Button onClick={() => void catalogue.refetch()}>Retry</Button>
            </div>
          ) : entries.length === 0 ? (
            <p>No current dungeons are available.</p>
          ) : (
            <>
              <p className="mb-2 text-muted-foreground text-sm">
                Soonest expiration first. Times are shown in your local timezone.
              </p>
              <ul className="divide-y">
                {entries
                  .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                  .map((entry) => (
                    <li
                      key={entry.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-semibold">{entry.name}</p>
                        <p className="text-muted-foreground text-sm">
                          Sector {entry.sector} · Position [{entry.longitude},{" "}
                          {entry.latitude}]
                        </p>
                      </div>
                      <div className="col-start-1 row-start-2 text-sm sm:col-start-auto sm:row-start-auto">
                        {entry.expiresAt ? (
                          <>
                            <p>
                              Expires in{" "}
                              <Countdown
                                targetDate={new Date(entry.expiresAt)}
                                timeDiff={timeDiff}
                                onEndShow="Expired"
                              />
                            </p>
                            <p className="text-muted-foreground">
                              {new Date(entry.expiresAt).toLocaleString()}
                            </p>
                          </>
                        ) : (
                          <p>No expiration</p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        className="col-start-2 row-span-2 row-start-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto"
                        aria-label={`Details for ${entry.name}`}
                        onClick={(event) => {
                          detailsTrigger.current = event.currentTarget;
                          setSelectedId(entry.id);
                        }}
                      >
                        Details
                      </Button>
                    </li>
                  ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <p>
                  Showing {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, entries.length)} of{" "}
                  {entries.length}
                </p>
                {pages > 1 && (
                  <nav aria-label="Dungeon pages" className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <span>
                      {currentPage + 1} of {pages}
                    </span>
                    <Button
                      variant="outline"
                      disabled={currentPage === pages - 1}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </nav>
                )}
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="fame">
          <DungeonHallOfFame />
        </TabsContent>
      </Tabs>
      {selected && (
        <Modal
          title={selected.name}
          isOpen={!!selected}
          setIsOpen={(open) => {
            if (!(typeof open === "function" ? open(true) : open)) setSelectedId(null);
          }}
          returnFocusRef={detailsTrigger}
        >
          <p className="text-muted-foreground text-sm">
            Sector {selected.sector} · Position [{selected.longitude},{" "}
            {selected.latitude}]
          </p>
          {selected.description && (
            <p className="whitespace-pre-wrap break-words">{selected.description}</p>
          )}
          <p>Minimum level: {selected.requiredLevel}</p>
          <p>Maximum players: {selected.maxPlayers}</p>
          <p>
            Expiration:{" "}
            {selected.expiresAt
              ? new Date(selected.expiresAt).toLocaleString()
              : "No expiration"}
          </p>
          <h3 className="pt-2 font-semibold">Completion rewards</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Ryo</dt>
            <dd>{selected.rewards.money.toLocaleString()}</dd>
            <dt>Experience</dt>
            <dd>{selected.rewards.experience.toLocaleString()}</dd>
            <dt>Tokens</dt>
            <dd>{selected.rewards.tokens.toLocaleString()}</dd>
            <dt>Prestige</dt>
            <dd>{selected.rewards.prestige.toLocaleString()}</dd>
          </dl>
          <h3 className="pt-2 font-semibold">Possible drops</h3>
          {selected.rewards.drops.length === 0 ? (
            <p>No additional drops.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Reward quantities and drop chances
                </caption>
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className="py-2">
                      Reward
                    </th>
                    <th scope="col" className="px-2">
                      Quantity
                    </th>
                    <th scope="col" className="text-right">
                      Chance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.rewards.drops.map((drop, index) => (
                    <tr key={`${drop.type}-${drop.id}-${index}`} className="border-b">
                      <td className="break-words py-2">
                        {drop.name}
                        {drop.onlyOnce && (
                          <span className="block text-muted-foreground text-xs">
                            Once per player per dungeon
                          </span>
                        )}
                      </td>
                      <td className="px-2 tabular-nums">{drop.quantity}</td>
                      <td className="text-right tabular-nums">{drop.chance}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-muted-foreground text-sm">
                Each drop rolls independently per member when claiming a completion
                reward. Chances do not need to total 100%. Packages and caches may
                contain additional random rewards.
              </p>
            </>
          )}
        </Modal>
      )}
    </ContentBox>
  );
};
