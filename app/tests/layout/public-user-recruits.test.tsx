import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import * as Modal from "@/layout/Modal";
import { RecruitedUsersTab } from "@/layout/publicUser/RecruitedUsersTab";
import * as UserAvatarTile from "@/layout/UserAvatarTile";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";

const remove = vi.fn(async () => ({ success: true, message: "Removed" }));
const invalidate = vi.fn(async () => undefined);
const recruit = (userId: string, username: string) => ({
  userId,
  username,
  rank: "GENIN" as const,
  isOutlaw: false,
  level: 10,
  avatar: null,
});

beforeEach(() => {
  remove.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      profile: { getPublicUser: { invalidate }, getPublicUsers: { invalidate } },
    }),
    staff: { deleteReferral: { useMutation: () => ({ mutateAsync: remove }) } },
  });
  vi.spyOn(UserContext, "useUserData").mockImplementation(
    () => ({ data: { role: "OWNER" } }) as never,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(UserAvatarTile, "UserAvatarTile").mockImplementation((({
    user,
  }: {
    user: { username: string };
  }) => <span>{user.username}</span>) as never);
  vi.spyOn(Modal, "default").mockImplementation(({ isOpen, title, onAccept }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={(event) => onAccept?.(event as never)}>
          Proceed
        </button>
      </div>
    ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("drops a removed recruit and its confirmation while keeping the others", async () => {
  const view = render(
    <RecruitedUsersTab
      recruits={[recruit("one", "One"), recruit("two", "Two")]}
      parentUserId="recruiter"
      parentUsername="Recruiter"
      parentRecruitedCount={2}
    />,
  );
  fireEvent.click(view.getByLabelText("Remove One as a referral"));
  fireEvent.click(view.getByRole("button", { name: "Proceed" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith({ userId: "one" }));
  await waitFor(() => expect(view.queryByText("One")).toBeNull());
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByText("Two")).toBeTruthy();
  expect(view.getByLabelText("Remove Two as a referral")).toBeTruthy();
});
