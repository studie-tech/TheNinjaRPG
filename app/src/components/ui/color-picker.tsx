"use client";

import type * as React from "react";
import { useMemo, useState } from "react";
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

  return (
    <Popover onOpenChange={setOpen} open={open}>
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
        <HexColorPicker color={parsedValue} onChange={onChange} />
        <Input
          maxLength={7}
          onChange={(e) => {
            onChange(e?.currentTarget?.value);
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
