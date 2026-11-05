import { Copy } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Modal from "@/layout/Modal";
import { showMutationToast } from "@/libs/toast";

export type CloneSource = { id: string; name: string };

interface ConfirmedCloneControlProps {
  source: CloneSource;
  /** Content name in the dialog, e.g. "quest". */
  label: string;
  isPending: boolean;
  clone: (id: string) => Promise<{ success: boolean; message: string }>;
  /** Refresh and navigate; the dialog has already closed. */
  onCloned: (cloneId: string) => void;
  /** Dialog body describing the confirmed source. */
  body: (source: CloneSource) => React.ReactNode;
  /** Replaces the default copy icon. */
  renderTrigger?: (open: () => void, isPending: boolean) => React.ReactNode;
}

/**
 * Clone behind a confirmation bound to the source it was opened on. Render it keyed by
 * the source id, so a parent reused for another entry discards the old snapshot instead
 * of letting a stale dialog act on new props.
 *
 * The in-flight claim closes the click/Enter window before pending state renders. A
 * committed clone closes the dialog before any best-effort refresh or navigation, so
 * another copy always needs a fresh confirmation. On a transport failure, which the
 * shared tRPC handler reports, the dialog stays open for an explicit retry.
 */
export const ConfirmedCloneControl: React.FC<ConfirmedCloneControlProps> = (props) => {
  const { source, label, isPending, clone, onCloned, body, renderTrigger } = props;
  const [confirmedSource, setConfirmedSource] = useState<CloneSource | null>(null);
  const flight = useSingleFlight<string>();
  const open = () => setConfirmedSource({ ...source });

  const cloneConfirmedSource = (sourceId: string) =>
    flight.run(sourceId, async () => {
      try {
        const result = await clone(sourceId);
        showMutationToast(result);
        if (!result.success) return;
        setConfirmedSource(null);
        onCloned(result.message);
      } catch {
        // Reported by the shared tRPC handler.
      }
    });

  return (
    <>
      {renderTrigger ? (
        renderTrigger(open, isPending)
      ) : (
        <button
          type="button"
          aria-label={`Clone ${source.name}`}
          className="mr-1 inline-flex items-center disabled:cursor-wait disabled:opacity-50"
          disabled={isPending}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            open();
          }}
        >
          <Copy className="h-6 w-6 hover:text-popover-foreground/50" />
        </button>
      )}
      {confirmedSource && (
        <Modal
          id={`clone-${label.toLowerCase()}-${confirmedSource.id}`}
          title={`Clone ${label}: ${confirmedSource.name}`}
          isOpen
          setIsOpen={(isOpen) => {
            if (!isOpen) setConfirmedSource(null);
          }}
          proceed_label={`Clone ${label}`}
          proceed_loading_label="Cloning"
          isLoading={isPending}
          keepOpenOnAccept
          onAccept={(event) => {
            event.preventDefault();
            void cloneConfirmedSource(confirmedSource.id);
          }}
        >
          {body(confirmedSource)}
        </Modal>
      )}
    </>
  );
};
