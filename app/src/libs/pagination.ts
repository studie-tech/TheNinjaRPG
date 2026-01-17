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
  const observer = useRef<IntersectionObserver | null>(null);

  /**
   * Mount only once
   */
  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first?.isIntersecting) {
        setPage((prev: number) => prev + 1);
      }
    });
    return () => {
      observer.current?.disconnect();
    };
  }, []); // do this only once, on mount

  /**
   * Update observer when last element changes
   */
  useEffect(() => {
    if (lastElement && observer.current) {
      observer.current.observe(lastElement);
    }
    return () => {
      if (lastElement && observer.current) {
        observer.current.unobserve(lastElement);
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
