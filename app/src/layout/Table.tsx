"use client";

import type React from "react";
import { Button } from "@/components/ui/button";
import { useNavigationRouter } from "@/hooks/navigation";
import AvatarImage from "@/layout/Avatar";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { cn } from "@/libs/shadui";
import { capitalizeFirstLetter } from "@/utils/string";
import { secondsPassed } from "@/utils/time";

export type ColumnDefinitionType<T, K extends keyof T> = {
  key: K;
  header: React.ReactNode;
  /** Extra classes for the column's header and cells, e.g. to hide it on small screens. */
  className?: string;
  type: "avatar" | "string" | "number" | "capitalized" | "time_passed" | "date" | "jsx";
  tooltip?: (row: T) => string;
};

type TableProps<T, K extends keyof T> = {
  data: Array<T> | undefined;
  columns: Array<ColumnDefinitionType<T, K>>;
  linkColumn?: K;
  linkPrefix?: string;
  /** Masked identities remain readable without exposing a profile through row navigation. */
  linkDisabled?: (row: T) => boolean;
  buttons?: {
    id?: string | ((row: T) => string);
    label: string | React.ReactNode | ((row: T) => React.ReactNode);
    onClick: (row: T) => void;
    disabled?: (row: T) => boolean;
    ariaLabel?: (row: T) => string;
  }[];
  onRowClick?: (row: T) => void;
  setLastElement?: (element: HTMLDivElement | null) => void;
  /** Tighter padding and smaller avatars (e.g. modals, side panels). */
  compact?: boolean;
  /** Shown in a full-width row once `data` has loaded with no rows. */
  emptyText?: React.ReactNode;
  /** Shows a loader row instead of the rows or `emptyText`. */
  isLoading?: boolean;
};

/**
 * Data table. With `linkColumn`, each row opens its page: the row's name cell holds a real
 * link (keyboard focus, open in a new tab), and a click anywhere else on the row follows
 * that same row's link, while cell controls keep their own clicks.
 *
 * The row click is handled on the row itself. A link overlay stretched over the row with
 * `position: absolute` depends on the `<tr>` being its containing block; where a browser
 * does not honour `position: relative` on a table row, every row's overlay covers the
 * whole table and each click opens the last row's page.
 */
