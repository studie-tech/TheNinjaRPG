"use client";
/**
 * This is a modal that is used to display a modal.
 */
import type React from "react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/libs/shadui";

export const modalViewportClassName =
  "max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden";

export const modalScrollableBodyClassName =
  "min-h-0 space-y-2 overflow-y-auto overscroll-contain py-4";

interface Modal2Props {
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
}

const Modal2: React.FC<Modal2Props> = (props) => {
  const confirmBtnClassName = props.confirmClassName
    ? props.confirmClassName
    : "bg-blue-600 text-white hover:bg-blue-700";

  const isProceedDisabled = props.isLoading || props.proceedDisabled;

  const handleAccept = useCallback(
    (
      e:
        | React.MouseEvent<HTMLButtonElement, MouseEvent>
        | React.KeyboardEvent<KeyboardEvent>,
    ) => {
      // The close side-effect is independent of onAccept: dialogs that render a
      // Proceed button without an accept handler still use it to dismiss.
      props.onAccept?.(e);
      if (props.isValid === undefined || props.isValid) {
        props.setIsOpen(false);
      }
    },
    [props.onAccept, props.isValid, props.setIsOpen],
  );

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

  const handleDialogClose = () => {
    if (props.onClose) props.onClose();
    props.setIsOpen(false);
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={props.setIsOpen}>
      <DialogContent
        id={props.id ? `${props.id}-content` : undefined}
        className={cn(
          props.className || "",
          modalViewportClassName,
          "!top-4 !translate-y-0 sm:!top-[50%] sm:!-translate-y-1/2",
          "data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-top-0",
          "sm:data-[state=open]:slide-in-from-top-[48%] sm:data-[state=closed]:slide-out-to-top-[48%]",
        )}
        onEscapeKeyDown={handleDialogClose}
        onInteractOutside={handleDialogClose}
      >
        <DialogHeader
          className={props.centerText ? "items-center text-center" : undefined}
        >
          <DialogTitle className={props.centerText ? "text-center" : undefined}>
            {props.title}
          </DialogTitle>
        </DialogHeader>

        <div
          className={cn(
            modalScrollableBodyClassName,
            props.bodyClassName,
            props.centerText && "text-center",
          )}
        >
          {props.children}
        </div>

        <DialogFooter className={props.centerText ? "sm:justify-center" : undefined}>
          {props.proceed_label && (
            <>
              <Button
                id={props.id ? `${props.id}-proceed` : undefined}
                disabled={isProceedDisabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAccept(e);
                }}
                className={`z-30 rounded-lg ${confirmBtnClassName}`}
              >
                {props.isLoading && props.proceed_loading_label
                  ? props.proceed_loading_label
                  : props.proceed_label}
              </Button>
              <div className="grow"></div>
            </>
          )}
          {props.footerExtra}
          <Button
            id={props.id ? `${props.id}-close` : undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDialogClose();
            }}
            className="z-30 rounded-lg border border-gray-500 bg-gray-700 font-medium text-gray-300 text-sm hover:bg-gray-600 hover:text-white"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default Modal2;
