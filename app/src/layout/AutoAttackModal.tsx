"use client";

import { useLocalStorage } from "@/hooks/localstorage";
import Modal2 from "@/layout/Modal2";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Dispatch, SetStateAction } from "react";

interface AutoAttackModalProps {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  onEnable: () => void;
}

export default function AutoAttackModal({ isOpen, setIsOpen, onEnable }: AutoAttackModalProps) {
  const [autoAttackMinLevel, setAutoAttackMinLevel] = useLocalStorage<number>(
    "autoAttackMinLevel",
    1,
  );
  const [autoAttackDelay, setAutoAttackDelay] = useLocalStorage<number>(
    "autoAttackDelay",
    5,
  );

  const handleEnable = () => {
    onEnable();
    setIsOpen(false);
  };

  return (
    <Modal2
      title="Auto Attack Configuration"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      isValid={true}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Minimum Level to Attack
          </label>
          <Input
            type="number"
            min="1"
            max="100"
            value={autoAttackMinLevel}
            onChange={(e) => setAutoAttackMinLevel(parseInt(e.target.value) || 1)}
            className="w-full"
            placeholder="1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Only attack enemies at or above this level
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Attack Delay (seconds)
          </label>
          <Input
            type="number"
            min="1"
            max="60"
            value={autoAttackDelay}
            onChange={(e) => setAutoAttackDelay(parseInt(e.target.value) || 5)}
            className="w-full"
            placeholder="5"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Wait this many seconds between attacks
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleEnable}
            className="flex-1"
          >
            Enable Auto Attack
          </Button>
        </div>
      </div>
    </Modal2>
  );
}