const Table = <T, K extends keyof T>(props: TableProps<T, K>) => {
  const { data, columns } = props;
  const router = useNavigationRouter();
  const compact = props.compact === true;
  const avatarSize = compact ? 36 : 100;
  const avatarWrap = compact ? "w-9" : "w-20";
  const labelColumn = props.linkColumn
    ? (columns.find((c) => c.key === props.linkColumn && isTextColumn(c)) ??
      columns.find(isTextColumn))
    : undefined;
  const columnCount = columns.length + (props.buttons ? 1 : 0);
  const cellPadding = compact ? "px-2 py-1" : "px-3 py-2";

  return (
    <div className="relative min-w-0 flex-1 overflow-x-auto">
      <table className={cn("w-full text-left", compact ? "text-xs" : "text-sm")}>
        <thead
          className={cn(
            "bg-primary text-primary-foreground uppercase",
            compact ? "text-[10px]" : "text-xs",
          )}
        >
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                scope="col"
                className={cn(compact ? "px-2 py-1.5" : "px-3 py-3", column.className)}
              >
                {column.header}
              </th>
            ))}
            {props.buttons && (
              <th scope="col" className={compact ? "px-2 py-1.5" : "px-3 py-3"}>
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {props.isLoading && (
            <tr>
              <td colSpan={columnCount} className={cellPadding}>
                <Loader explanation="Loading" />
              </td>
            </tr>
          )}
          {!props.isLoading && data?.length === 0 && props.emptyText && (
            <tr>
              <td
                colSpan={columnCount}
                className={cn(cellPadding, "text-center text-muted-foreground italic")}
              >
                {props.emptyText}
              </td>
            </tr>
          )}
          {!props.isLoading &&
            data?.map((row, i) => {
              const href =
                props.linkColumn && !props.linkDisabled?.(row)
                  ? `${props.linkPrefix ?? ""}${String(row[props.linkColumn])}`
                  : undefined;
              const isClickable = !!href || !!props.onRowClick;
              return (
                <tr
                  key={
                    (row as T & { id?: string }).id
                      ? String((row as T & { id?: string }).id)
                      : `row-${i}`
                  }
                  ref={i === data.length - 1 ? props.setLastElement : null}
                  className={cn(
                    "border-gray-700 border-b",
                    i % 2 === 0 ? "bg-card" : "bg-popover",
                    isClickable && "cursor-pointer hover:bg-poppopover",
                    href && "focus-within:bg-poppopover",
                  )}
                  onClick={(event) => {
                    if (props.onRowClick) {
                      props.onRowClick(row);
                      return;
                    }
                    if (!href || isFromControl(event)) return;
                    if (event.metaKey || event.ctrlKey || event.shiftKey) {
                      window.open(href, "_blank", "noopener");
                    } else {
                      router.push(href);
                    }
                  }}
                  onAuxClick={(event) => {
                    // Middle click on the row opens it in a new tab, like the link itself.
                    if (event.button !== 1 || props.onRowClick) return;
                    if (!href || isFromControl(event)) return;
                    window.open(href, "_blank", "noopener");
                  }}
                >
                  {columns.map((column, columnIndex) => {
                    const linkHere =
                      href &&
                      (labelColumn ? column === labelColumn : columnIndex === 0);
                    const content = (
                      <>
                        {column.type === "avatar" && (
                          <div className={avatarWrap}>
                            <AvatarImage
                              href={row[column.key] as string}
                              alt={row[column.key] as string}
                              size={avatarSize}
                              hover_effect={true}
                            />
                          </div>
                        )}
                        {column.type === "string" && (
                          <div title={column.tooltip?.(row)}>
                            {row[column.key] as string}
                          </div>
                        )}
                        {column.type === "number" && (
                          <div title={column.tooltip?.(row)}>
                            {(row[column.key] as number).toLocaleString()}
                          </div>
                        )}
                        {column.type === "jsx" && (row[column.key] as React.ReactNode)}
                        {column.type === "capitalized" &&
                          capitalizeFirstLetter(row[column.key] as string)}
                        {column.type === "date" &&
                          (row[column.key] as Date).toLocaleString()}
                        {column.type === "time_passed" && (
                          <p>
                            {Math.floor(secondsPassed(row[column.key] as Date) / 60)}
                            <br />
                            minutes ago
                          </p>
                        )}
                      </>
                    );
                    return (
                      <td
                        key={String(column.key)}
                        className={cn(cellPadding, column.className)}
                      >
                        {linkHere && labelColumn ? (
                          <Link
                            href={href}
                            data-row-link
                            className="hover:underline focus-visible:underline focus-visible:outline-hidden"
                          >
                            {content}
                          </Link>
                        ) : (
                          <>
                            {linkHere && (
                              <Link
                                href={href}
                                data-row-link
                                className="focus-visible:outline-hidden"
                              >
                                <span className="sr-only">Open</span>
                              </Link>
                            )}
                            {content}
                          </>
                        )}
                      </td>
                    );
                  })}
                  {props.buttons && (
                    <td className={compact ? "px-2 py-1" : "px-6 py-4"}>
                      {props.buttons.map((button, buttonIndex) => {
                        const rowId = (row as T & { id?: string }).id ?? `row-${i}`;
                        const actionId =
                          typeof button.id === "function"
                            ? button.id(row)
                            : (button.id ?? String(buttonIndex));
                        return (
                          <Button
                            id={`table-action-${rowId}-${actionId}`}
                            key={`${rowId}-${actionId}`}
                            disabled={button.disabled?.(row)}
                            aria-label={button.ariaLabel?.(row)}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              button.onClick(row);
                            }}
                          >
                            {typeof button.label === "function"
                              ? button.label(row)
                              : button.label}
                          </Button>
                        );
                      })}
                    </td>
                  )}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
};

export default Table;

/** A column whose cell is plain text, so it can carry the row link's name. */
const isTextColumn = <T, K extends keyof T>(column: ColumnDefinitionType<T, K>) =>
  column.type === "string" || column.type === "capitalized";

/**
 * Whether a row click started on a link or control inside the row (including the row's own
 * name link), which handles the click itself.
 */
const isFromControl = (event: React.MouseEvent<HTMLTableRowElement>) => {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest(
    "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [role='checkbox'], [role='menuitem']",
  );
  return !!control && event.currentTarget.contains(control);
};
