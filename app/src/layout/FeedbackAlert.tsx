import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Announces a mutation result as a status or an alert. `foreground` lifts the message to
 * full foreground colour for panels where the muted alert text would sit too low. `children`
 * continue the message, such as a link out of the failure.
 */
export const FeedbackAlert = ({
  feedback,
  foreground = false,
  children,
}: {
  feedback: MutationFeedback;
  foreground?: boolean;
  children?: ReactNode;
}) => (
  <Alert
    variant={feedback.success ? "default" : "destructive"}
    role={feedback.success ? "status" : "alert"}
  >
    <AlertDescription>
      {foreground ? (
        <p className="text-foreground">
          {feedback.message}
          {children}
        </p>
      ) : (
        <>
          {feedback.message}
          {children}
        </>
      )}
    </AlertDescription>
  </Alert>
);

/** Result of a mutation, shown next to the controls that sent it. */
export type MutationFeedback = { success: boolean; message: string };
