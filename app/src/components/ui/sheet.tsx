import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type * as React from "react";

import { cn } from "@/libs/shadui";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SheetPrimitive.Overlay>) => (
  <SheetPrimitive.Overlay
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/75 will-change-[opacity] contain-strict data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:duration-150 data-[state=open]:duration-150",
      className,
    )}
    {...props}
    ref={ref}
  />
);
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "translate-z-0 backface-hidden fixed z-50 gap-4 overscroll-contain bg-background p-6 shadow-xs transition-transform will-change-transform contain-strict data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:duration-150 data-[state=open]:duration-150 motion-reduce:transition-none",
  {
    variants: {
      side: {
        top: "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 border-b data-[state=closed]:translate-y-[-100%] data-[state=open]:translate-y-0 data-[state=closed]:transform-gpu data-[state=open]:transform-gpu",
        bottom:
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 border-t data-[state=closed]:translate-y-[100%] data-[state=open]:translate-y-0 data-[state=closed]:transform-gpu data-[state=open]:transform-gpu",
        left: "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:translate-x-[-100%] data-[state=open]:translate-x-0 data-[state=closed]:transform-gpu data-[state=open]:transform-gpu sm:max-w-sm",
        right:
          "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:translate-x-[100%] data-[state=open]:translate-x-0 data-[state=closed]:transform-gpu data-[state=open]:transform-gpu sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  ref?: React.Ref<React.ElementRef<typeof SheetPrimitive.Content>>;
}

const SheetContent = ({
  ref,
  side = "right",
  className,
  children,
  ...props
}: SheetContentProps) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        sheetVariants({ side }),
        className,
        "overflow-y-auto overscroll-contain contain-strict",
      )}
      {...props}
    >
      <div>
        <SheetPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-75 ring-offset-background hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
        {children}
      </div>
    </SheetPrimitive.Content>
  </SheetPortal>
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SheetPrimitive.Title>) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("font-semibold text-foreground text-lg", className)}
    {...props}
  />
);
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SheetPrimitive.Description>) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
);
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
