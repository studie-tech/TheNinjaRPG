import { randomBytes } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { storeConnectCode } from "@/libs/devContribution/deviceToken";

// The connect page is the bridge between the user's browser (which holds
// their Clerk session) and the desktop dev client:
//
//   1. The client generates a PKCE verifier + challenge, opens the browser at
//      /dev-connect?state=...&code_challenge=...&loopback_port=...
//   2. If the user is signed in, we mint a single-use connect code (5 min TTL)
//      bound to (userId, challenge, state) and redirect the browser to the
//      client's loopback callback with the code.
//   3. The client exchanges code + verifier via tRPC exchangeConnectCode and
//      receives a short-lived device token.
//
// All inputs are validated so this page can never be turned into an open
// redirect or a code-injection vector.

const STATE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const abort = () => redirect("/login");

export default async function DevConnectPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    code_challenge?: string;
    loopback_port?: string;
  }>;
}) {
  const params = await searchParams;

  const state = params.state ?? "";
  const challenge = params.code_challenge ?? "";
  const port = Number(params.loopback_port ?? NaN);

  if (!STATE_PATTERN.test(state) || !CHALLENGE_PATTERN.test(challenge)) {
    abort();
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    abort();
  }

  const { userId } = await auth();
  if (!userId) {
    const returnUrl = `/dev-connect?state=${encodeURIComponent(
      state,
    )}&code_challenge=${encodeURIComponent(challenge)}&loopback_port=${port}`;
    redirect(`/login?redirectUrl=${encodeURIComponent(returnUrl)}`);
  }

  const code = randomBytes(32).toString("hex");
  await storeConnectCode(code, { userId, challenge, state });

  redirect(
    `http://127.0.0.1:${port}/callback?code=${code}&state=${encodeURIComponent(state)}`,
  );
}
