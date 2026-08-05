import type React from "react";
import Loader from "@/layout/Loader";

interface ListLoaderProps {
  loading: boolean;
  explanation?: string;
}

/**
 * ListLoader
 * - Fixed-height slot for infinite-scroll lists, rendered *below* the list.
 *
 * A bare `{loading && <Loader/>}` placed above a list is a layout-shift generator: the
 * spinner is inserted and removed on every page fetch, moving every visible row by its
 * height each time. Cumulative Layout Shift is a sum, so on a long scroll that adds up
 * quickly. This slot is always in the document and always the same height, so toggling
 * the spinner inside it moves nothing.
 */
export const ListLoader: React.FC<ListLoaderProps> = ({ loading, explanation }) => {
  return (
    // Reserved in absolute pixels rather than rem: the root font-size is 12px scaled by
    // --font-scale, so a rem-based height would shrink to exactly the spinner's size at
    // the default scale and overflow at the larger ones.
    <div
      className="flex min-h-[64px] items-center justify-center"
      aria-busy={loading}
      aria-live="polite"
    >
      {loading && <Loader noPadding explanation={explanation} />}
    </div>
  );
};

export default ListLoader;
