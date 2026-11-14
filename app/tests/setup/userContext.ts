import { vi } from "bun:test";
import type { UserWithRelations } from "@/routers/profile";
import * as UserContext from "@/utils/UserContext";

type Info = Partial<ReturnType<typeof UserContext.useUserInfo>>;
type HookValue = { data?: unknown } & Info;

/**
 * Serve a hook value (`data` plus session fields), or a getter read on every call, through
 * every UserContext hook, so tests do not depend on which selector a component uses.
 */
export const mockUserContextValue = (value: HookValue | (() => unknown)) => {
  const read = () =>
    ((typeof value === "function" ? value() : value) ?? {}) as {
      data?: UserWithRelations;
    } & Info;
  const full = () => read() as never;
  const select = <T>(pick: (user: NonNullable<UserWithRelations>) => T) => {
    const { data, ...info } = read();
    return { ...info, data: data ? pick(data) : undefined } as never;
  };
  vi.spyOn(UserContext, "useUserData").mockImplementation(full);
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(full);
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(select);
  vi.spyOn(UserContext, "useRequiredUserDataSelector").mockImplementation(select);
  vi.spyOn(UserContext, "useUserInfo").mockImplementation(full);
  vi.spyOn(UserContext, "useRequiredUserInfo").mockImplementation(() => {
    const { data, ...info } = read();
    return { ...info, data: data?.userId } as never;
  });
};
