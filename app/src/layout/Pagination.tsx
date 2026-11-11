import type React from "react";

interface PaginationProps {
  current: number;
  total: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}

const Pagination: React.FC<PaginationProps> = (props) => {
  return (
    <div className="my-4 flex flex-row justify-center">
      <nav aria-label="Pages">
        <ul className="inline-flex -space-x-px">
          <li>
            <button
              type="button"
              className="ml-0 rounded-l-lg border border-border bg-background px-3 py-2 text-muted-foreground leading-tight hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={props.current <= 0}
              onClick={() => props.setPage(props.current - 1)}
            >
              Previous
            </button>
          </li>
          {Array.from({ length: props.total }, (_, idx) => idx).map((pageNum) => {
            return (
              <li key={`page-${pageNum}`}>
                <button
                  type="button"
                  className={
                    pageNum === props.current
                      ? "border border-border bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/80"
                      : "border border-border bg-background px-3 py-2 text-muted-foreground leading-tight hover:bg-accent hover:text-foreground"
                  }
                  onClick={() => {
                    props.setPage(pageNum);
                  }}
                >
                  {pageNum + 1}
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className="rounded-r-lg border border-border bg-background px-3 py-2 text-muted-foreground leading-tight hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={props.current >= props.total - 1}
              onClick={() => props.setPage(props.current + 1)}
            >
              Next
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Pagination;
