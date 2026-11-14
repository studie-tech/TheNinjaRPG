import { ArrowLeft, FileSearch, FileWarning, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { capitalizeFirstLetter } from "@/utils/string";

/** Recover missing or failed editor queries with retry/list actions, preserving cached editors. */
export const EditorQueryFeedback: React.FC<EditorQueryFeedbackProps> = (props) => {
  const { label, subtitle, backHref, hasCachedData, isError, isFetching, onRetry } =
    props;
  const Icon = isError ? FileWarning : FileSearch;
  const title = isError
    ? `Unable to ${hasCachedData ? "refresh" : "load"} ${label}`
    : `${capitalizeFirstLetter(label)} not found`;
  return (
    <ContentBox
      title={`Edit ${label}`}
      subtitle={subtitle}
      defaultBackHref={backHref}
      padding={false}
    >
      <div className="flex gap-4 p-4 sm:p-5">
        <div
          className="border-primary/20 bg-primary/5 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border"
          aria-hidden="true"
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div role="alert">
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-card-foreground/70 mt-1 max-w-prose text-sm leading-relaxed">
              {isError
                ? hasCachedData
                  ? "The editor below is showing previously loaded data. Retry to get the latest version."
                  : "Try again in a moment, or return to the list to find the content you need."
                : `The link may be outdated, or this ${label} may have been removed.`}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {isError && (
              <Button
                type="button"
                className="min-h-[44px] sm:min-h-9"
                disabled={isFetching}
                aria-busy={isFetching}
                onClick={() => void onRetry()}
              >
                <RotateCcw
                  className={`mr-2 h-4 w-4 ${isFetching ? "motion-safe:animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {isFetching ? "Retrying..." : "Retry"}
              </Button>
            )}
            {!hasCachedData && (
              <Button
                asChild
                variant={isError ? "outline" : "default"}
                className="min-h-[44px] sm:min-h-9"
              >
                <Link href={backHref}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Back to list
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </ContentBox>
  );
};

interface EditorQueryFeedbackProps {
  /** Lower-case content name used in the message, e.g. "jutsu". */
  label: string;
  subtitle: string;
  backHref: string;
  /** The editor is still rendered below this box from previously loaded data. */
  hasCachedData?: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => unknown;
}
