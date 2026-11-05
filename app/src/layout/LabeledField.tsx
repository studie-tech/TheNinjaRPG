import type React from "react";
import { Label } from "@/components/ui/label";

/** Compact staff form field: a label stacked over its control. */
export const LabeledField: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <Label className="block space-y-1">
    <span className="block">{label}</span>
    {children}
  </Label>
);
