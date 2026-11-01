"use client";

import { Bot, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Modal from "@/layout/Modal";

/** The settings switch confirms PvP handover and explains the saved PvE preference. */
export const AutoCombatControl = (props: AutoCombatControlProps) => {
  const id = useId();
  const [isConfirming, setIsConfirming] = useState(false);
  const switchRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="space-y-1">
      <div className="flex min-h-11 items-center justify-between gap-3 py-2">
        <Label htmlFor={id} className="text-sm">
          Auto combat
        </Label>
        <Switch
          ref={switchRef}
          id={id}
          aria-label="Auto combat"
          aria-describedby={`${id}-help`}
          checked={props.isActive}
          disabled={props.isPending}
          onCheckedChange={(enabled) => {
            if (enabled && props.requiresConfirmation) setIsConfirming(true);
            else props.onChange(enabled);
          }}
        />
      </div>
      <p id={`${id}-help`} className="text-muted-foreground text-xs">
        {props.requiresConfirmation
          ? "Applies to this battle only. New PvP battles start with manual control."
          : "Also sets your auto combat preference for future non-PvP battles."}
      </p>
      {props.error && <p role="alert">{props.error}</p>}
      <Modal
        title="Enable auto combat for this battle?"
        isOpen={isConfirming && !props.isActive}
        setIsOpen={setIsConfirming}
        returnFocusRef={switchRef}
        proceed_label="Enable auto combat"
        isLoading={props.isPending}
        onAccept={() => props.onChange(true)}
      >
        <p>
          Your AI profile will choose and perform actions immediately using your current
          loadout. Turn auto combat off at any time to take control again.
        </p>
        <p>
          This choice applies only to this battle. Your next PvP battle starts manually.
        </p>
      </Modal>
    </div>
  );
};

/** Shows the active mode and returns control when the match permits it. */
export const AutoCombatBadge = ({
  isPending,
  onDisable,
}: {
  isPending: boolean;
  onDisable?: () => void;
}) => {
  const className =
    "min-h-8 gap-1.5 border border-primary/20 bg-popover/95 px-2 text-foreground shadow-sm";
  if (!onDisable)
    return (
      <Badge
        variant="secondary"
        role="status"
        className={className}
        title="Auto combat cannot be changed in this battle."
      >
        <Bot className="h-3.5 w-3.5" aria-hidden="true" />
        Auto combat
      </Badge>
    );
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className}
      aria-label="Disable auto combat"
      title="Take control of your character"
      disabled={isPending}
      onClick={onDisable}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Bot className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {isPending ? "Taking control…" : "Auto combat"}
    </Button>
  );
};

interface AutoCombatControlProps {
  isActive: boolean;
  isPending: boolean;
  requiresConfirmation: boolean;
  error?: string;
  onChange: (enabled: boolean) => void;
}
