"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { safeLocalStorageSetItem, useLocalStorage } from "@/hooks/localstorage";
import Modal from "@/layout/Modal";

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

  const [minLevelDraft, setMinLevelDraft] = useState(autoAttackMinLevel);
  const [delayDraft, setDelayDraft] = useState(autoAttackDelay);
  useEffect(() => {
    if (isOpen) {
      setMinLevelDraft(autoAttackMinLevel);
      setDelayDraft(autoAttackDelay);
    }
  }, [isOpen, autoAttackMinLevel, autoAttackDelay]);
  const isValid =
    Number.isInteger(minLevelDraft) &&
    minLevelDraft >= 1 &&
    minLevelDraft <= 100 &&
    Number.isInteger(delayDraft) &&
    delayDraft >= 1 &&
    delayDraft <= 60;

  const handleEnable = () => {
    if (!isValid) return;
    setAutoAttackMinLevel(minLevelDraft);
    setAutoAttackDelay(delayDraft);
    // Auto attack reads storage as soon as it starts, before storage-hook effects run.
    safeLocalStorageSetItem("autoAttackMinLevel", JSON.stringify(minLevelDraft));
    safeLocalStorageSetItem("autoAttackDelay", JSON.stringify(delayDraft));
    onEnable();
    setIsOpen(false);
  };

  return (
    <Modal
      title="Auto Attack Configuration"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      isValid={isValid}
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="auto-attack-min-level"
            className="mb-2 block font-medium text-sm"
          >
            Minimum Level to Attack
          </label>
          <NumberInput
            id="auto-attack-min-level"
            min="1"
            max="100"
            value={minLevelDraft}
            onValueChange={setMinLevelDraft}
            emptyFallback={1}
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
          <NumberInput
            id="auto-attack-delay"
            min="1"
            max="60"
            value={delayDraft}
            onValueChange={setDelayDraft}
            emptyFallback={5}
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
          <Button disabled={!isValid} onClick={handleEnable} className="flex-1">
            Enable Auto Attack
          </Button>
        </div>
      </div>
    </Modal>
  );
}
