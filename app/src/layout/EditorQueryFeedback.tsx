import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";

/** Settled failure of a staff editor's record query: not found, or failed with a retry. */
export const EditorQueryFeedback: React.FC<EditorQueryFeedbackProps> = (props) => {
  const { label, subtitle, backHref, hasCachedData, isError, isFetching, onRetry } =
    props;
  return (
    <ContentBox title="Content Panel" subtitle={subtitle} defaultBackHref={backHref}>
      <p role="alert">
        {isError
          ? hasCachedData
            ? `Latest ${label} details could not be loaded. The editor is showing previously loaded data.`
            : `This ${label} could not be loaded. Please try again.`
          : `This ${label} could not be found.`}
      </p>
      {isError && (
        <Button disabled={isFetching} onClick={() => void onRetry()}>
          {isFetching ? "Retrying..." : "Retry"}
        </Button>
      )}
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
