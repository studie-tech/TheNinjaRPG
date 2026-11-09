"use client";

import type React from "react";
import { useRef, useState } from "react";
import Modal from "@/layout/Modal";
import { cn } from "@/libs/shadui";

interface ConfirmProps {
  id?: string;
  title: string;
  button: React.ReactNode;
  className?: string;
  children: string | React.ReactNode;
  confirmClassName?: string;
  proceed_label?: string | null;
  proceed_loading_label?: string | null;
  isValid?: boolean;
  isLoading?: boolean;
  keepOpenOnAccept?: boolean;
  confirmDisabled?: boolean;
  disabled?: boolean;
  /** Classes for the trigger wrapper; `className` styles the dialog. */
  triggerClassName?: string;
  /** Accessible name for a trigger without visible text. */
  triggerLabel?: string;
  /** Extra footer controls before Close. Pass a function to receive `close`. */
  footerExtra?: React.ReactNode | ((args: { close: () => void }) => React.ReactNode);
  /** With `keepOpenOnAccept`, call `close` once the action has succeeded. */
  onAccept?: (
    e:
      | React.MouseEvent<HTMLButtonElement, MouseEvent>
      | React.KeyboardEvent<KeyboardEvent>,
    actions: { close: () => void },
  ) => void;
  onClose?: () => void;
}

/**
 * Open a Modal and run onAccept once confirmed. The mounted trigger also restores
 * keyboard focus on dismissal, including confirmations nested inside another Modal.
 */
export const Confirm: React.FC<ConfirmProps> = (props) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [showModal, setShowModal] = useState<boolean>(false);
  const { onAccept } = props;
  const close = () => setShowModal(false);
  const footerExtra =
    typeof props.footerExtra === "function"
      ? props.footerExtra({ close })
      : props.footerExtra;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: wrapper for button children - using button would create invalid nested buttons */}
      <div
        ref={triggerRef}
        role="button"
        tabIndex={props.disabled ? -1 : 0}
        aria-disabled={props.disabled}
        aria-label={props.triggerLabel}
        onClick={(e) => {
          // A disabled trigger still swallows the click, so a surrounding link stays inert.
          e.preventDefault();
          e.stopPropagation();
          if (!props.disabled) setShowModal(true);
        }}
        onKeyDown={(e) => {
          if (props.disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setShowModal(true);
          }
        }}
        className={cn(
          "inline-flex items-center",
          props.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          props.triggerClassName,
        )}
      >
        {props.button}
      </div>

      <Modal
        id={props.id}
        returnFocusRef={triggerRef}
        title={props.title}
        isOpen={showModal}
        setIsOpen={setShowModal}
        proceed_label={
          props.proceed_label !== undefined ? props.proceed_label : "Proceed"
        }
        proceed_loading_label={props.proceed_loading_label}
        confirmClassName={props.confirmClassName}
        onAccept={onAccept && ((e) => onAccept(e, { close }))}
        className={props.className}
        isValid={props.isValid}
        isLoading={props.isLoading}
        keepOpenOnAccept={props.keepOpenOnAccept}
        proceedDisabled={props.confirmDisabled}
        onClose={props.onClose}
        footerExtra={footerExtra}
      >
        {props.children}
      </Modal>
    </>
  );
};

export default Confirm;
