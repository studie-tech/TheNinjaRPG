import { Check, Minus, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { cn } from "@/libs/shadui";

interface ToggleProps {
  id?: string;
  labelActive?: string;
  labelInactive?: string;
  value?: boolean;
  disabled?: boolean;
  setShowActive: React.Dispatch<React.SetStateAction<boolean | undefined>>;
  verticalLayout?: boolean;
}

const Toggle: React.FC<ToggleProps> = (props) => {
  // Destructure
  const { id, disabled, value, labelActive, labelInactive, setShowActive } = props;

  // State
  const active = labelActive ?? "Unhandled";
  const inactive = labelInactive ?? "Resolved";

  // Set state
  const setState = useCallback(
    (newValue: boolean) => {
      setShowActive(newValue);
      if (id) safeLocalStorageSetItem(id, newValue.toString());
    },
    [id, setShowActive],
  );

  // If we do not have a current value, get from localStorage or select first one
  useEffect(() => {
    if (value === undefined && id) {
      const select = safeLocalStorageGetItem(id) || "true";
      const newValue = select === "true";
      setState(newValue);
    }
  }, [id, value, setState]);

  // Render
  return (
    <div
      className={cn(
        "flex",
        props.verticalLayout ? "flex-col items-start gap-2" : "flex-row items-center",
      )}
    >
      <Label htmlFor="tag_name" className="mr-2">
        {value ? active : inactive}
      </Label>
      <Switch
        onCheckedChange={() => setState(!value)}
        checked={value}
        disabled={disabled}
      />
    </div>
  );
};

interface TriStateToggleProps {
  id?: string;
  labelActive?: string;
  labelInactive?: string;
  labelAll?: string;
  value?: boolean | undefined;
  disabled?: boolean;
  setShowActive: React.Dispatch<React.SetStateAction<boolean | undefined>>;
  verticalLayout?: boolean;
}

const TriStateToggle: React.FC<TriStateToggleProps> = (props) => {
  const { id, disabled, value, labelActive, labelInactive, labelAll, setShowActive } =
    props;

  const active = labelActive ?? "Active";
  const inactive = labelInactive ?? "Inactive";
  const all = labelAll ?? "All";

  const cycleState = useCallback(() => {
    if (value === undefined) {
      setShowActive(true);
    } else if (value === true) {
      setShowActive(false);
    } else {
      setShowActive(undefined);
    }
  }, [value, setShowActive]);

  const getLabel = () => {
    if (value === undefined) return all;
    if (value === true) return active;
    return inactive;
  };

  const getIcon = () => {
    if (value === undefined) return <Minus className="h-3 w-3" />;
    if (value === true) return <Check className="h-3 w-3" />;
    return <X className="h-3 w-3" />;
  };

  const getButtonStyle = () => {
    const baseClasses =
      "w-full text-xs flex items-center justify-center gap-1 transition-all duration-200";

    if (value === undefined) {
      return cn(
        baseClasses,
        "border border-gray-300 bg-gray-100 text-gray-600 hover:border-gray-400 hover:bg-gray-200",
      );
    }
    if (value === true) {
      return cn(
        baseClasses,
        "border border-green-500 bg-green-500 text-white shadow-sm hover:border-green-600 hover:bg-green-600",
      );
    }
    return cn(
      baseClasses,
      "border border-red-500 bg-red-500 text-white shadow-sm hover:border-red-600 hover:bg-red-600",
    );
  };

  return (
    <div
      id={id}
      className={cn(
        "flex",
        props.verticalLayout ? "flex-col items-start gap-2" : "flex-row items-center",
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={cycleState}
        disabled={disabled}
        className={getButtonStyle()}
      >
        {getIcon()}
        <span>{getLabel()}</span>
      </Button>
    </div>
  );
};

export default Toggle;
export { TriStateToggle };
