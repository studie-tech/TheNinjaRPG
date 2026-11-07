import { X } from "lucide-react";
import type * as React from "react";
import { QuoteJump } from "@/layout/QuoteJump";
import { cn } from "@/libs/shadui";
import { parseHtml } from "@/utils/parse";

interface QuoteProps extends Omit<React.HTMLAttributes<HTMLQuoteElement>, "children"> {
  author?: string;
  date?: string;
  /** The quoted message's id; its attribution then jumps to that message. */
  commentId?: string;
  onRemove?: () => void;
  ref?: React.Ref<HTMLQuoteElement>;
  /** Sanitized post HTML or children already converted by the post parser. */
  children?: React.ReactNode;
}

const Quote = ({
  ref,
  className,
  author,
  date,
  commentId,
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
          {commentId ? (
            <QuoteJump commentId={commentId} author={author}>
              Quoted from {author}
              {date && ` on ${date}`}
            </QuoteJump>
          ) : (
            <>
              Quoted from {author}
              {date && ` on ${date}`}
            </>
          )}
        </div>
      )}
      <div className="text-foreground italic">
        {typeof children === "string" ? parseHtml(children) : children}
      </div>
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
