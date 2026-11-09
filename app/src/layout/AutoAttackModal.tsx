"use client";

import { Zap, ZapOff } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { AUTO_ATTACK_SETTINGS, useAutoAttackMode } from "@/hooks/autoAttack";
import { useLocalStorage } from "@/hooks/localstorage";
import Modal from "@/layout/Modal";
import { cn } from "@/libs/shadui";
import { safeLocalStorageSetItem } from "@/utils/storage";

const { minLevel, delay } = AUTO_ATTACK_SETTINGS;

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
    minLevel.key,
    minLevel.default,
  );
  const [autoAttackDelay, setAutoAttackDelay] = useLocalStorage<number>(
    delay.key,
    delay.default,
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
    minLevelDraft >= minLevel.min &&
    minLevelDraft <= minLevel.max &&
    Number.isInteger(delayDraft) &&
    delayDraft >= delay.min &&
    delayDraft <= delay.max;

  const handleEnable = () => {
    if (!isValid) return;
    setAutoAttackMinLevel(minLevelDraft);
    setAutoAttackDelay(delayDraft);
    // Auto attack reads storage as soon as it starts, before storage-hook effects run.
    safeLocalStorageSetItem(minLevel.key, JSON.stringify(minLevelDraft));
    safeLocalStorageSetItem(delay.key, JSON.stringify(delayDraft));
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
            min={minLevel.min}
            max={minLevel.max}
            value={minLevelDraft}
            onValueChange={setMinLevelDraft}
            emptyFallback={minLevel.default}
            className="w-full"
            placeholder={String(minLevel.default)}
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
            min={delay.min}
            max={delay.max}
            value={delayDraft}
            onValueChange={setDelayDraft}
            emptyFallback={delay.default}
            className="w-full"
            placeholder={String(delay.default)}
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

/** ANBU page control: stops a running auto attack, or opens its configuration. */
export const AutoAttackToggle = ({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName: string;
}) => {
  const [autoAttackMode, setAutoAttackMode] = useAutoAttackMode();
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      {autoAttackMode ? (
        <Button
          className={cn(className, "text-red-500")}
          aria-label="Disable auto attack"
          hoverText="Auto Attack"
          onClick={() => setAutoAttackMode(false)}
        >
          <Zap className={iconClassName} />
        </Button>
      ) : (
        <Button
          className={cn(className, "hover:text-red-500")}
          aria-label="Configure auto attack"
          hoverText="Auto Attack"
          onClick={() => setShowModal(true)}
        >
          <ZapOff className={iconClassName} />
        </Button>
      )}
      <AutoAttackModal
        isOpen={showModal}
        setIsOpen={setShowModal}
        onEnable={() => setAutoAttackMode(true)}
      />
    </>
  );
};
