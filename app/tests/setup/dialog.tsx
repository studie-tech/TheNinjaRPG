import { vi } from "bun:test";
import type { HTMLAttributes, ReactNode } from "react";
import * as dialogComponents from "@/components/ui/dialog";

const Passthrough = ({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={className} {...props}>
    {children}
  </div>
);

const dialogStubs = {
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: ({
    className,
    children,
    id,
  }: HTMLAttributes<HTMLDivElement> & { id?: string }) => (
    <div role="dialog" id={id} className={className}>
      {children}
    </div>
  ),
  DialogHeader: Passthrough,
  DialogFooter: Passthrough,
  DialogTitle: ({
    className,
    children,
    ...props
  }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className={className} {...props}>
      {children}
    </h2>
  ),
  DialogDescription: ({
    className,
    children,
    ...props
  }: HTMLAttributes<HTMLParagraphElement>) => (
    <p className={className} {...props}>
      {children}
    </p>
  ),
};

/** Render dialogs in place, without Radix portals; call from `beforeEach` and run the result after. */
export const stubDialog = () => {
  const spies = Object.entries(dialogStubs).map(([name, implementation]) =>
    vi
      .spyOn(dialogComponents, name as keyof typeof dialogStubs)
      .mockImplementation(implementation as never),
  );
  return () => {
    for (const spy of spies) spy.mockRestore();
  };
};
