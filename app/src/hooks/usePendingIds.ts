import { useRef, useState } from "react";

/**
 * Per-row form of `useSingleFlight`: each id runs one submission at a time while other
 * rows stay usable. `begin(id)` refuses a second submission for that id synchronously and
 * `end(id)` frees it, usually from `onSettled` or a `finally`. `ids` mirrors the set for
 * rendering; `has(id)` reads it synchronously from handlers and effects.
 */
export const usePendingIds = <Id = string>() => {
  const held = useRef<ReadonlySet<Id>>(new Set());
  const [ids, setIds] = useState<ReadonlySet<Id>>(held.current);

  const publish = (next: ReadonlySet<Id>) => {
    held.current = next;
    setIds(next);
  };

  const has = (id: Id) => held.current.has(id);

  const begin = (id: Id) => {
    if (held.current.has(id)) return false;
    publish(new Set(held.current).add(id));
    return true;
  };

  const end = (id: Id) => {
    const next = new Set(held.current);
    next.delete(id);
    publish(next);
  };

  return { ids, has, begin, end };
};
