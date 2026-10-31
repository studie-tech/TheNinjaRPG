"use client";

import type React from "react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChatPanel } from "@/layout/ChatPanel";
import { GameSettingsPanel } from "@/layout/GameSettings";
import { useUserData } from "@/utils/UserContext";

interface LowerRightHelpProps {
  className?: string;
  children?: React.ReactNode;
  ariaLabel?: string;
}

/**
 * The help corner of every layout: the chat panel for signed-in players, and the
 * audio settings for visitors.
 */
const LowerRightHelpBtn: React.FC<LowerRightHelpProps> = (props) => {
  const { data: userData, updateUser } = useUserData();
  const [isOpen, setIsOpen] = useState(false);

  if (userData) {
    return <ChatPanel className={props.className}>{props.children}</ChatPanel>;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        name="supportBtn"
        aria-label={props.ariaLabel ?? "Audio settings"}
      >
        <div className={props.className}>{props.children}</div>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[calc(100vw-1rem)] max-w-[32rem] min-w-0 flex-col p-3 sm:w-[32rem]"
      >
        <div className="min-h-0 overflow-y-auto">
          <p className="mb-2 font-bold text-lg">Audio Settings</p>
          <div className="max-h-[400px] overflow-y-auto">
            <GameSettingsPanel
              userData={userData}
              updateUser={updateUser}
              onNavigate={() => setIsOpen(false)}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default LowerRightHelpBtn;
