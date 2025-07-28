import * as React from "react";
import Image from "next/image";
import Loader from "@/layout/Loader";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { IMG_LAYOUT_BUTTONDECOR } from "@/drizzle/constants";
import { cn } from "src/libs/shadui";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/70",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        info: "bg-blue-600 text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline:
          "border border-input bg-white shadow-xs hover:bg-slate-100 hover:text-accent-foreground text-black",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        xl: "h-14 rounded-md px-8 text-xl",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  hoverText?: string;
  decoration?: "gold" | "none";
  animation?: "pulse";
  loading?: boolean;
  count?: number;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      hoverText,
      children,
      asChild = false,
      decoration = "none",
      loading = false,
      count = undefined,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const animation = props.animation ? "animate-pulse hover:animate-none" : "";
    // Button element
    let element = (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), animation)}
        ref={ref}
        {...props}
      >
        {children}
        {loading && <Loader size={20} />}
      </Comp>
    );
    if (hoverText) {
      element = (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger asChild>{element}</TooltipTrigger>
            <TooltipContent>{hoverText}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    // No decoration, just return button
    if (decoration === "none") return element;
    // With decoration
    return (
      <div className={cn("relative")}>
        {element}
        {decoration === "gold" && (
          <>
            <Image
              className="absolute top-[-1px] left-[-3px] scale-x-[-1] h-full w-auto"
              src={IMG_LAYOUT_BUTTONDECOR}
              alt="signup-decor-left"
              width={8}
              height={25}
            ></Image>
            <Image
              className="absolute top-[-1px] right-[-3px] bottom-[0px] h-full w-auto"
              src={IMG_LAYOUT_BUTTONDECOR}
              alt="signup-decor-right"
              width={8}
              height={25}
            ></Image>
          </>
        )}
        {count !== undefined && count > 0 && (
          <div className="absolute top-0 right-[-3] flex items-center justify-center text-xs text-orange-100 bg-orange-500 rounded-full w-5 h-5 z-50">
            {count}
          </div>
        )}
      </div>
    );
  },
);
Button.displayName = "Button";

const ForwardRefButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (props, forwardedRef) => <button {...props} ref={forwardedRef} />,
);
ForwardRefButton.displayName = "ForwardRefButton";

export { Button, ForwardRefButton, buttonVariants };
