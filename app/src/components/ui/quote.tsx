import { X } from "lucide-react";
import type * as React from "react";
import { renderToString } from "react-dom/server";
import { cn } from "@/libs/shadui";
import { parseHtml } from "@/utils/parse";

interface QuoteProps extends React.HTMLAttributes<HTMLQuoteElement> {
  author?: string;
  date?: string;
  onRemove?: () => void;
  ref?: React.Ref<HTMLQuoteElement>;
}

function htmlDecode(input: string) {
  const doc = new DOMParser().parseFromString(input, "text/html");
  return doc.documentElement.textContent;
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
  const content = htmlDecode(renderToString(children));
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
      <div className="text-foreground italic">{parseHtml(content || "")}</div>
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
