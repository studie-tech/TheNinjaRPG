"use client";

import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { DialogDescription } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import type { Badge } from "@/drizzle/schema";
import AvatarImage from "@/layout/Avatar";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { formatDateTimeShort } from "@/utils/time";

/** Load public badge holders only while the statistics dialog is mounted. */
export const BadgeStatisticsModal = ({
  badge,
  setIsOpen,
  returnFocusRef,
}: BadgeStatisticsModalProps) => {
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const limit = 10;
  const query = api.badge.getAchievers.useQuery(
    { badgeId: badge.id, page, limit, order },
    {
      staleTime: 30_000,
      // The tRPC transport retries transient failures; surface its final failure for Retry.
      retry: false,
    },
  );
  const total = query.data?.total;
  const pages = Math.max(1, Math.ceil((total ?? 0) / limit));

  return (
    <Modal
      title="Badge statistics"
      isOpen
      setIsOpen={setIsOpen}
      returnFocusRef={returnFocusRef}
      className="sm:max-w-xl md:max-w-xl"
      bodyClassName="space-y-4"
      closeButton={false}
      footerExtra={
        <nav
          aria-label="Badge achiever pages"
          className="flex w-full items-center justify-between gap-2"
        >
          <Button
            variant="outline"
            className="min-h-[44px] sm:min-h-9"
            disabled={page === 0 || query.isFetching}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <span role="status" className="text-muted-foreground text-sm tabular-nums">
            Page {page + 1}
            {total === undefined ? "" : ` of ${Math.max(pages, page + 1)}`}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px] sm:min-h-9"
            disabled={!query.data?.hasMore || query.isFetching || query.isError}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight aria-hidden="true" className="ml-1 h-4 w-4" />
          </Button>
        </nav>
      }
    >
      <DialogDescription className="sr-only">
        Players who earned {badge.name}, ordered by award time.
      </DialogDescription>
      <div className="bg-muted/30 flex items-center gap-4 rounded-lg border p-4">
        <Image
          src={badge.image}
          alt=""
          width={72}
          height={72}
          className="h-18 w-18 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold break-words">{badge.name}</h3>
          <p className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
            <Users aria-hidden="true" className="h-4 w-4 shrink-0" />
            {total === undefined
              ? "Players who earned this badge"
              : `${total.toLocaleString()} ${total === 1 ? "player has" : "players have"} earned this badge`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Achieved by</h3>
        <Select
          value={order}
          onValueChange={(value: "newest" | "oldest") => {
            setOrder(value);
            setPage(0);
          }}
        >
          <SelectTrigger
            aria-label="Sort badge achievers"
            className="min-h-[44px] w-40 sm:min-h-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div aria-busy={query.isFetching} className="min-h-32">
        {query.isPending ? (
          <Loader explanation="Loading badge achievers" />
        ) : query.isError ? (
          <div className="space-y-3 rounded-md border p-4" role="alert">
            <p>Badge achievers could not be loaded. Please try again.</p>
            <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
              {query.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        ) : !query.data?.users.length ? (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="font-medium">
              {page === 0 ? "No badge achievers yet" : "No achievers on this page"}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {page === 0
                ? "Players will appear here when they earn this badge."
                : "The list may have changed. Return to the previous page."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              Award times are shown in UTC.
            </p>
            <ul
              className="mt-2 divide-y rounded-md border px-3"
              aria-label="Badge achievers"
            >
              {query.data.users.map((user) => (
                <li key={user.userId}>
                  <Link
                    href={`/username/${user.username}`}
                    className="hover:bg-muted/50 focus-visible:ring-ring -mx-3 flex items-center gap-3 rounded-md px-3 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset"
                  >
                    <AvatarImage
                      href={user.avatar || IMG_AVATAR_DEFAULT}
                      alt={user.username}
                      size={40}
                      className="m-0 h-10 w-10 shrink-0 rounded-lg border"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{user.username}</p>
                      <p className="text-muted-foreground text-xs">
                        Level {user.level}
                      </p>
                      {user.achievedAt && (
                        <time
                          dateTime={user.achievedAt.toISOString()}
                          className="text-muted-foreground text-xs tabular-nums sm:hidden"
                        >
                          {formatDateTimeShort(user.achievedAt)} UTC
                        </time>
                      )}
                    </div>
                    {user.achievedAt && (
                      <time
                        dateTime={user.achievedAt.toISOString()}
                        className="text-muted-foreground hidden text-right text-sm tabular-nums sm:block"
                      >
                        {formatDateTimeShort(user.achievedAt)}
                      </time>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
};

interface BadgeStatisticsModalProps {
  badge: Pick<Badge, "id" | "name" | "image">;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}
