"use client";
/**
 * This is a confirmation modal that is used to display a modal.
 */
import type React from "react";
import { useState } from "react";
import Modal2 from "./Modal2";

interface Confirm2Props {
  id?: string;
  title: string;
  button: React.ReactNode;
  className?: string;
  children: string | React.ReactNode;
  confirmClassName?: string;
  proceed_label?: string | null;
  isValid?: boolean;
  confirmDisabled?: boolean;
  disabled?: boolean;
  onAccept?: (
    e:
      | React.MouseEvent<HTMLButtonElement, MouseEvent>
      | React.KeyboardEvent<KeyboardEvent>,
  ) => void;
  onClose?: () => void;
}

const Confirm2: React.FC<Confirm2Props> = (props) => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const isTriggerDisabled = props.disabled || props.confirmDisabled;

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: wrapper for button children - using button would create invalid nested buttons */}
      <div
        role="button"
        tabIndex={isTriggerDisabled ? -1 : 0}
        onClick={(e) => {
          if (isTriggerDisabled) return;
          e.preventDefault();
          e.stopPropagation();
          setShowModal(true);
        }}
        onKeyDown={(e) => {
          if (isTriggerDisabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setShowModal(true);
          }
        }}
        className={`inline-block ${isTriggerDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        {props.button}
      </div>

      <Modal2
        id={props.id}
        title={props.title}
        isOpen={showModal}
        setIsOpen={setShowModal}
        proceed_label={
          props.proceed_label !== undefined ? props.proceed_label : "Proceed"
        }
        confirmClassName={props.confirmClassName}
        onAccept={props.onAccept}
        className={props.className}
        isValid={props.isValid}
        proceedDisabled={props.confirmDisabled}
        onClose={props.onClose}
      >
        {props.children}
      </Modal2>
    </>
  );
};

export default Confirm2;
