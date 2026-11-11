import type React from "react";
import { startTransition, useEffect, useOptimistic } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/libs/shadui";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

interface NavTabsProps {
  id?: string;
  remember?: boolean;
  className?: string;
  current: string | null;
  options: string[] | readonly string[];
  icons?: Partial<Record<string, React.ReactNode>>;
  /** Display content can change independently of the stable selection value. */
  labels?: Partial<Record<string, React.ReactNode>>;
  /** Keep icon tabs named for assistive technology and hover discovery. */
  iconOnlyOptions?: readonly string[];
  /** Customize icon labels, including showing them only in wider containers. */
  labelClassName?: (option: string) => string;
  /** Stable Radix values keep labels containing spaces out of generated ID references. */
  values?: Partial<Record<string, string>>;
  listClassName?: string;
  itemClassName?: (option: string) => string;
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
  const [shownCurrent, setShownCurrent] = useOptimistic(current);

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
    const isIconOnly =
      !!props.icons?.[option] && !!props.iconOnlyOptions?.includes(option);
    const isSelected = option === shownCurrent;
    const button = (
      <button
        type="button"
        title={isIconOnly ? option : undefined}
        aria-label={
          isIconOnly
            ? `${option}${count > 0 ? ` ${count} ${props.countLabel ?? "notifications"}` : ""}`
            : undefined
        }
        aria-current={!props.accessibleTabs && isSelected ? "true" : undefined}
        className={cn(
          "inline-block min-h-11 min-w-11 rounded-t-lg border-b-2 px-2 py-2",
          isSelected
            ? "active border-primary font-semibold text-foreground"
            : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
          props.className,
          count > 0 && "relative",
          count > 0 && !isIconOnly && "pr-7",
        )}
        onClick={() => {
          if (id && remember) safeLocalStorageSetItem(id, option);
          // A transition lets heavy tab content render after the click is painted; the
          // tapped tab shows as selected straight away.
          startTransition(() => {
            setShownCurrent(option);
            if (setValue) setValue(option);
            if (onChange) onChange(option);
          });
        }}
      >
        {props.icons?.[option] ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {props.icons[option]}
            <span
              className={cn(isIconOnly && "sr-only", props.labelClassName?.(option))}
            >
              {props.labels?.[option] ?? option}
            </span>
          </span>
        ) : (
          (props.labels?.[option] ?? option)
        )}
        {count > 0 && (
          <span
            className="absolute top-0 right-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-orange-100 text-xs"
            title={`${count} ${props.countLabel ?? "notifications"}`}
          >
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">
              {" "}
              {count} {props.countLabel ?? "notifications"}
            </span>
          </span>
        )}
      </button>
    );
    return (
      <li
        className={cn("mr-2", props.itemClassName?.(option))}
        key={`${option}-${i}`}
        id={`tutorial-${option}`}
        role={props.accessibleTabs ? "presentation" : undefined}
      >
        {props.accessibleTabs ? (
          <TabsTrigger
            value={props.values?.[option] ?? option}
            asChild
            className={cn(
              "rounded-b-none data-[state=active]:bg-transparent data-[state=active]:shadow-none",
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
          className={cn(
            "w-auto flex-nowrap gap-0 rounded-none bg-transparent p-0 text-foreground",
            props.listClassName,
          )}
        >
          <ul className="-mb-px flex flex-row">{tabItems}</ul>
        </TabsList>
      ) : (
        <ul className={cn("-mb-px flex flex-row", props.listClassName)}>{tabItems}</ul>
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
