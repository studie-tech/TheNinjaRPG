"use client";

import { Trash2 } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";

/** Icon button asking for confirmation before a destructive statistics reset. */
export const ClearDataConfirm: React.FC<ClearDataConfirmProps> = (props) => {
  return (
    <Confirm
      title={props.title}
      button={
        <Button size="icon">
          <Trash2 className="h-5 w-5 cursor-pointer" />
        </Button>
      }
      proceed_label="Clear Data"
      confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      onAccept={(e) => {
        e.preventDefault();
        props.onConfirm();
      }}
    >
      {props.children}
    </Confirm>
  );
};

/** Clear every battle statistic of one content type. */
export const ClearBattleDataButton: React.FC<ClearBattleDataButtonProps> = (props) => {
  const { type, label, onCleared } = props;
  const { mutate: deleteAllData, isPending: isDeleting } =
    api.data.deleteAllDataBattleAction.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) await onCleared();
      },
    });

  return (
    <ClearDataConfirm
      title={`Clear All ${label.charAt(0).toUpperCase()}${label.slice(1)} Battle Data`}
      onConfirm={() => deleteAllData({ type })}
    >
      {isDeleting ? (
        <Loader explanation="Deleting data" />
      ) : (
        <>
          Are you sure you want to clear all {label} battle action data? This action
          cannot be undone and will reset all {label} usage statistics. This action will
          be logged for future audit and review.
        </>
      )}
    </ClearDataConfirm>
  );
};

/** Clear the battle statistics of one content entry. */
export const ClearContentBattleDataButton: React.FC<
  ClearContentBattleDataButtonProps
> = (props) => {
  const { id, type, label, name } = props;
  const utils = api.useUtils();
  const { mutate: deleteSingleData, isPending: isDeleting } =
    api.data.deleteSingleDataBattleAction.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) await utils.data.getStatistics.invalidate();
      },
    });

  return (
    <ClearDataConfirm
      title={`Clear ${name} Battle Data`}
      onConfirm={() => deleteSingleData({ contentId: id, type })}
    >
      {isDeleting ? (
        <Loader explanation="Deleting data" />
      ) : (
        <>
          Are you sure you want to clear all battle action data for{" "}
          <strong>{name}</strong>? This action cannot be undone and will reset all usage
          statistics for this {label}. This action will be logged for future audit and
          review.
        </>
      )}
    </ClearDataConfirm>
  );
};

interface ClearDataConfirmProps {
  title: string;
  onConfirm: () => void;
  children: React.ReactNode;
}

interface ClearBattleDataButtonProps {
  type: "jutsu" | "item" | "bloodline" | "ai";
  /** Content name in the dialog copy, e.g. "jutsu". */
  label: string;
  /** Refresh the statistics shown behind the dialog. */
  onCleared: () => Promise<unknown>;
}

interface ClearContentBattleDataButtonProps {
  id: string;
  type: ClearBattleDataButtonProps["type"];
  /** Content name in the dialog copy, e.g. "jutsu". */
  label: string;
  name: string;
}
