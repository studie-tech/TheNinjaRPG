import { vi } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as craftingCache from "@/hooks/useCraftingCacheUpdate";
import * as combatActions from "@/layout/CombatActions";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import * as modal from "@/layout/Modal";

/** Flatten the catalog's modal and selectors; restored by `vi.restoreAllMocks()`. */
export const stubCraftingCatalog = () => {
  stubCraftingCache();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    occupation: {
      craftItem: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  });
  vi.spyOn(modal, "default").mockImplementation(
    ({
      children,
      isOpen,
      proceed_label,
      proceedDisabled,
    }: {
      children: ReactNode;
      isOpen: boolean;
      proceed_label?: string | null;
      proceedDisabled?: boolean;
    }) =>
      isOpen ? (
        <div>
          {children}
          {proceed_label && (
            <button type="button" disabled={proceedDisabled}>
              {proceed_label}
            </button>
          )}
        </div>
      ) : null,
  );
  vi.spyOn(combatActions, "ActionSelector").mockImplementation(
    ({ items, onClick }: ComponentProps<typeof combatActions.ActionSelector>) => (
      <>
        {items?.map((entry) => (
          <button key={entry.id} type="button" onClick={() => onClick(entry.id)}>
            {entry.name}
          </button>
        ))}
      </>
    ),
  );
  vi.spyOn(itemWithEffects, "default").mockImplementation(() => null);
};

/** Replace the craft's cache reconciliation, whose query keys need the real tRPC proxy. */
export const stubCraftingCache = () =>
  vi.spyOn(craftingCache, "useCraftingCacheUpdate").mockReturnValue({
    prepareCraftUpdate: vi.fn(),
    updateCraft: vi.fn(async () => {}),
  } as never);
