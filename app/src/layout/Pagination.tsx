import type React from "react";

interface PaginationProps {
  current: number;
  total: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}

const Pagination: React.FC<PaginationProps> = (props) => {
  return (
    <div className="my-4 flex flex-row justify-center">
      <nav aria-label="Page navigation example">
        <ul className="inline-flex -space-x-px">
          <li>
            <button
              type="button"
              className="ml-0 rounded-l-lg border border-gray-300 bg-white px-3 py-2 text-gray-500 leading-tight hover:bg-gray-100 hover:text-gray-700"
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
                      ? "border border-gray-300 bg-blue-50 px-3 py-2 text-blue-600 hover:bg-blue-100 hover:text-blue-700"
                      : "border border-gray-300 bg-white px-3 py-2 text-gray-500 leading-tight hover:bg-gray-100 hover:text-gray-700"
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
              className="rounded-r-lg border border-gray-300 bg-white px-3 py-2 text-gray-500 leading-tight hover:bg-gray-100 hover:text-gray-700"
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
