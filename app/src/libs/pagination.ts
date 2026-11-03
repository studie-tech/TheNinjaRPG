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
