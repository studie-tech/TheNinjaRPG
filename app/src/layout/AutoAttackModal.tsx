"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocalStorage } from "@/hooks/localstorage";
import Modal2 from "@/layout/Modal2";

interface AutoAttackModalProps {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  onEnable: () => void;
}

export default function AutoAttackModal({
  isOpen,
  setIsOpen,
  onEnable,
}: AutoAttackModalProps) {
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
          <label
            htmlFor="auto-attack-min-level"
            className="mb-2 block font-medium text-sm"
          >
            Minimum Level to Attack
          </label>
          <Input
            id="auto-attack-min-level"
            type="number"
            min="1"
            max="100"
            value={autoAttackMinLevel}
            onChange={(e) => setAutoAttackMinLevel(parseInt(e.target.value, 10) || 1)}
            className="w-full"
            placeholder="1"
          />
          <p className="mt-1 text-muted-foreground text-xs">
            Only attack enemies at or above this level
          </p>
        </div>

        <div>
          <label htmlFor="auto-attack-delay" className="mb-2 block font-medium text-sm">
            Attack Delay (seconds)
          </label>
          <Input
            id="auto-attack-delay"
            type="number"
            min="1"
            max="60"
            value={autoAttackDelay}
            onChange={(e) => setAutoAttackDelay(parseInt(e.target.value, 10) || 5)}
            className="w-full"
            placeholder="5"
          />
          <p className="mt-1 text-muted-foreground text-xs">
            Wait this many seconds between attacks
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => setIsOpen(false)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleEnable} className="flex-1">
            Enable Auto Attack
          </Button>
        </div>
      </div>
    </Modal2>
  );
}
