import { useEffect, useRef, useState } from "react";

interface Pagination {
  fetchNextPage: () => Promise<any>;
  hasNextPage: boolean | undefined;
  lastElement: HTMLElement | null;
}

/** Fetch available pages as the observed last row enters the viewport. */
export const useInfinitePagination = ({
  fetchNextPage,
  hasNextPage,
  lastElement,
}: Pagination) => {
  const [page, setPage] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useRef<HTMLElement | null>(null);

  /**
   * Mount only once
   */
  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first?.isIntersecting) {
        setPage((prev: number) => prev + 1);
      }
    });
    return () => {
      observerRef.current?.disconnect();
    };
  }, []); // do this only once, on mount

  /**
   * Update observerRef when last element changes
   */
  useEffect(() => {
    lastElementRef.current = lastElement;
    if (lastElement && observerRef.current) {
      observerRef.current.observe(lastElement);
    }
    return () => {
      if (lastElement && observerRef.current) {
        observerRef.current.unobserve(lastElement);
      }
    };
  }, [lastElement]);

  useEffect(() => {
    const fetchData = async () => {
      if (page > 0) {
        const result = await fetchNextPage();
        // The observer only fires when the last element starts intersecting. When a
        // batch adds nothing after it (e.g. rows filtered out client-side), it stays on
        // screen and would never fire again; re-observing reports it once more, so the
        // next batch loads. Stops on the last page (hasNextPage) or on an error.
        const element = lastElementRef.current;
        const observer = observerRef.current;
        if (!result?.isError && element && observer) {
          observer.unobserve(element);
          observer.observe(element);
        }
      }
    };
    // TanStack's fetchNextPage resolves with isError instead of rejecting; the
    // QueryCache error handler reports failed pages.
    if (hasNextPage) void fetchData();
  }, [fetchNextPage, hasNextPage, page]);
};

/**
 * Zero-based page numbers to show for `current` of `total` pages: the first and last pages
 * and one page either side of the current one, with `null` marking each skipped run. A
 * single skipped page is shown instead of a gap.
 */
export const getPageWindow = (current: number, total: number): (number | null)[] => {
  const shown = new Set(
    [0, total - 1, current - 1, current, current + 1].filter(
      (page) => page >= 0 && page < total,
    ),
  );
  const sorted = [...shown].sort((a, b) => a - b);
  const pages: (number | null)[] = [];
  for (const page of sorted) {
    const previous = pages[pages.length - 1];
    if (typeof previous === "number" && page - previous === 2) pages.push(page - 1);
    else if (typeof previous === "number" && page - previous > 2) pages.push(null);
    pages.push(page);
  }
  return pages;
};
