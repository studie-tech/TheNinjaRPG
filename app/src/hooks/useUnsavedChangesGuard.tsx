"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { type SetStateAction, useEffect, useRef, useState } from "react";
import Modal from "@/layout/Modal";

/**
 * Ask before discarding an editor's unsaved work. While `isDirty`, closing or reloading
 * the tab triggers the browser's leave prompt, and clicks on internal links or a
 * ContentBox back button open a "Discard unsaved changes?" dialog that continues the
 * navigation only once confirmed. `confirmDiscard` runs an in-page action that replaces
 * the draft (New, load another entry) through the same dialog. Render `dialog` once.
 *
 * The App Router has no cancellable route-change event, so the browser's own Back button
 * is not intercepted.
 */
export const useUnsavedChangesGuard = (isDirty: boolean) => {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  // Set while a confirmed back-button click is replayed, so the guard lets it through.
  const isReplaying = useRef(false);

  useEffect(() => {
    if (!isDirty) return;
    /** Require browser confirmation before closing or reloading a dirty editor. */
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    /** Defer in-app links and toolbar-back navigation until draft discard is confirmed. */
    const onClick = (event: MouseEvent) => {
      if (isReplaying.current || event.defaultPrevented || !isPlainClick(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      const back = target?.closest<HTMLElement>("[data-content-box-back]");
      if (back) {
        event.preventDefault();
        event.stopPropagation();
        setPendingAction(() => () => {
          isReplaying.current = true;
          back.click();
          isReplaying.current = false;
        });
        return;
      }
      const href = leavingHref(target?.closest<HTMLAnchorElement>("a[href]"));
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingAction(() => () => router.push(href));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [isDirty, router]);

  /** Run a draft-replacing action immediately when clean, or queue it for confirmation. */
  const confirmDiscard = (action: () => void) => {
    if (isDirty) setPendingAction(() => action);
    else action();
  };

  const isOpen = pendingAction !== null;
  /** Treat dialog dismissal as cancellation of the deferred action. */
  const setIsOpen = (open: SetStateAction<boolean>) => {
    const next = typeof open === "function" ? open(isOpen) : open;
    if (!next) setPendingAction(null);
  };

  const dialog = (
    <Modal
      title="Discard unsaved changes?"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      proceed_label="Discard changes"
      confirmClassName="bg-red-600 text-white hover:bg-red-700"
      onAccept={() => {
        const action = pendingAction;
        setPendingAction(null);
        action?.();
      }}
    >
      This editor has changes that are not saved yet. Continuing discards them.
    </Modal>
  );

  return { confirmDiscard, dialog };
};

/** `useUnsavedChangesGuard` for an editor that only needs its leave confirmation. */
export const UnsavedChangesGuard: React.FC<{ isDirty: boolean }> = ({ isDirty }) =>
  useUnsavedChangesGuard(isDirty).dialog;

/** A primary-button click without modifier keys, which would open a new tab or window. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/** The in-app path an anchor leaves the current page for, or null if it stays or opens elsewhere. */
export const leavingHref = (anchor: HTMLAnchorElement | null | undefined) => {
  if (!anchor || anchor.hasAttribute("download")) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search
  )
    return null;
  return `${url.pathname}${url.search}${url.hash}`;
};
