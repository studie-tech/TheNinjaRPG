import { Alert, AlertDescription } from "@/components/ui/alert";

/** Result of a mutation, shown next to the controls that sent it. */
export type MutationFeedback = { success: boolean; message: string };

/**
 * Announces a mutation result as a status or an alert. `foreground` lifts the message to
 * full foreground colour for panels where the muted alert text would sit too low.
 */
export const FeedbackAlert = ({
  feedback,
  foreground = false,
}: {
  feedback: MutationFeedback;
  foreground?: boolean;
}) => (
  <Alert
    variant={feedback.success ? "default" : "destructive"}
    role={feedback.success ? "status" : "alert"}
  >
    <AlertDescription>
      {foreground ? (
        <p className="text-foreground">{feedback.message}</p>
      ) : (
        feedback.message
      )}
    </AlertDescription>
  </Alert>
);
