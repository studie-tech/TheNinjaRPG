import type React from "react";
import { Button } from "@/components/ui/button";
import { getPageWindow } from "@/libs/pagination";
import { cn } from "@/libs/shadui";

interface PaginationProps {
  current: number;
  total: number;
  setPage: (page: number) => void;
}

/**
 * Page controls for a zero-based page index: Previous, the first and last pages, the pages
 * around the current one and Next. The row wraps instead of overflowing narrow screens.
 */
const Pagination: React.FC<PaginationProps> = (props) => {
  const pages = getPageWindow(props.current, props.total);
  return (
    <nav aria-label="Pages" className="my-4 flex justify-center">
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-10"
            disabled={props.current <= 0}
            onClick={() => props.setPage(props.current - 1)}
          >
            Previous
          </Button>
        </li>
        {pages.map((pageNum, index) =>
          pageNum === null ? (
            <li
              // Gaps sit between fixed neighbours, so their position identifies them.
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              …
            </li>
          ) : (
            <li key={`page-${pageNum}`}>
              <Button
                type="button"
                variant={pageNum === props.current ? "default" : "secondary"}
                size="sm"
                className={cn(
                  "min-h-10 min-w-10",
                  pageNum === props.current && "font-bold",
                )}
                aria-current={pageNum === props.current ? "page" : undefined}
                aria-label={`Page ${pageNum + 1}`}
                onClick={() => props.setPage(pageNum)}
              >
                {pageNum + 1}
              </Button>
            </li>
          ),
        )}
        <li>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-10"
            disabled={props.current >= props.total - 1}
            onClick={() => props.setPage(props.current + 1)}
          >
            Next
          </Button>
        </li>
      </ul>
    </nav>
  );
};

export default Pagination;
