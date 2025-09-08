import React from "react";
import Image from "next/image";
import { cn } from "src/libs/shadui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  dialogDescription: (mission: { id: string; name: string; image?: string }) => React.ReactNode;
  actionDisabled?: boolean;
  actionText?: string;
  additionalContent?: (mission: { id: string; name: string; image?: string }) => React.ReactNode;
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
}) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div
          className={cn(
            disabled
              ? "filter grayscale"
              : "hover:cursor-pointer hover:opacity-30",
          )}
        >
          <Image alt="small" src={setting.image} width={256} height={256} />
          <p className="font-bold">{setting.name}</p>
          <p>[Select out of {count} available]</p>
        </div>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-3 gap-2">
          {missions.map((mission, i) => (
            <AlertDialog key={`specific-mission-${i}`}>
              <AlertDialogTrigger asChild>
                <div className="hover:opacity-70 hover:cursor-pointer">
                  <div className="flex flex-col justify-center items-center">
                    <Image
                      alt="small"
                      className="rounded-lg"
                      src={mission.image || setting.image}
                      width={128}
                      height={128}
                    />
                    <p className="font-bold text-xs text-center">
                      {mission.name}
                    </p>
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
                    <AlertDialogAction disabled>
                      {actionText}
                    </AlertDialogAction>
                  ) : (
                    <AlertDialogAction
                      onClick={() => onMissionSelect(mission)}
                    >
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
