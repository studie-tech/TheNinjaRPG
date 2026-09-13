import { ExternalLink, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Uses the game's panel palette while giving device controls room to be tapped. */
export const NativeFeatureCard = ({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  children: ReactNode;
}) => (
  <section className="min-w-0 space-y-3 rounded-lg border border-primary/25 bg-background p-4 shadow-xs">
    <div className="flex items-start gap-3">
      <span className="rounded-md bg-primary/10 p-2 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 className="text-balance font-semibold text-[16px]">{title}</h3>
        {description && (
          <p className="mt-1 text-pretty text-[14px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </div>
    {children}
  </section>
);

export const NativeExternalLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <Button
    asChild
    variant="outline"
    className="h-[44px] min-h-[44px] w-full justify-between gap-3 whitespace-nowrap text-left text-[14px]"
  >
    <a href={href} target="_blank" rel="noreferrer">
      <span>{children}</span>
      <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
      <span className="sr-only"> (opens outside the app)</span>
    </a>
  </Button>
);
