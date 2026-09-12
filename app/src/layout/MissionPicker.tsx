import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";

interface MissionPickerProps {
  setting: {
    name: string;
    image: string;
    rank: string;
  };
  missions: Array<{
    id: string;
    name: string;
    image?: string;
  }>;
  count: number;
  disabled?: boolean;
  onMissionSelect: (mission: {
    id: string;
    name: string;
    image?: string;
  }) => boolean | Promise<boolean>;
  dialogTitle: string;
  dialogDescription: (mission: {
    id: string;
    name: string;
    image?: string;
  }) => React.ReactNode;
  actionDisabled?: boolean;
  actionText?: string;
  additionalContent?: (mission: {
    id: string;
    name: string;
    image?: string;
  }) => React.ReactNode;
  emptyContent?: React.ReactNode;
  /** Locks sibling mission controls while a mutually-exclusive start is in progress. */
  interactionDisabled?: boolean;
  /** Keeps the exact confirmation open and identifies its scoped pending state. */
  pendingMissionId?: string | null;
}

export const MissionPicker: React.FC<MissionPickerProps> = ({
  setting,
  missions,
  count,
  disabled = false,
  onMissionSelect,
  dialogTitle,
  dialogDescription,
  actionDisabled = false,
  actionText = "Accept Mission",
  additionalContent,
  emptyContent,
  interactionDisabled = false,
  pendingMissionId = null,
}) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if (!open && pendingMissionId) return;
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || interactionDisabled}
          aria-busy={pendingMissionId ? true : undefined}
          className={cn(
            "disabled:cursor-not-allowed disabled:opacity-60",
            disabled || interactionDisabled
              ? "grayscale filter"
              : "hover:cursor-pointer hover:opacity-30",
          )}
        >
          <Image alt="small" src={setting.image} width={256} height={256} />
          <p className="font-bold">{setting.name}</p>
          <p>[Select out of {count} available]</p>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        {(missions.length === 0 || disabled) && emptyContent}
        <div className="grid grid-cols-3 gap-2">
          {missions.map((mission) => {
            const isStartingMission = pendingMissionId === mission.id;
            const isMissionDisabled =
              disabled || (interactionDisabled && !isStartingMission);
            return (
              <AlertDialog
                key={mission.id}
                open={selectedMissionId === mission.id}
                onOpenChange={(open) => {
                  if (!open && isStartingMission) return;
                  setSelectedMissionId(open ? mission.id : null);
                }}
              >
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={isMissionDisabled}
                    className="hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex flex-col items-center justify-center">
                      <Image
                        alt="small"
                        className="rounded-lg"
                        src={mission.image || setting.image}
                        width={128}
                        height={128}
                      />
                      <p className="text-center font-bold text-xs">{mission.name}</p>
                      {additionalContent?.(mission)}
                    </div>
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent aria-busy={isStartingMission}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {dialogTitle}: {mission.name}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {dialogDescription(mission)}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isStartingMission}>
                      Cancel
                    </AlertDialogCancel>
                    {actionDisabled || (interactionDisabled && !isStartingMission) ? (
                      <AlertDialogAction disabled>{actionText}</AlertDialogAction>
                    ) : (
                      <AlertDialogAction
                        disabled={isStartingMission}
                        aria-busy={isStartingMission}
                        onClick={(event) => {
                          event.preventDefault();
                          if (isStartingMission) return;
                          void Promise.resolve(onMissionSelect(mission)).then(
                            (started) => {
                              if (started) {
                                setSelectedMissionId(null);
                                setIsPopoverOpen(false);
                              }
                            },
                          );
                        }}
                      >
                        {isStartingMission ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 animate-spin"
                              aria-hidden
                            />
                            <span role="status" aria-live="polite">
                              Starting
                            </span>
                          </>
                        ) : (
                          actionText
                        )}
                      </AlertDialogAction>
                    )}
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default MissionPicker;
