import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IMG_LAYOUT_BUTTONDECOR } from "@/drizzle/constants";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { cn } from "@/libs/shadui";

const buttonVariants = cva(
  "relative inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md font-medium text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/70",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        info: "bg-blue-600 text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline:
          "border border-input bg-white text-black shadow-xs hover:bg-slate-100 hover:text-accent-foreground",
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
  ref?: React.Ref<HTMLButtonElement>;
}

const Button = ({
  className,
  variant,
  size,
  hoverText,
  children,
  asChild = false,
  decoration = "none",
  loading = false,
  count = undefined,
  ref,
  ...props
}: ButtonProps) => {
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
  // When asChild is true, Slot requires exactly one child element,
  // so we only render children without any additional elements
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
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {loading && <Loader size={20} />}
          {count !== undefined && count > 0 && (
            <div className="absolute top-0 right-[-3] z-50 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-orange-100 text-xs">
              {count}
            </div>
          )}
        </>
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
        isGlow ? ({ "--tnr-glow": glowBaseColor } as React.CSSProperties) : undefined
      }
    >
      {isGlow && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-[2px] z-0 rounded-md blur-md",
            // Gradient based on the button's own color via CSS var
            "tnr-glow-bg",
            // Animate gradient movement
            "background-animate bg-[600%_auto] [animation-duration:5s] [animation-timing-function:linear]",
          )}
        />
      )}
      {element}
      {isGlow && (
        <div
          aria-hidden
          className={cn(
            "tnr-shine pointer-events-none absolute inset-0 z-[15] rounded-md",
            "background-animate bg-[200%_100%] [animation-duration:2.5s] [animation-timing-function:linear]",
          )}
        />
      )}
      {decoration === "gold" && (
        <>
          <Image
            className="absolute top-[-1px] left-[-3px] z-[20] h-full w-auto scale-x-[-1]"
            src={IMG_LAYOUT_BUTTONDECOR}
            alt="signup-decor-left"
            width={8}
            height={25}
          ></Image>
          <Image
            className="absolute top-[-1px] right-[-3px] bottom-[0px] z-[20] h-full w-auto"
            src={IMG_LAYOUT_BUTTONDECOR}
            alt="signup-decor-right"
            width={8}
            height={25}
          ></Image>
        </>
      )}
    </div>
  );
};
Button.displayName = "Button";

interface ForwardRefButtonProps extends ButtonProps {
  ref?: React.Ref<HTMLButtonElement>;
}

const ForwardRefButton = ({ ref, ...props }: ForwardRefButtonProps) => (
  <button {...props} ref={ref} />
);
ForwardRefButton.displayName = "ForwardRefButton";

export { Button, ForwardRefButton, buttonVariants };
