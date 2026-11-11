"use client";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateNumberInputs } from "@/components/ui/number-input";
import { useHeaderActionsFocus } from "@/hooks/useHeaderActionsFocus";
import { cn } from "@/libs/shadui";

export const modalViewportClassName =
  "max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden";

export const modalScrollableBodyClassName =
  "min-h-0 space-y-2 overflow-y-auto overscroll-contain py-4";

/**
 * Footer row. On phones its buttons (Close, Proceed and any caller extras) share
 * rows at equal width and a thumb-sized height, wrapping when they do not fit;
 * from `sm` up they sit right-aligned at their natural size. Proceed comes last.
 * Heights are minimums so a long label can wrap instead of overflowing.
 */
const modalFooterClassName = cn(
  "flex-row flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end sm:space-x-0",
  "[&>:is(button,a)]:h-auto [&>:is(button,a)]:min-h-12 [&>:is(button,a)]:flex-1 [&>:is(button,a)]:basis-28 [&>:is(button,a)]:rounded-lg [&>:is(button,a)]:text-base",
  "sm:[&>:is(button,a)]:min-h-9 sm:[&>:is(button,a)]:flex-none sm:[&>:is(button,a)]:basis-auto sm:[&>:is(button,a)]:text-sm",
);

interface ModalProps {
  id?: string;
  title: string;
  children: string | React.ReactNode;
  className?: string;
  /** Merges into the scrollable body wrapper (default `space-y-2 py-4`). */
  bodyClassName?: string;
  proceed_label?: string | null;
  proceed_loading_label?: string | null;
  confirmClassName?: string;
  isValid?: boolean;
  isLoading?: boolean;
  /** Keep the dialog open after Proceed so the caller can close it on success. */
  keepOpenOnAccept?: boolean;
  proceedDisabled?: boolean;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onAccept?: (
    e:
      | React.MouseEvent<HTMLButtonElement, MouseEvent>
      | React.KeyboardEvent<KeyboardEvent>,
  ) => void;
  onClose?: () => void;
  /** Center title, body, and footer (e.g. compact info dialogs) */
  centerText?: boolean;
  /** Extra controls before the Close button (e.g. cancel listing). */
  footerExtra?: React.ReactNode;
  /** Merges into the footer (default stacks buttons on mobile). */
  footerClassName?: string;
  /** Close when clicking outside the dialog (default true). */
  dismissOnInteractOutside?: boolean;
  /** Restore focus to a mounted caller control when opened without a Radix DialogTrigger. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Footer Close button (default true). Content dialogs without a confirmation or
   * `onClose` can drop it; the header close button, Escape and an outside click still
   * close the dialog.
   */
  closeButton?: boolean;
}

/**
 * Shared dialog with a scrollable body, pending-action guards, and optional confirmation.
 * Callers own its open state and can supply a focus target for programmatic opening.
 */
export const Modal: React.FC<ModalProps> = (props) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerFocusRef = useHeaderActionsFocus();
  const returnFocusRef = props.returnFocusRef ?? headerFocusRef;

  const isProceedDisabled = props.isLoading || props.proceedDisabled;

  const handleAccept = (
    e:
      | React.MouseEvent<HTMLButtonElement, MouseEvent>
      | React.KeyboardEvent<KeyboardEvent>,
  ) => {
    if (
      props.isLoading ||
      props.proceedDisabled ||
      !validateNumberInputs(bodyRef.current)
    )
      return;
    // The close side-effect is independent of onAccept: dialogs that render a
    // Proceed button without an accept handler still use it to dismiss.
    props.onAccept?.(e);
    if (!props.keepOpenOnAccept && (props.isValid === undefined || props.isValid)) {
      props.setIsOpen(false);
    }
  };

  // Handle key-presses for Enter key only when this modal is open
  useEffect(() => {
    if (!props.isOpen) return;

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if the active element is a button (it will handle Enter itself)
      const activeElement = document.activeElement;
      const isButton = activeElement?.tagName === "BUTTON";

      // Enter only mirrors a Proceed button that is visible, enabled, and backed
      // by an accept handler, so it never dismisses a plain info/edit dialog.
      if (
        event.key === "Enter" &&
        !event.isComposing &&
        props.proceed_label &&
        props.onAccept &&
        !isButton &&
        !isProceedDisabled
      ) {
        handleAccept(event as unknown as React.KeyboardEvent<KeyboardEvent>);
      }
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [
    props.isOpen,
    props.proceed_label,
    props.onAccept,
    isProceedDisabled,
    handleAccept,
  ]);

  // Every dismissal (header close, Escape, outside click, footer Close) runs onClose
  const handleDialogClose = () => {
    if (props.isLoading) return;
    if (props.onClose) props.onClose();
    props.setIsOpen(false);
  };

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (open) props.setIsOpen(true);
        else handleDialogClose();
      }}
    >
      <DialogContent
        id={props.id ? `${props.id}-content` : undefined}
        closeDisabled={props.isLoading}
        className={cn(
          props.className || "",
          modalViewportClassName,
          "!top-4 !translate-y-0 sm:!top-[50%] sm:!-translate-y-1/2",
          "data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-top-0",
          props.isLoading && "[&>button]:pointer-events-none [&>button]:opacity-40",
        )}
        aria-busy={props.isLoading}
        onCloseAutoFocus={(event) => {
          // Override Radix's trigger focus only while the caller's target is still mounted.
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (props.isLoading) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (props.isLoading || props.dismissOnInteractOutside === false) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader
          className={props.centerText ? "items-center text-center" : undefined}
        >
          <DialogTitle className={props.centerText ? "text-center" : undefined}>
            {props.title}
          </DialogTitle>
        </DialogHeader>

        <div
          ref={bodyRef}
          className={cn(
            modalScrollableBodyClassName,
            props.bodyClassName,
            props.centerText && "text-center",
          )}
        >
          {props.children}
        </div>

        {(props.closeButton !== false || props.proceed_label || props.footerExtra) && (
          <DialogFooter
            className={cn(
              modalFooterClassName,
              props.centerText && "sm:justify-center",
              props.footerClassName,
            )}
          >
            {props.proceed_label && (
              <Button
                id={props.id ? `${props.id}-proceed` : undefined}
                disabled={isProceedDisabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAccept(e);
                }}
                // Callers colour their action (red for destructive, amber, ...); the
                // theme's primary button is the default. First in the DOM so the dialog
                // focuses it on open and Enter confirms; `order` places it last.
                className={cn("z-30 order-2", props.confirmClassName)}
              >
                {props.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {props.isLoading
                  ? (props.proceed_loading_label ?? props.proceed_label)
                  : props.proceed_label}
              </Button>
            )}
            {props.footerExtra}
            {props.closeButton !== false && (
              <Button
                id={props.id ? `${props.id}-close` : undefined}
                variant="outline"
                disabled={props.isLoading}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDialogClose();
                }}
                className="border-border bg-card text-foreground hover:bg-muted hover:text-foreground z-30 order-1"
              >
                Close
              </Button>
            )}
            {props.isLoading && props.proceed_loading_label && (
              <span className="sr-only" role="status" aria-live="polite">
                {props.proceed_loading_label}
              </span>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Modal;
