import type React from "react";
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
  onMissionSelect: (mission: { id: string; name: string; image?: string }) => void;
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
}) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div
          className={cn(
            disabled ? "grayscale filter" : "hover:cursor-pointer hover:opacity-30",
          )}
        >
          <Image alt="small" src={setting.image} width={256} height={256} />
          <p className="font-bold">{setting.name}</p>
          <p>[Select out of {count} available]</p>
        </div>
      </PopoverTrigger>
      <PopoverContent>
        {missions.length === 0 && emptyContent}
        <div className="grid grid-cols-3 gap-2">
          {missions.map((mission) => (
            <AlertDialog key={mission.id}>
              <AlertDialogTrigger asChild>
                <div className="hover:cursor-pointer hover:opacity-70">
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
                </div>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {dialogTitle}: {mission.name}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {dialogDescription(mission)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  {actionDisabled ? (
                    <AlertDialogAction disabled>{actionText}</AlertDialogAction>
                  ) : (
                    <AlertDialogAction onClick={() => onMissionSelect(mission)}>
                      {actionText}
                    </AlertDialogAction>
                  )}
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default MissionPicker;
