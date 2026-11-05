import { Quote } from "lucide-react";

/** Names the quotes that stay attached to a message while its author edits their own text. */
export const QuotingNote = ({ authors }: { authors: string[] }) => {
  if (authors.length === 0) return null;
  return (
    <p className="mb-1 flex items-center gap-1 text-muted-foreground text-xs">
      <Quote className="h-3 w-3" aria-hidden />
      Quoting {authors.join(", ")}
    </p>
  );
};
