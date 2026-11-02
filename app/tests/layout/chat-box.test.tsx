import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createTRPCReact } from "@trpc/react-query";
import { afterEach, expect, it, vi } from "bun:test";
import type { PropsWithChildren } from "react";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import ChatBox from "@/layout/ChatBox";
import * as richInput from "@/layout/RichInput";
import * as userContext from "@/utils/UserContext";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  localStorage.removeItem("seichiAiChat:history-reader");
  vi.restoreAllMocks();
});

it.each([null, "text", { type: "text", text: 7 }, { type: "file", text: "Saved" }])("recovers from invalid saved message parts and keeps a fresh chat usable (%j)", (part) => {
  localStorage.setItem("seichiAiChat:history-reader", JSON.stringify([{ id: "saved", role: "user", parts: [part] }]));
  const testApi = createTRPCReact<AppRouter>();
  Object.assign(vi.spyOn(client, "api" as never), { misc: testApi.misc });
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: { userId: "history-reader", username: "Me", level: 50 } } as never);
  vi.spyOn(richInput, "default").mockReturnValue(<textarea aria-label="Question" />);
  const queryClient = new QueryClient();
  clients.push(queryClient);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => <testApi.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></testApi.Provider>;
  const view = render(<ChatBox />, { wrapper });
  expect(view.getByText("Hello! How can I help you today?")).toBeTruthy();
  expect(view.getByRole("textbox", { name: "Question" })).toBeTruthy();
  expect((view.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(true);
});
