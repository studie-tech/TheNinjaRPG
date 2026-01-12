import * as React from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type DayButton, DayPicker, getDefaultClassNames } from "react-day-picker";

import { cn } from "@/libs/shadui";
import { Button, buttonVariants } from "@/components/ui/button";

/* -------------------------------------------------------------------------- */
/*                            Top-level components                            */
/* -------------------------------------------------------------------------- */

function CalendarRoot({
  className,
  rootRef,
  ...props
}: React.ComponentProps<"div"> & { rootRef?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
}

function CalendarChevron({
  className,
  orientation,
  ...props
}: {
  className?: string;
  size?: number;
  disabled?: boolean;
  orientation?: "left" | "right" | "down" | "up";
}) {
  if (orientation === "left") {
    return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
  }

  if (orientation === "right") {
    return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
  }

  if (orientation === "up") {
    return <ChevronDownIcon className={cn("size-4 rotate-180", className)} {...props} />;
  }

  return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
}

function CalendarWeekNumber({ children, ...props }: React.ComponentProps<"td">) {
  return (
    <td {...props}>
      <div className="flex size-[--cell-size] items-center justify-center text-center text-sm">
        {children}
      </div>
    </td>
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "flex aspect-square h-auto w-full min-w-[--cell-size] flex-col gap-1 font-normal leading-none",
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground",
        "data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground",
        "data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground",
        "data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground",
        "data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md",
        "group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px]",
        "[&>span]:text-base [&>span]:opacity-90",
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*                               Main Calendar                                */
/* -------------------------------------------------------------------------- */

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn(
        "bg-background group/calendar p-4",
        // Bigger calendar + consistent sizing even inside popovers
        "min-w-[22rem] sm:min-w-[24rem]",
        // Bigger cells
        "[--cell-size:3.25rem] sm:[--cell-size:3.5rem]",
        "text-base",
        "[[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-full", defaultClassNames.root),

        months: cn(
          "relative flex flex-col gap-4",
          defaultClassNames.months,
        ),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),

        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav,
        ),

        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_next,
        ),

        month_caption: cn(
          "flex h-[--cell-size] w-full items-center justify-center px-[--cell-size]",
          defaultClassNames.month_caption,
        ),

        dropdowns: cn(
          "flex h-[--cell-size] w-full items-center justify-center gap-2 text-base font-semibold",
          defaultClassNames.dropdowns,
        ),

        dropdown_root: cn(
          "has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border",
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn(
          "bg-popover absolute inset-0 opacity-0",
          defaultClassNames.dropdown,
        ),

        caption_label: cn(
          "select-none font-semibold",
          captionLayout === "label"
            ? "text-base"
            : "[&>svg]:text-muted-foreground flex h-9 items-center gap-1 rounded-md pl-2 pr-1 text-base [&>svg]:size-4",
          defaultClassNames.caption_label,
        ),

        table: "w-full border-collapse",

        // Day-of-week row spacing
        weekdays: cn("flex gap-2", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground flex-1 select-none rounded-md text-sm font-medium",
          defaultClassNames.weekday,
        ),

        // Week row spacing (THIS is what makes dates stop looking crammed)
        week: cn("mt-3 flex w-full gap-2", defaultClassNames.week),

        week_number_header: cn(
          "w-[--cell-size] select-none",
          defaultClassNames.week_number_header,
        ),
        week_number: cn(
          "text-muted-foreground select-none text-sm",
          defaultClassNames.week_number,
        ),

        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center",
          defaultClassNames.day,
        ),

        range_start: cn("bg-accent rounded-l-md", defaultClassNames.range_start),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("bg-accent rounded-r-md", defaultClassNames.range_end),

        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today,
        ),

        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside,
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled,
        ),
        hidden: cn("invisible", defaultClassNames.hidden),

        ...classNames,
      }}
      components={{
        Root: CalendarRoot,
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        WeekNumber: CalendarWeekNumber,
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
