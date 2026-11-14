"use client";

import { Slot } from "@radix-ui/react-slot";
import type React from "react";
import { isValidElement, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import Modal from "@/layout/Modal";
import { cn } from "@/libs/shadui";

interface ConfirmProps {
  id?: string;
  title: string;
  button: React.ReactNode;
  className?: string;
  children: string | React.ReactNode;
  confirmClassName?: string;
  /** `destructive` styles Proceed as an irreversible action. */
  tone?: "destructive";
  proceed_label?: string | null;
  proceed_loading_label?: string | null;
  isValid?: boolean;
  /**
   * The action's pending state. While it is true the dialog shows progress and cannot
   * be dismissed; without `keepOpenOnAccept` the dialog closes once it settles.
   */
  isLoading?: boolean;
  keepOpenOnAccept?: boolean;
  confirmDisabled?: boolean;
  disabled?: boolean;
  /** Classes for the trigger; `className` styles the dialog. */
  triggerClassName?: string;
  /** Accessible name for a trigger without visible text (required for icon triggers). */
  triggerLabel?: string;
  /**
   * The `button` element is a ref-forwarding component that spreads its props onto a
   * `<button>`. `Button` and native `<button>` triggers are detected without it.
   */
  triggerAsChild?: boolean;
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
 * Open a Modal and run onAccept once confirmed. A `Button` trigger becomes the dialog
 * trigger itself; any other content is wrapped in a plain button. The trigger restores
 * keyboard focus on dismissal, including confirmations nested inside another Modal.
 */
export const Confirm: React.FC<ConfirmProps> = (props) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showModal, setShowModal] = useState<boolean>(false);
  const { onAccept } = props;
  const close = () => setShowModal(false);
  const footerExtra =
    typeof props.footerExtra === "function"
      ? props.footerExtra({ close })
      : props.footerExtra;
  const isButtonTrigger =
    isValidElement(props.button) &&
    (props.triggerAsChild ||
      props.button.type === Button ||
      props.button.type === "button");
  const TriggerComp = isButtonTrigger ? Slot : "button";
  return (
    <>
      <TriggerComp
        ref={triggerRef}
        type={isButtonTrigger ? undefined : "button"}
        aria-disabled={props.disabled}
        tabIndex={props.disabled ? -1 : undefined}
        aria-haspopup="dialog"
        aria-label={props.triggerLabel}
        onClick={(e: React.MouseEvent) => {
          // A disabled trigger still swallows the click, so a surrounding link stays inert.
          e.preventDefault();
          e.stopPropagation();
          if (!props.disabled) setShowModal(true);
        }}
        className={cn(
          !isButtonTrigger &&
            "inline-flex items-center rounded-md text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          props.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          props.triggerClassName,
        )}
      >
        {props.button}
      </TriggerComp>

      {/* The dialog is portalled, but React still bubbles its events through this
          tree; stopping them here keeps clicks inside it from reaching a clickable
          parent such as a card link. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: event boundary that renders no box */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keys stay with the dialog's own handlers */}
      <span className="contents" onClick={(e) => e.stopPropagation()}>
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
          tone={props.tone}
          onAccept={onAccept && ((e) => onAccept(e, { close }))}
          className={props.className}
          isValid={props.isValid}
          isLoading={props.isLoading}
          keepOpenOnAccept={props.keepOpenOnAccept}
          closeWhenSettled={props.isLoading !== undefined}
          proceedDisabled={props.confirmDisabled}
          onClose={props.onClose}
          footerExtra={footerExtra}
        >
          {props.children}
        </Modal>
      </span>
    </>
  );
};

export default Confirm;
