import type React from "react";
import { startTransition, useEffect } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { cn } from "@/libs/shadui";

interface NavTabsProps {
  id?: string;
  remember?: boolean;
  className?: string;
  current: string | null;
  options: string[] | readonly string[];
  icons?: Partial<Record<string, React.ReactNode>>;
  counts?: Partial<Record<string, number>>;
  countLabel?: string;
  /** Render Radix tabs inside a controlled Tabs root with matching TabsContent. */
  accessibleTabs?: boolean;
  label?: string;
  /** Maps saved values from renamed or merged tabs onto a current option. */
  aliases?: Partial<Record<string, string>>;
  fontSize?: "text-xs" | "text-sm" | "text-base";
  setValue?: React.Dispatch<React.SetStateAction<any>>;
  onChange?: (value: string) => void;
}

const NavTabs: React.FC<NavTabsProps> = (props) => {
  // Destructure
  const { id, current, options, aliases, setValue, onChange, remember = true } = props;

  // If we do not have a current value, get from localStorage or select first one
  useEffect(() => {
    if (!current) {
      const stored = id && remember ? safeLocalStorageGetItem(id) : null;
      const select = resolveRememberedTab(stored, options, aliases);
      if (select) {
        if (setValue) setValue(select);
        if (onChange) onChange(select);
        if (id && remember) safeLocalStorageSetItem(id, select);
      }
    }
  }, [id, current, options, aliases, setValue, onChange, remember]);

  // Derived features
  const fontSize = props.fontSize ? props.fontSize : "text-sm";

  const tabItems = options.map((option, i) => {
    const count = props.counts?.[option] ?? 0;
    const button = (
      <button
        type="button"
        className={cn(
          option === current
            ? "active inline-block rounded-t-lg border-foreground/50 border-b-2 pt-2 pr-1 pb-2 pl-1 text-foreground/50"
            : "inline-block rounded-t-lg border-gray-700 border-transparent border-b-2 pt-2 pr-1 pb-2 pl-1 hover:border-gray-300 hover:text-gray-600",
          props.className,
          count > 0 && "relative pr-7",
        )}
        onClick={() => {
          if (id && remember) safeLocalStorageSetItem(id, option);
          // A transition lets heavy tab content render after the click is painted.
          startTransition(() => {
            if (setValue) setValue(option);
            if (onChange) onChange(option);
          });
        }}
      >
        {props.icons?.[option] ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {props.icons[option]}
            {option}
          </span>
        ) : (
          option
        )}
        {count > 0 && (
          <span
            className="absolute top-0 right-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-orange-100 text-xs"
            title={`${count} ${props.countLabel ?? "notifications"}`}
          >
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">
              {count} {props.countLabel ?? "notifications"}
            </span>
          </span>
        )}
      </button>
    );
    return (
      <li
        className="mr-2"
        key={`${option}-${i}`}
        id={`tutorial-${option}`}
        role={props.accessibleTabs ? "presentation" : undefined}
      >
        {props.accessibleTabs ? (
          <TabsTrigger
            value={option}
            asChild
            className={cn(
              "rounded-b-none data-[state=active]:bg-transparent data-[state=active]:text-foreground/50 data-[state=active]:shadow-none",
              fontSize,
              props.className,
            )}
          >
            {button}
          </TabsTrigger>
        ) : (
          button
        )}
      </li>
    );
  });

  // Render
  return (
    <div
      className={`text-center ${fontSize} flex flex-row justify-center font-medium text-foreground`}
    >
      {props.accessibleTabs ? (
        <TabsList
          asChild
          aria-label={props.label}
          className="w-auto flex-nowrap gap-0 rounded-none bg-transparent p-0 text-foreground"
        >
          <ul className="-mb-px flex flex-row">{tabItems}</ul>
        </TabsList>
      ) : (
        <ul className="-mb-px flex flex-row">{tabItems}</ul>
      )}
    </div>
  );
};

export default NavTabs;

/**
 * Picks the tab to open from a saved value: the saved tab when it is still offered, the
 * tab it was renamed or merged into, or else the first option.
 */
export const resolveRememberedTab = (
  stored: string | null,
  options: string[] | readonly string[],
  aliases?: Partial<Record<string, string>>,
): string | undefined => {
  if (stored && options.includes(stored)) return stored;
  const alias = stored ? aliases?.[stored] : undefined;
  if (alias && options.includes(alias)) return alias;
  return options[0];
};
