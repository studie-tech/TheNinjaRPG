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
  "relative inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
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
        xl2: "h-18 rounded-md px-8 text-2xl",
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
  animation?: "pulse" | "glow";
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
    const isPulse = props.animation === "pulse";
    const isGlow = props.animation === "glow";
    const animation = isPulse ? "animate-pulse hover:animate-none" : "";
    const widthClassesFromUser = React.useMemo(() => {
      if (typeof className !== "string") return undefined;
      const tokens = className.split(/\s+/).filter(Boolean);
      const widthy = tokens.filter((t) => /^(w-|min-w-|max-w-|flex-1$|grow$)/.test(t));
      return widthy.length ? widthy.join(" ") : undefined;
    }, [className]);
    const glowBaseColor = React.useMemo(() => {
      switch (variant) {
        case "destructive":
          return "var(--color-destructive)";
        case "secondary":
          return "var(--color-secondary)";
        case "info":
          return "rgb(37 99 235)"; // tailwind blue-600
        case "outline":
        case "ghost":
        case "link":
          return "var(--color-primary)";
        default:
          return "var(--color-primary)";
      }
    }, [variant]);
    // Button element
    let element = (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          animation,
          isGlow && "relative z-10",
        )}
        ref={ref}
        {...props}
      >
        {children}
        {loading && <Loader size={20} />}
        {count !== undefined && count > 0 && (
          <div className="absolute top-0 right-[-3] flex items-center justify-center text-xs text-orange-100 bg-orange-500 rounded-full w-5 h-5 z-50">
            {count}
          </div>
        )}
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
    // If neither glow nor decoration is requested, return the element directly
    if (!isGlow && decoration === "none") return element;

    // Wrap to support glow and/or decoration layers
    return (
      <div
        className={cn("relative z-0 inline-block", widthClassesFromUser)}
        style={
          isGlow
            ? ({ ["--tnr-glow"]: glowBaseColor } as React.CSSProperties)
            : undefined
        }
      >
        {isGlow && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -inset-[2px] rounded-md blur-md z-0",
              // Gradient based on the button's own color via CSS var
              "tnr-glow-bg",
              // Animate gradient movement
              "bg-[600%_auto] background-animate [animation-duration:5s] [animation-timing-function:linear]",
            )}
          />
        )}
        {element}
        {isGlow && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 rounded-md z-[15] tnr-shine",
              "bg-[200%_100%] background-animate [animation-duration:2.5s] [animation-timing-function:linear]",
            )}
          />
        )}
        {decoration === "gold" && (
          <>
            <Image
              className="absolute top-[-1px] left-[-3px] scale-x-[-1] h-full w-auto z-[20]"
              src={IMG_LAYOUT_BUTTONDECOR}
              alt="signup-decor-left"
              width={8}
              height={25}
            ></Image>
            <Image
              className="absolute top-[-1px] right-[-3px] bottom-[0px] h-full w-auto z-[20]"
              src={IMG_LAYOUT_BUTTONDECOR}
              alt="signup-decor-right"
              width={8}
              height={25}
            ></Image>
          </>
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
