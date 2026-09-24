import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/libs/shadui";
import { parseHtml } from "@/utils/parse";

interface QuoteProps extends Omit<React.HTMLAttributes<HTMLQuoteElement>, "children"> {
  author?: string;
  date?: string;
  onRemove?: () => void;
  ref?: React.Ref<HTMLQuoteElement>;
  /**
   * The quoted post as an already-sanitized HTML string, which parseHtml turns back
   * into elements. A string rather than React nodes, because serializing nodes needs
   * react-dom/server, which would then ship to the browser on every page.
   */
  children?: string;
}

const Quote = ({
  ref,
  className,
  author,
  date,
  children,
  onRemove,
  ...props
}: QuoteProps) => {
  return (
    <blockquote
      ref={ref}
      className={cn(
        "relative my-4 mr-2 rounded-lg border-primary border-l-4 bg-accent p-4 shadow-md",
        className,
      )}
      {...props}
    >
      {author && (
        <div className="mb-2 font-semibold text-muted-foreground text-sm">
          Quoted from {author}
          {date && ` on ${date}`}
        </div>
      )}
      <div className="text-foreground italic">{parseHtml(children ?? "")}</div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-2 right-2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Remove quote"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </blockquote>
  );
};

Quote.displayName = "Quote";

export { Quote };
