import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IMG_LAYOUT_BUTTONDECOR } from "@/drizzle/constants";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";

const buttonVariants = cva(
  "relative inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md font-medium text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/70",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        info: "bg-blue-600 text-destructive-foreground shadow-xs hover:bg-blue-600/90",
        outline:
          "border border-input bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
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
  animation,
  loading = false,
  count,
  ref,
  disabled,
  ...props
}: ButtonProps) => {
  const Comp = asChild ? Slot : "button";
  // A loading button stays inert so the pending request cannot be submitted twice.
  const isDisabled = asChild ? disabled : disabled || loading;
  const isPulse = animation === "pulse" && !isDisabled;
  const badge =
    count !== undefined && count > 0 ? (
      <div className="absolute top-0 right-[-3] z-50 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-orange-100 text-xs">
        {count}
      </div>
    ) : null;
  const isGlow = animation === "glow";
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
        isPulse && "motion-safe:animate-cta-pulse hover:animate-none",
        isGlow && "relative z-10",
      )}
      ref={ref}
      disabled={isDisabled}
      aria-busy={!asChild && loading ? true : undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? (
            <>
              {/* Transparent rather than hidden, so the label keeps the button's size and name. */}
              <span className="inline-flex items-center justify-center opacity-0">
                {children}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              </span>
            </>
          ) : (
            children
          )}
          {badge}
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
  // A slotted child cannot take extra children, so its badge sits in the wrapper instead.
  const wrappedBadge = asChild ? badge : null;
  // Without glow, decoration or a slotted badge, return the element directly
  if (!isGlow && decoration === "none" && !wrappedBadge) return element;

  // Wrap to support glow and/or decoration layers
  return (
    <div
      className={cn("relative z-0 inline-block", widthClassesFromUser)}
      style={
        isGlow ? ({ "--tnr-glow": glowBaseColor } as React.CSSProperties) : undefined
      }
    >
      {isGlow && (
        // Gradients slide on inner tracks: a transform animates on the compositor, while
        // a moving background repaints the page every frame.
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-[2px] z-0 overflow-hidden rounded-md blur-md"
        >
          <div className="tnr-glow-track" />
        </div>
      )}
      {element}
      {wrappedBadge}
      {isGlow && (
        <div
          aria-hidden
          className="tnr-shine pointer-events-none absolute inset-0 z-[15] overflow-hidden rounded-md"
        >
          <div className="tnr-shine-track" />
        </div>
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

export { Button, buttonVariants };
