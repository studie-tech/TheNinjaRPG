"use client";

import { GripVertical } from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";
import { cn } from "@/libs/shadui";

interface SortableItem {
  id: string;
  label: string;
}

interface SortableListProps {
  items: SortableItem[];
  onReorder: (items: SortableItem[]) => void;
  className?: string;
  itemClassName?: string;
  renderItem?: (item: SortableItem, index: number) => React.ReactNode;
}

/**
 * A generic sortable list component using native HTML5 drag and drop.
 * Items can be reordered by dragging the grip handle.
 */
export const SortableList: React.FC<SortableListProps> = ({
  items,
  onReorder,
  className,
  itemClassName,
  renderItem,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    dragNodeRef.current = e.currentTarget;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());

    // Add a slight delay to apply dragging styles after the drag image is captured
    requestAnimationFrame(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = "0.5";
      }
    });
  };

  const handleDragEnd = () => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = "1";
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    dragNodeRef.current = null;
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (draggedIndex === null || draggedIndex === index) return;

    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === targetIndex) {
      handleDragEnd();
      return;
    }

    const newItems = [...items];
    const draggedItem = newItems[draggedIndex];
    if (!draggedItem) {
      handleDragEnd();
      return;
    }

    // Remove the dragged item from its original position
    newItems.splice(draggedIndex, 1);
    // Insert it at the target position
    newItems.splice(targetIndex, 0, draggedItem);

    onReorder(newItems);
    handleDragEnd();
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {items.map((item, index) => {
        const isDragging = draggedIndex === index;
        const isDragOver = dragOverIndex === index;

        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: Drag and drop uses native HTML5 drag events which don't require keyboard handlers
          <div
            key={item.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            className={cn(
              "flex select-none items-center gap-2 rounded-md border bg-card p-2 transition-all",
              isDragging && "border-dashed opacity-50",
              isDragOver &&
                draggedIndex !== null &&
                draggedIndex !== index &&
                (draggedIndex < index
                  ? "border-b-2 border-b-primary"
                  : "border-t-2 border-t-primary"),
              itemClassName,
            )}
          >
            <div
              className="cursor-grab rounded p-1 hover:bg-muted active:cursor-grabbing"
              title="Drag handle"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              {renderItem ? (
                renderItem(item, index)
              ) : (
                <span className="text-sm">{item.label}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export type { SortableItem, SortableListProps };
