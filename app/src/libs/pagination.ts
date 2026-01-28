import { useRef, useState, useEffect } from "react";
import { showMutationToast } from "@/libs/toast";

interface Pagination {
  fetchNextPage: () => Promise<any>;
  hasNextPage: boolean | undefined;
  lastElement: HTMLDivElement | null;
}

export const useInfinitePagination = ({
  fetchNextPage,
  hasNextPage,
  lastElement,
}: Pagination) => {
  const [page, setPage] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);

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
        await fetchNextPage();
      }
    };
    if (hasNextPage) {
      fetchData().catch((error: unknown) => {
        if (error instanceof Error) {
          console.error(error);
        }
        showMutationToast({
          success: false,
          title: "Error fetching batch",
          message: "Error fetching next batch of data",
        });
      });
    }
  }, [fetchNextPage, hasNextPage, page]);
};
