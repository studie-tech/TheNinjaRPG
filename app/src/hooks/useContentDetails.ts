import { useState } from "react";

/** Selection state of a content details dialog; spread it into `ContentDetailsModal`. */
export const useContentDetails = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [id, setId] = useState("");
  const open = (nextId: string) => {
    setId(nextId);
    setIsOpen(true);
  };
  return { id, isOpen, setIsOpen, open };
};

export type ContentDetails = ReturnType<typeof useContentDetails>;
