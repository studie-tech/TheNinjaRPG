"use client";

import type React from "react";
import { Button } from "@/components/ui/button";
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
 * Data table. With `linkColumn`, each row is a real link to its page: the row's name cell
 * holds the link and its hit area covers the row, so rows open in a new tab and take focus,
 * while cell controls stay above it.
 */
const Table = <T, K extends keyof T>(props: TableProps<T, K>) => {
  const { data, columns } = props;
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
                    // The row link's hit area spans the row; controls in cells sit above it.
                    href &&
                      "relative focus-within:bg-poppopover [&_:is(a,button,input,select,label):not([data-row-link])]:relative [&_:is(a,button,input,select,label):not([data-row-link])]:z-10",
                  )}
                  onClick={props.onRowClick ? () => props.onRowClick?.(row) : undefined}
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
                            className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:underline focus-visible:outline-hidden"
                          >
                            {content}
                          </Link>
                        ) : (
                          <>
                            {linkHere && (
                              <Link
                                href={href}
                                data-row-link
                                className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-hidden"
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
