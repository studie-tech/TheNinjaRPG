"use client";

import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { HexColorPicker } from "react-colorful";
import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/libs/shadui";

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  ref?: React.Ref<HTMLInputElement>;
}

const ColorPicker = ({
  ref,
  disabled,
  value,
  onChange,
  onBlur,
  name,
  className,
  ...props
}: Omit<ButtonProps, "value" | "onChange" | "onBlur"> & ColorPickerProps) => {
  const [open, setOpen] = useState(false);

  const parsedValue = useMemo(() => {
    return value || "#FFFFFF";
  }, [value]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
      open={disabled ? false : open}
    >
      <PopoverTrigger asChild disabled={disabled} onBlur={onBlur}>
        <Button
          {...props}
          className={cn("block", className)}
          name={name}
          onClick={() => {
            setOpen(true);
          }}
          size="icon"
          style={{
            backgroundColor: parsedValue,
          }}
          variant="outline"
        >
          <div />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full">
        <div
          aria-disabled={disabled}
          className={cn(disabled && "pointer-events-none opacity-50")}
        >
          <HexColorPicker
            color={parsedValue}
            onChange={(nextColor) => {
              if (!disabled) onChange(nextColor);
            }}
          />
        </div>
        <Input
          disabled={disabled}
          maxLength={7}
          onChange={(e) => {
            if (!disabled) onChange(e?.currentTarget?.value);
          }}
          ref={ref}
          value={parsedValue}
        />
      </PopoverContent>
    </Popover>
  );
};
ColorPicker.displayName = "ColorPicker";

export { ColorPicker };
