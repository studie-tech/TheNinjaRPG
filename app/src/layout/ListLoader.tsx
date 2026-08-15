import type React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import Loader from "@/layout/Loader";

interface ListLoaderProps {
  initialLoading: boolean;
  loading: boolean;
  explanation?: string;
}

const SKELETON_ROWS = Array.from({ length: 3 }, (_, index) => `list-skeleton-${index}`);

/** Reserves a full viewport of ItemWithEffects-shaped rows during the first fetch. */
export const ListSkeleton: React.FC<{ explanation?: string }> = ({ explanation }) => (
  <div role="status" aria-label={explanation ?? "Loading list"}>
    {SKELETON_ROWS.map((key) => (
      <div
        key={key}
        className="mb-3 flex h-[321px] flex-row items-center overflow-hidden rounded-lg border bg-popover p-2 shadow-sm"
        aria-hidden="true"
      >
        <Skeleton className="mx-3 hidden h-40 basis-1/3 bg-foreground/15 md:block" />
        <div className="flex h-full basis-full flex-col gap-3 p-3 md:basis-2/3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-28 w-28 shrink-0 bg-foreground/15 md:hidden" />
            <div className="flex w-full flex-col gap-3">
              <Skeleton className="h-7 w-2/5 bg-foreground/15" />
              <Skeleton className="h-4 w-3/5 bg-foreground/15" />
              <Skeleton className="h-4 w-full bg-foreground/15" />
              <Skeleton className="h-4 w-4/5 bg-foreground/15" />
            </div>
          </div>
          <Skeleton className="h-20 w-full bg-foreground/15" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-5 w-4/5 bg-foreground/15" />
            <Skeleton className="h-5 w-3/4 bg-foreground/15" />
            <Skeleton className="h-5 w-2/3 bg-foreground/15" />
            <Skeleton className="h-5 w-5/6 bg-foreground/15" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

/**
 * ListLoader
 * - Item-shaped placeholders reserve the first page during the initial fetch.
 * - A fixed-height spinner slot remains below loaded rows for subsequent fetches.
 *
 * A bare `{loading && <Loader/>}` placed above a list is a layout-shift generator: the
 * spinner is inserted and removed on every page fetch, moving every visible row by its
 * height each time. The initial skeleton prevents the footer from jumping when the first
 * page arrives, while the bottom slot prevents shifts during infinite scrolling.
 */
export const ListLoader: React.FC<ListLoaderProps> = ({
  initialLoading,
  loading,
  explanation,
}) => {
  return (
    <>
      {initialLoading && <ListSkeleton explanation={explanation} />}
      {/* Reserved in absolute pixels rather than rem: the root font-size is 12px scaled
          by --font-scale, so a rem-based height can overflow at larger settings. */}
      <div
        className="flex min-h-[64px] items-center justify-center"
        aria-busy={loading}
        aria-live="polite"
      >
        {loading && !initialLoading && <Loader noPadding explanation={explanation} />}
      </div>
    </>
  );
};

export default ListLoader;
